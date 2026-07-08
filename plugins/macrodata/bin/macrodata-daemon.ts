#!/usr/bin/env node
/**
 * Macrodata Local Daemon entry point.
 *
 * All logic lives in `src/daemon.ts` (importable and unit-tested). This file is
 * a thin CLI wrapper so the compiled `dist/bin/macrodata-daemon.js` stays the
 * spawn target for the plugin and hook script.
 *
 * Usage:
 *   MACRODATA_ROOT=~/.config/macrodata node macrodata-daemon.js
 *
 * Environment:
 *   MACRODATA_AGENT=opencode|claude  (default: auto-detect)
 *   MACRODATA_ROOT=/path/to/state
 */

import { runDaemon } from "../src/daemon.js";

export function isRunAsMain(argv1: string | undefined, moduleUrl: string): boolean {
  return Boolean(argv1) && moduleUrl === `file://${argv1}`;
}

/* v8 ignore next 3 -- entry-point glue: only runs when this file is the process
   entry (node dist/bin/macrodata-daemon.js), a subprocess vitest cannot
   instrument. runDaemon() is covered directly in the daemon tests. */
if (isRunAsMain(process.argv[1], import.meta.url)) {
  runDaemon();
}
