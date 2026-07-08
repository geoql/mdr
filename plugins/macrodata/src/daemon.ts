/**
 * Macrodata Local Daemon (core logic)
 *
 * Handles scheduled tasks, file watching for index updates, and triggers
 * Claude Code or OpenCode via CLI when reminders fire.
 *
 * The `bin/macrodata-daemon.ts` entry is a thin wrapper around `runDaemon()`;
 * all logic lives here so it can be imported and unit-tested directly instead
 * of only through a spawned child process.
 *
 * Environment:
 *   MACRODATA_AGENT=opencode|claude  (default: auto-detect)
 *   MACRODATA_ROOT=/path/to/state
 *   MACRODATA_CHILD_TIMEOUT_MS=<ms>  (default: 10 minutes)
 */

import { watch } from "chokidar";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join, basename } from "path";
import { Cron } from "croner";
import { spawn, execSync } from "child_process";
import {
  getStateRoot,
  getEntitiesDir,
  getJournalDir,
  getIndexDir,
  getRemindersDir,
} from "./config.js";

// The indexing modules pull in @huggingface/transformers + vectra (multi-second
// import). Load them lazily so the daemon writes its PID file and starts
// scheduling immediately instead of blocking on heavy imports.
export async function loadIndexer() {
  return import("./indexer.js");
}

export async function loadConversationIndexers() {
  const [oc, cc] = await Promise.all([
    import("../opencode/conversations.js"),
    import("./conversations.js"),
  ]);
  return {
    updateOpenCodeConversations: oc.updateConversationIndex,
    updateClaudeCodeConversations: cc.updateConversationIndex,
  };
}

/**
 * Find an executable in PATH
 */
export async function findExecutable(name: string): Promise<string | null> {
  try {
    const result = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
    return result || null;
  } catch {
    return null;
  }
}

// Daemon-specific path helpers
// Use MACRODATA_ROOT for all daemon files (PID, log) to support testing with isolated directories
export function getDaemonDir() {
  return getStateRoot();
}

export function getPidFile() {
  return join(getDaemonDir(), ".daemon.pid");
}

export function getLogFile() {
  return join(getDaemonDir(), ".daemon.log");
}

export function getPendingContext() {
  return join(getStateRoot(), ".pending-context");
}

export function getHeartbeatFile() {
  return join(getDaemonDir(), ".daemon.heartbeat");
}

export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Resolve the per-child hard timeout from the environment. Re-read each call so
 * tests can flip MACRODATA_CHILD_TIMEOUT_MS without reloading the module.
 */
export function getChildTimeoutMs(): number {
  const raw = process.env.MACRODATA_CHILD_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60_000;
}

export interface Schedule {
  id: string;
  type: "cron" | "once";
  expression: string; // cron expression or ISO datetime
  description: string;
  payload: string;
  agent?: "opencode" | "claude"; // Which agent to trigger
  model?: string; // Optional model override (e.g., "anthropic/claude-opus-4-6")
  createdAt: string;
}

export function log(message: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  appendFileSync(getLogFile(), line);
}

export function logError(message: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ERROR: ${message}\n`;
  appendFileSync(getLogFile(), line);
}

export function writePendingContext(message: string) {
  try {
    appendFileSync(getPendingContext(), message + "\n");
  } catch (err) {
    logError(`Failed to write pending context: ${String(err)}`);
  }
}

/**
 * Trigger an agent with a message
 */
export async function triggerAgent(
  agent: "opencode" | "claude" | undefined,
  message: string,
  options: { model?: string; description?: string } = {},
): Promise<boolean> {
  if (!agent) {
    log("No agent specified in schedule, skipping trigger");
    return false;
  }

  const timestamp = new Date().toLocaleString();
  const fullMessage = `[Scheduled reminder: ${options.description || "reminder"}]
Current time: ${timestamp}

IMPORTANT: Use the macrodata_* tools (e.g., macrodata_log_journal, macrodata_search_memory) for memory operations. You are running in a non-interactive scheduled context.

${message}`;

  try {
    if (agent === "opencode") {
      // opencode run "message" --model provider/model
      const args = ["run", fullMessage];
      if (options.model) {
        args.push("--model", options.model);
      }

      // Find opencode in PATH or use npx as fallback
      const opencodePath = (await findExecutable("opencode")) || "npx";
      const finalArgs = opencodePath === "npx" ? ["opencode", ...args] : args;

      log(`Triggering OpenCode: ${opencodePath} ${finalArgs.join(" ").substring(0, 50)}...`);

      spawnSupervisedChild(opencodePath, finalArgs, "opencode");

      return true;
    } else {
      // claude --print "message" or claude -p "message"
      const args = ["--print", fullMessage];

      log(`Triggering Claude Code: claude --print "..."`);

      spawnSupervisedChild("claude", args, "claude");

      return true;
    }
  } catch (err) {
    logError(`Failed to trigger ${agent}: ${String(err)}`);
  }

  return false;
}

/**
 * Spawn an agent child process with a hard timeout so a hung child can never
 * wedge the daemon's scheduling (#25). The child runs in its own process
 * group; on timeout the whole group is killed and the daemon keeps running.
 */
export function spawnSupervisedChild(command: string, args: string[], label: string) {
  const childTimeoutMs = getChildTimeoutMs();
  const proc = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, PATH: process.env.PATH },
  });

  proc.unref();

  const killTimer = setTimeout(() => {
    log(`[${label}] child exceeded ${childTimeoutMs}ms timeout, killing process group ${proc.pid}`);
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Child already gone
        }
      }
    }
  }, childTimeoutMs);
  killTimer.unref();

  proc.stdout?.on("data", (data) => {
    log(`[${label} stdout] ${data.toString().trim()}`);
  });
  proc.stderr?.on("data", (data) => {
    log(`[${label} stderr] ${data.toString().trim()}`);
  });
  proc.on("error", (err) => {
    clearTimeout(killTimer);
    logError(`[${label}] child process error: ${String(err)}`);
  });
  proc.on("exit", (code, signal) => {
    clearTimeout(killTimer);
    log(`[${label}] child exited (code=${code}, signal=${signal})`);
  });

  return proc;
}

export function ensureDirectories() {
  const entitiesDir = getEntitiesDir();
  const dirs = [
    getDaemonDir(),
    getStateRoot(),
    getIndexDir(),
    entitiesDir,
    getJournalDir(),
    getRemindersDir(),
    join(entitiesDir, "people"),
    join(entitiesDir, "projects"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log(`Created directory: ${dir}`);
    }
  }
}

export async function updateAllConversationIndexes(
  loaders: () => Promise<{
    updateClaudeCodeConversations: () => Promise<{ filesUpdated: number; exchangeCount: number }>;
    updateOpenCodeConversations: () => Promise<{ newCount: number; totalCount: number }>;
  }> = loadConversationIndexers,
) {
  const { updateClaudeCodeConversations, updateOpenCodeConversations } = await loaders();

  // Update Claude Code conversations
  try {
    const claude = await updateClaudeCodeConversations();
    if (claude.filesUpdated > 0) {
      log(
        `Claude Code conversations: +${claude.filesUpdated} files (${claude.exchangeCount} total)`,
      );
    }
  } catch (err) {
    logError(`Claude Code conversation index failed: ${String(err)}`);
  }

  // Update OpenCode conversations
  try {
    const opencode = await updateOpenCodeConversations();
    if (opencode.newCount > 0) {
      log(`OpenCode conversations: +${opencode.newCount} (${opencode.totalCount} total)`);
    }
  } catch (err) {
    logError(`OpenCode conversation index failed: ${String(err)}`);
  }
}

export function loadAllSchedules(): Schedule[] {
  const remindersDir = getRemindersDir();
  const schedules: Schedule[] = [];

  try {
    if (!existsSync(remindersDir)) return schedules;

    const files = readdirSync(remindersDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = readFileSync(join(remindersDir, file), "utf-8");
        const schedule = JSON.parse(content) as Schedule;
        schedules.push(schedule);
      } catch (err) {
        logError(`Failed to load schedule ${file}: ${String(err)}`);
      }
    }
  } catch (err) {
    logError(`Failed to read reminders directory: ${String(err)}`);
  }

  return schedules;
}

export function saveSchedule(schedule: Schedule) {
  const remindersDir = getRemindersDir();
  const filePath = join(remindersDir, `${schedule.id}.json`);

  try {
    writeFileSync(filePath, JSON.stringify(schedule, null, 2));
  } catch (err) {
    logError(`Failed to save schedule ${schedule.id}: ${String(err)}`);
  }
}

export function deleteScheduleFile(id: string) {
  const remindersDir = getRemindersDir();
  const filePath = join(remindersDir, `${id}.json`);

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err) {
    logError(`Failed to delete schedule file ${id}: ${String(err)}`);
  }
}

export interface DaemonOptions {
  // Overridable so tests skip the multi-second model import + real-history scan.
  backgroundIndexing?: () => Promise<void>;
  // Overridable indexer loader for the reindex queue (injectable failures).
  indexerLoader?: () => Promise<{ indexEntityFile: (path: string) => Promise<void> }>;
}

export async function defaultBackgroundIndexing(
  deps: {
    loadIndexer?: () => Promise<{ preloadModel: () => Promise<void> }>;
    updateAll?: typeof updateAllConversationIndexes;
  } = {},
): Promise<void> {
  const load = deps.loadIndexer ?? loadIndexer;
  const updateAll = deps.updateAll ?? updateAllConversationIndexes;
  const indexer = await load();
  await indexer.preloadModel();
  log("Embedding model preloaded");
  await updateAll();
}

export class MacrodataLocalDaemon {
  private cronJobs: Map<string, Cron> = new Map();
  private watcher: ReturnType<typeof watch> | null = null;
  private schedulesWatcher: ReturnType<typeof watch> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldRun = true;
  private backgroundIndexing: () => Promise<void>;
  private indexerLoader: () => Promise<{ indexEntityFile: (path: string) => Promise<void> }>;

  constructor(options: DaemonOptions = {}) {
    this.backgroundIndexing = options.backgroundIndexing ?? defaultBackgroundIndexing;
    this.indexerLoader = options.indexerLoader ?? loadIndexer;
  }

  async start() {
    log("Starting macrodata local daemon");
    log(`State root: ${getStateRoot()}`);

    // Check if already running
    ensureDirectories();
    const pidFile = getPidFile();
    if (existsSync(pidFile)) {
      const existingPid = readFileSync(pidFile, "utf-8").trim();
      try {
        process.kill(parseInt(existingPid, 10), 0); // Check if process exists
        log(`Daemon already running (PID ${existingPid}), exiting`);
        process.exit(0);
      } catch {
        // Process doesn't exist, stale PID file - continue startup
        log(`Removing stale PID file (was ${existingPid})`);
      }
    }

    // Write PID file
    writeFileSync(pidFile, process.pid.toString());

    // Set up signal handlers
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    process.on("SIGINT", () => this.shutdown("SIGINT"));
    process.on("SIGHUP", () => this.reload());

    // The daemon must be hard to stop: a failed child, watcher error, or
    // rejected background promise should be logged, never fatal (#25).
    process.on("unhandledRejection", (reason) => {
      logError(`Unhandled rejection (daemon continues): ${String(reason)}`);
    });
    process.on("uncaughtException", (err) => {
      logError(`Uncaught exception (daemon continues): ${String(err?.stack || err)}`);
    });

    // Preload embedding model and update conversation indexes in background
    this.backgroundIndexing().catch((err) => logError(`Failed to preload/index: ${err}`));

    // Load and start schedules
    this.loadAndStartSchedules();

    // Watch for schedule changes
    this.watchRemindersDir();

    // Start file watcher for entity changes
    this.startFileWatcher();

    // Heartbeat lets the plugin detect a dead/stale daemon and restart it
    this.startHeartbeat();

    // Keep process alive
    log("Daemon running");
  }

  private startHeartbeat() {
    const beat = () => {
      try {
        writeFileSync(getHeartbeatFile(), Date.now().toString());
      } catch (err) {
        logError(`Heartbeat write failed: ${String(err)}`);
      }
    };
    beat();
    this.heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  }

  private watchRemindersDir() {
    const remindersDir = getRemindersDir();
    log(`Watching for reminders in: ${remindersDir}`);

    this.schedulesWatcher = watch(remindersDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });

    this.schedulesWatcher.on("add", (path) => {
      if (!path.endsWith(".json")) return;
      log(`Reminder added: ${basename(path)}`);
      this.reloadSchedules();
      try {
        const schedule = JSON.parse(readFileSync(path, "utf-8")) as Schedule;
        writePendingContext(
          `<macrodata-update type="schedule-added" id="${schedule.id}">${schedule.description}</macrodata-update>`,
        );
      } catch {
        // Ignore unreadable/malformed reminder writes
      }
    });

    this.schedulesWatcher.on("error", (err) => {
      logError(`Reminders watcher error: ${String(err)}`);
    });

    this.schedulesWatcher.on("change", (path) => {
      if (!path.endsWith(".json")) return;
      log(`Reminder changed: ${basename(path)}`);
      this.reloadSchedules();
      try {
        const schedule = JSON.parse(readFileSync(path, "utf-8")) as Schedule;
        writePendingContext(
          `<macrodata-update type="schedule-updated" id="${schedule.id}">${schedule.description}</macrodata-update>`,
        );
      } catch {
        // Ignore unreadable/malformed reminder writes
      }
    });

    this.schedulesWatcher.on("unlink", (path) => this.onReminderUnlinked(path));
  }

  private onReminderUnlinked(path: string) {
    if (!path.endsWith(".json")) return;
    const id = basename(path, ".json");
    log(`Reminder removed: ${id}`);
    writePendingContext(`<macrodata-update type="schedule-removed" id="${id}" />`);
    if (this.cronJobs.has(id)) {
      this.stopJob(id);
      log(`Stopped job: ${id}`);
    }
  }

  private scheduleFor(schedule: Schedule) {
    if (schedule.type === "cron") {
      this.startCronJob(schedule);
      return;
    }
    if (schedule.type === "once") {
      if (new Date(schedule.expression).getTime() > Date.now()) {
        this.startOnceJob(schedule);
      } else {
        log(`Skipping expired one-shot: ${schedule.id}`);
        this.removeSchedule(schedule.id);
      }
    }
  }

  private stopJob(id: string) {
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }
  }

  reloadSchedules() {
    const schedules = loadAllSchedules();
    const currentIds = new Set(this.cronJobs.keys());

    for (const schedule of schedules) {
      if (currentIds.has(schedule.id)) {
        currentIds.delete(schedule.id);
        continue;
      }
      this.scheduleFor(schedule);
    }

    for (const id of currentIds) {
      this.stopJob(id);
      log(`Stopped removed job: ${id}`);
    }
  }

  loadAndStartSchedules() {
    for (const schedule of loadAllSchedules()) {
      this.scheduleFor(schedule);
    }
  }

  private startCronJob(schedule: Schedule) {
    try {
      const job = new Cron(schedule.expression, () => {
        void this.fireSchedule(schedule);
      });
      this.cronJobs.set(schedule.id, job);
      log(`Started cron job: ${schedule.id} (${schedule.expression})`);
    } catch (err) {
      logError(`Failed to start cron job ${schedule.id}: ${String(err)}`);
    }
  }

  private startOnceJob(schedule: Schedule) {
    try {
      const fireTime = new Date(schedule.expression);
      const job = new Cron(fireTime, () => {
        void this.fireSchedule(schedule);
        // Remove one-shot after firing
        this.removeSchedule(schedule.id);
      });
      this.cronJobs.set(schedule.id, job);
      log(`Scheduled one-shot: ${schedule.id} at ${schedule.expression}`);
    } catch (err) {
      log(`Failed to schedule one-shot ${schedule.id}: ${String(err)}`);
    }
  }

  async fireSchedule(schedule: Schedule) {
    log(`Firing schedule: ${schedule.id} - ${schedule.description}`);

    // Trigger the agent specified in the schedule
    const triggered = await triggerAgent(schedule.agent, schedule.payload, {
      model: schedule.model,
      description: schedule.description,
    });

    if (triggered) {
      log(`Successfully triggered ${schedule.agent} for: ${schedule.id}`);
    } else if (schedule.agent) {
      log(`Failed to trigger ${schedule.agent} for: ${schedule.id}`);
    } else {
      log(`No agent specified for: ${schedule.id} (pending context written)`);
    }
  }

  addSchedule(schedule: Schedule) {
    // Save to individual file
    saveSchedule(schedule);

    // Start the job
    if (schedule.type === "cron") {
      this.startCronJob(schedule);
    } else {
      this.startOnceJob(schedule);
    }
  }

  removeSchedule(id: string) {
    this.stopJob(id);
    deleteScheduleFile(id);
    log(`Removed schedule: ${id}`);
  }

  private startFileWatcher() {
    const stateRoot = getStateRoot();
    const entitiesDir = getEntitiesDir();
    const stateDir = join(stateRoot, "state");

    // Watch both state files and entities
    this.watcher = watch([stateDir, entitiesDir], {
      ignoreInitial: true,
      persistent: true,
    });

    this.watcher.on("all", (event, path) => this.onWatchedFileEvent(event, path));

    log(`Watching for state/entity changes in: ${stateRoot}`);
  }

  onWatchedFileEvent(event: string, path: string) {
    if (!path.endsWith(".md")) return;
    if (event !== "add" && event !== "change") return;

    log(`File ${event}: ${path}`);

    const stateDir = join(getStateRoot(), "state");
    const entitiesDir = getEntitiesDir();

    if (path.startsWith(stateDir)) {
      this.injectStateFileDelta(path);
    } else if (path.startsWith(entitiesDir)) {
      const relative = path.slice(entitiesDir.length + 1);
      writePendingContext(`<macrodata-update type="entity" file="${relative}" />`);
      this.queueReindex(path);
    }
  }

  private injectStateFileDelta(path: string) {
    try {
      const raw = readFileSync(path, "utf-8");
      const cap = 4000;
      // Cap the injected delta so a mid-session write can't blow the budget.
      const content =
        raw.length > cap
          ? `${raw.slice(0, cap)}\n[…truncated: ${cap} of ${raw.length} chars. This file is over budget — compact it.]`
          : raw;
      writePendingContext(
        `<macrodata-update type="state" file="${basename(path)}">\n${content}\n</macrodata-update>`,
      );
    } catch {
      // Ignore unreadable state file
    }
  }

  private reindexQueue: Set<string> = new Set();
  private reindexTimer: ReturnType<typeof setTimeout> | null = null;

  queueReindex(path: string) {
    this.reindexQueue.add(path);

    // Debounce: wait 1 second for more changes before reindexing
    if (this.reindexTimer) {
      clearTimeout(this.reindexTimer);
    }
    this.reindexTimer = setTimeout(() => {
      void this.processReindexQueue();
    }, 1000);
  }

  async processReindexQueue() {
    if (this.reindexQueue.size === 0) return;

    const paths = Array.from(this.reindexQueue);
    this.reindexQueue.clear();

    log(`Reindexing ${paths.length} file(s)`);
    const indexer = await this.indexerLoader();
    for (const path of paths) {
      try {
        await indexer.indexEntityFile(path);
        log(`  ✓ ${basename(path)}`);
      } catch (err) {
        log(`  ✗ ${basename(path)}: ${String(err)}`);
      }
    }
  }

  reload() {
    log("Reloading config (SIGHUP)");
    log(`New state root: ${getStateRoot()}`);

    // Stop existing watchers
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    if (this.schedulesWatcher) {
      void this.schedulesWatcher.close();
      this.schedulesWatcher = null;
    }

    // Stop all cron jobs
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();

    // Ensure directories exist with new paths
    ensureDirectories();

    // Restart everything with new paths
    this.loadAndStartSchedules();
    this.watchRemindersDir();
    this.startFileWatcher();

    log("Reload complete");
  }

  shutdown(signal: string) {
    log(`Shutting down (${signal})`);
    this.shouldRun = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Stop all cron jobs
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();

    // Stop file watchers
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    if (this.schedulesWatcher) {
      void this.schedulesWatcher.close();
      this.schedulesWatcher = null;
    }

    // Clean up PID file
    try {
      const pidFile = getPidFile();
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, "utf-8").trim();
        if (pid === process.pid.toString()) {
          unlinkSync(pidFile);
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    process.exit(0);
  }

  /** Test-only accessor: whether the daemon considers itself running. */
  get running(): boolean {
    return this.shouldRun;
  }

  /** Test-only accessor: number of active cron jobs. */
  get jobCount(): number {
    return this.cronJobs.size;
  }

  /** Test-only accessor: the reminders-directory watcher, for error injection. */
  get remindersWatcher(): ReturnType<typeof watch> | null {
    return this.schedulesWatcher;
  }
}

/**
 * Entrypoint used by bin/macrodata-daemon.ts.
 */
export function runDaemon(): MacrodataLocalDaemon {
  const daemon = new MacrodataLocalDaemon();
  daemon.start().catch((err) => {
    log(`Fatal error: ${err}`);
    process.exit(1);
  });
  return daemon;
}
