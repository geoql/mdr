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

runDaemon();
