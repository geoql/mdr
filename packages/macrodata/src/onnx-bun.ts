/**
 * Bun-safe ONNX runtime selection.
 *
 * Under Bun (the OpenCode plugin host), the native `onnxruntime-node` NAPI
 * addon crashes the process at VM teardown:
 * `panic: NAPI FATAL ERROR: Error::New napi_create_error`.
 *
 * `@huggingface/transformers` reads `globalThis[Symbol.for('onnxruntime')]`
 * before it falls back to `onnxruntime-node`. This module injects the pure
 * WASM `onnxruntime-web` build through that hook when the process runs under
 * Bun. The NAPI addon then never loads there. Node processes (daemon, MCP
 * server, one-shot indexer) are not touched and keep the faster native
 * backend.
 *
 * `onnxruntime-web` is resolved through `@huggingface/transformers` on
 * purpose. It is a dependency of transformers, so the version always matches
 * what transformers expects, and this package needs no direct dependency.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const ORT_SYMBOL = Symbol.for('onnxruntime');

interface OrtWebModule {
  env: { wasm: { wasmPaths?: string; numThreads?: number } };
}

type ImportModule = (specifier: string) => Promise<OrtWebModule>;
type ResolveFrom = (from: string, specifier: string) => string;

const defaultImportModule: ImportModule = (specifier) =>
  import(specifier) as Promise<OrtWebModule>;

const defaultResolveFrom: ResolveFrom = (from, specifier) =>
  createRequire(from).resolve(specifier);

/** True when the current process runs under Bun. */
export function isBunRuntime(): boolean {
  return Boolean(process.versions.bun);
}

/**
 * Inject onnxruntime-web for Bun hosts. Returns true when the injection is
 * active (done now or done earlier), false on Node.
 */
export async function ensureBunSafeOnnxRuntime(
  importModule: ImportModule = defaultImportModule,
  resolveFrom: ResolveFrom = defaultResolveFrom,
): Promise<boolean> {
  if (!isBunRuntime()) {
    return false;
  }
  const g = globalThis as Record<symbol, unknown>;
  if (g[ORT_SYMBOL]) {
    return true;
  }
  const transformersEntry = resolveFrom(import.meta.url, '@huggingface/transformers');
  const ortEntry = resolveFrom(transformersEntry, 'onnxruntime-web');
  const ort = await importModule(pathToFileURL(ortEntry).href);
  ort.env.wasm.wasmPaths = pathToFileURL(`${dirname(ortEntry)}/`).href;
  // Single-thread avoids worker/SharedArrayBuffer differences under Bun.
  ort.env.wasm.numThreads = 1;
  g[ORT_SYMBOL] = ort;
  return true;
}
