/**
 * Covers onnx-bun.ts: the Bun-host guard that injects onnxruntime-web
 * through the transformers ORT_SYMBOL hook, so the native onnxruntime-node
 * NAPI addon never loads under Bun.
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import { ensureBunSafeOnnxRuntime, isBunRuntime } from '../src/onnx-bun';

const ORT_SYMBOL = Symbol.for('onnxruntime');
const versions = process.versions as Record<string, string | undefined>;
const hadBun = Object.prototype.hasOwnProperty.call(versions, 'bun');
const prevBun = versions.bun;
const g = globalThis as Record<symbol, unknown>;

afterEach(() => {
  if (hadBun) versions.bun = prevBun;
  else delete versions.bun;
  delete g[ORT_SYMBOL];
});

function fakes() {
  const ort = { env: { wasm: {} as { wasmPaths?: string; numThreads?: number } } };
  const importModule = vi.fn(async () => ort);
  const resolveFrom = vi.fn((_from: string, spec: string) =>
    spec === '@huggingface/transformers'
      ? '/fake/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
      : '/fake/node_modules/onnxruntime-web/dist/ort.node.min.mjs',
  );
  return { ort, importModule, resolveFrom };
}

describe('isBunRuntime', () => {
  test('false under Node', () => {
    delete versions.bun;
    expect(isBunRuntime()).toBe(false);
  });

  test('true under Bun', () => {
    versions.bun = '1.3.14';
    expect(isBunRuntime()).toBe(true);
  });
});

describe('ensureBunSafeOnnxRuntime', () => {
  test('no-op under Node', async () => {
    delete versions.bun;
    const { importModule, resolveFrom } = fakes();
    await expect(ensureBunSafeOnnxRuntime(importModule, resolveFrom)).resolves.toBe(false);
    expect(importModule).not.toHaveBeenCalled();
    expect(g[ORT_SYMBOL]).toBeUndefined();
  });

  test('injects ort-web under Bun and configures wasm env', async () => {
    versions.bun = '1.3.14';
    const { ort, importModule, resolveFrom } = fakes();
    await expect(ensureBunSafeOnnxRuntime(importModule, resolveFrom)).resolves.toBe(true);
    expect(g[ORT_SYMBOL]).toBe(ort);
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.wasmPaths).toMatch(/^file:\/\/.*onnxruntime-web\/dist\/$/);
    expect(resolveFrom).toHaveBeenCalledWith(expect.any(String), '@huggingface/transformers');
    expect(resolveFrom).toHaveBeenCalledWith(
      '/fake/node_modules/@huggingface/transformers/dist/transformers.node.mjs',
      'onnxruntime-web',
    );
  });

  test('second call is a no-op (symbol already set)', async () => {
    versions.bun = '1.3.14';
    const { importModule, resolveFrom } = fakes();
    await ensureBunSafeOnnxRuntime(importModule, resolveFrom);
    await expect(ensureBunSafeOnnxRuntime(importModule, resolveFrom)).resolves.toBe(true);
    expect(importModule).toHaveBeenCalledTimes(1);
  });
});
