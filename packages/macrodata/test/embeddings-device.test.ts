/**
 * Covers resolveLocalEmbeddingDevice and the device passthrough in
 * getEmbeddingPipeline: the Bun-host guard that keeps the native
 * onnxruntime-node NAPI addon out of Bun processes. Loading that addon
 * under Bun (the OpenCode plugin host) crashes the process at VM teardown
 * with "NAPI FATAL ERROR: Error::New napi_create_error".
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const pipelineSpy = vi.fn(async (..._args: unknown[]) => {
  return (batch: string[]) => ({
    dims: [batch.length, 384],
    data: new Float32Array(batch.length * 384).fill(0.5),
  });
});

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineSpy(...args),
}));

const { embed, resolveLocalEmbeddingDevice, resetEmbeddingConfigCache, resetLocalPipelineForTests } =
  await import('../src/embeddings');

const ORT_SYMBOL = Symbol.for('onnxruntime');

const versions = process.versions as Record<string, string | undefined>;
const hadBun = Object.prototype.hasOwnProperty.call(versions, 'bun');
const prevBun = versions.bun;
let prevConfig: string | undefined;

beforeEach(() => {
  prevConfig = process.env.MACRODATA_CONFIG_PATH;
  process.env.MACRODATA_CONFIG_PATH = '/nonexistent/config.json';
  resetEmbeddingConfigCache();
  resetLocalPipelineForTests();
  pipelineSpy.mockClear();
});

afterEach(() => {
  if (hadBun) versions.bun = prevBun;
  else delete versions.bun;
  if (prevConfig === undefined) delete process.env.MACRODATA_CONFIG_PATH;
  else process.env.MACRODATA_CONFIG_PATH = prevConfig;
  delete (globalThis as Record<symbol, unknown>)[ORT_SYMBOL];
  resetEmbeddingConfigCache();
  resetLocalPipelineForTests();
});

describe('resolveLocalEmbeddingDevice', () => {
  test('returns undefined under Node (native backend stays)', () => {
    delete versions.bun;
    expect(resolveLocalEmbeddingDevice()).toBeUndefined();
  });

  test('returns "auto" under Bun (NAPI addon must not load)', () => {
    versions.bun = '1.3.14';
    expect(resolveLocalEmbeddingDevice()).toBe('auto');
  });
});

describe('getEmbeddingPipeline device passthrough', () => {
  test('passes device "auto" to the pipeline under Bun', async () => {
    versions.bun = '1.3.14';
    await embed('anything');
    expect(pipelineSpy).toHaveBeenCalledWith(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      expect.objectContaining({ device: 'auto' }),
    );
  });

  test('omits device under Node', async () => {
    delete versions.bun;
    await embed('anything');
    const options = pipelineSpy.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).not.toHaveProperty('device');
  });
});
