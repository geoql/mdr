/**
 * Tests for the remote (OpenAI-compatible) embedding provider.
 *
 * A mock Node HTTP server plays the embeddings API so the tests verify the
 * real request/response wire format without network access. Local-model
 * fallback paths are covered by the existing indexer tests.
 */

import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  embed,
  embedBatch,
  embedQuery,
  preloadModel,
  getRemoteEmbeddingConfig,
  resetEmbeddingConfigCache,
} from '~/embeddings';

interface RecordedRequest {
  url: string;
  authorization: string | null;
  body: {
    model: string;
    input: string[];
    input_type?: string;
  };
}

const recordedRequests: RecordedRequest[] = [];
let respondWith: (input: string[]) => Response = defaultResponder;

function defaultResponder(input: string[]): Response {
  return Response.json({
    object: 'list',
    data: input.map((_, index) => ({
      object: 'embedding',
      index,
      embedding: [0.1 * (index + 1), 0.2, 0.3],
    })),
    model: 'test-model',
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

let rawResponder: ((res: ServerResponse) => void) | null = null;

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  const body = JSON.parse(raw) as RecordedRequest['body'];
  recordedRequests.push({
    url: `http://localhost:${port}${req.url ?? ''}`,
    authorization: req.headers.authorization ?? null,
    body,
  });

  if (rawResponder) {
    rawResponder(res);
    return;
  }

  const response = respondWith(body.input);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server: Server = createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    res.statusCode = 500;
    res.end();
  });
});
server.listen(0);
const port = (server.address() as AddressInfo).port;

const ENDPOINT = `http://localhost:${port}/v1`;

let configDir: string;

function writeConfig(embedding: Record<string, unknown> | null) {
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(embedding ? { embedding } : {}));
  process.env.MACRODATA_CONFIG_PATH = configPath;
  resetEmbeddingConfigCache();
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'macrodata-embed-test-'));
  recordedRequests.length = 0;
  respondWith = defaultResponder;
  rawResponder = null;
});

afterEach(() => {
  delete process.env.MACRODATA_CONFIG_PATH;
  resetEmbeddingConfigCache();
  rmSync(configDir, { recursive: true, force: true });
});

afterAll(() => {
  server.close();
});

describe('getRemoteEmbeddingConfig', () => {
  test('returns null when config.json is absent', () => {
    process.env.MACRODATA_CONFIG_PATH = join(configDir, 'missing.json');
    resetEmbeddingConfigCache();
    expect(getRemoteEmbeddingConfig()).toBeNull();
  });

  test('returns null when embedding block is absent', () => {
    writeConfig(null);
    expect(getRemoteEmbeddingConfig()).toBeNull();
  });

  test('returns null for unknown providers', () => {
    writeConfig({ provider: 'mystery', endpoint: ENDPOINT, model: 'm' });
    expect(getRemoteEmbeddingConfig()).toBeNull();
  });

  test('returns null when required fields are missing', () => {
    writeConfig({ provider: 'openai-compatible', model: 'm' });
    expect(getRemoteEmbeddingConfig()).toBeNull();
  });

  test('parses a valid openai-compatible config', () => {
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-test',
      model: 'test-model',
    });
    const config = getRemoteEmbeddingConfig();
    expect(config).not.toBeNull();
    expect(config?.endpoint).toBe(ENDPOINT);
    expect(config?.model).toBe('test-model');
  });

  test('caches the parsed config across calls', () => {
    writeConfig({ provider: 'openai-compatible', endpoint: ENDPOINT, model: 'm' });
    const first = getRemoteEmbeddingConfig();
    // Second call returns the memoized instance without re-reading the file.
    expect(getRemoteEmbeddingConfig()).toBe(first);
  });

  test('returns null and warns on a malformed config.json', () => {
    const configPath = join(configDir, 'config.json');
    writeFileSync(configPath, '{ broken json');
    process.env.MACRODATA_CONFIG_PATH = configPath;
    resetEmbeddingConfigCache();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getRemoteEmbeddingConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('remote embedding requests', () => {
  beforeEach(() => {
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-test',
      model: 'test-model',
      input_type: 'passage',
      query_input_type: 'query',
    });
  });

  test('embed posts to /embeddings with auth and model', async () => {
    const vector = await embed('hello');

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(recordedRequests).toHaveLength(1);
    const req = recordedRequests[0];
    expect(req.url).toMatch(/\/v1\/embeddings$/);
    expect(req.authorization).toBe('Bearer sk-test');
    expect(req.body.model).toBe('test-model');
    expect(req.body.input).toEqual(['hello']);
    expect(req.body.input_type).toBe('passage');
  });

  test('embedQuery uses query_input_type', async () => {
    await embedQuery('find me things');

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0].body.input_type).toBe('query');
  });

  test('embedBatch splits into configured batch sizes', async () => {
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-test',
      model: 'test-model',
      batch_size: 2,
    });

    const texts = ['a', 'b', 'c', 'd', 'e'];
    const vectors = await embedBatch(texts);

    expect(vectors).toHaveLength(5);
    expect(recordedRequests).toHaveLength(3);
    expect(recordedRequests.map((r) => r.body.input)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  test('restores response order using the index field', async () => {
    respondWith = (input) =>
      Response.json({
        data: input.map((_, index) => ({ index, embedding: [index + 1, 0, 0] })).reverse(),
      });

    const vectors = await embedBatch(['first', 'second']);

    expect(vectors[0][0]).toBe(1);
    expect(vectors[1][0]).toBe(2);
  });

  test('resolves api key from api_key_env when set', async () => {
    process.env.MACRODATA_TEST_EMBED_KEY = 'sk-from-env';
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-fallback',
      api_key_env: 'MACRODATA_TEST_EMBED_KEY',
      model: 'test-model',
    });

    await embed('hello');

    expect(recordedRequests[0].authorization).toBe('Bearer sk-from-env');
    delete process.env.MACRODATA_TEST_EMBED_KEY;
  });

  test('falls back to api_key when api_key_env is unset', async () => {
    delete process.env.MACRODATA_TEST_EMBED_KEY;
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-fallback',
      api_key_env: 'MACRODATA_TEST_EMBED_KEY',
      model: 'test-model',
    });
    await embed('hello');
    expect(recordedRequests[0].authorization).toBe('Bearer sk-fallback');
  });

  test('sends no auth header when no api key is configured', async () => {
    writeConfig({ provider: 'openai-compatible', endpoint: ENDPOINT, model: 'test-model' });
    await embed('hello');
    expect(recordedRequests[0].authorization).toBeNull();
  });

  test('handles a response with no index fields', async () => {
    respondWith = (input) => Response.json({ data: input.map(() => ({ embedding: [7, 8, 9] })) });
    const vectors = await embedBatch(['a', 'b']);
    expect(vectors).toEqual([
      [7, 8, 9],
      [7, 8, 9],
    ]);
  });

  test('throws on HTTP errors instead of returning bad vectors', async () => {
    respondWith = () => new Response('upstream exploded', { status: 502 });

    await expect(embed('hello')).rejects.toThrow(/502/);
  });

  test('still throws when reading the error body itself fails', async () => {
    // A non-2xx response that claims gzip encoding but sends plain bytes, so
    // response.text() rejects on decompression and the .catch(() => "") runs.
    rawResponder = (res) => {
      res.statusCode = 500;
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'text/plain');
      res.end('this is definitely not valid gzip data');
    };
    await expect(embed('hello')).rejects.toThrow(/failed/);
  });

  test('throws when the response count does not match the input count', async () => {
    respondWith = () => Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] });

    await expect(embedBatch(['a', 'b'])).rejects.toThrow(/mismatch/);
  });

  test('throws when the response omits the data array entirely', async () => {
    respondWith = () => Response.json({ object: 'list' });
    await expect(embed('hello')).rejects.toThrow(/expected 1 embeddings, got 0/);
  });

  test('embedBatch returns empty array without any request', async () => {
    const vectors = await embedBatch([]);
    expect(vectors).toEqual([]);
    expect(recordedRequests).toHaveLength(0);
  });

  test('preloadModel skips the local model when a remote provider is set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(preloadModel()).resolves.toBeUndefined();
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('')).toContain(
      'Remote embedding provider configured',
    );
    logSpy.mockRestore();
  });

  test('merges extra_body fields into the request payload', async () => {
    writeConfig({
      provider: 'openai-compatible',
      endpoint: ENDPOINT,
      api_key: 'sk-test',
      model: 'test-model',
      extra_body: { truncate: 'END' },
    });

    await embed('hello');

    expect(recordedRequests).toHaveLength(1);
    expect((recordedRequests[0].body as Record<string, unknown>).truncate).toBe('END');
    expect(recordedRequests[0].body.model).toBe('test-model');
  });
});
