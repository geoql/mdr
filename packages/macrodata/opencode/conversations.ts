/**
 * OpenCode Conversation Indexer
 *
 * Indexes past OpenCode sessions for semantic search.
 * Reads from the OpenCode SQLite store under ~/.local/share/opencode/ — by
 * default `opencode.db`; `OPENCODE_DB` (as set by an `opencode2` launcher) or
 * `MACRODATA_OPENCODE_DB_PATH` override it.
 *
 * Two store generations exist and the reader unions both (#152):
 *
 *   OpenCode 1 ("v1")
 *   - session: id, project_id, parent_id, directory, time_created
 *   - message: id, session_id, time_created, data (JSON with role, agent, etc.)
 *   - part: id, message_id, session_id, data (JSON with type, text, etc.)
 *
 *   OpenCode 2 ("v2")
 *   - session_v2: id, project_id, parent_id, directory, time_created
 *   - session_message: id, session_id, type (user|assistant|…), seq, time_created,
 *     data (user: JSON with text; assistant: JSON with content[] parts)
 *
 *   Shared: project: id, worktree
 *
 * OpenCode 2 migrates a V1 store in place and KEEPS the V1 tables, and an
 * OpenCode 1 host on the same file keeps writing them afterwards — so the
 * presence of either generation says nothing about which one is live. Reading
 * both and deduping by message id is the only shape that never drops history.
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, basename, isAbsolute } from 'path';
import { homedir } from 'os';
import type { DatabaseSync } from 'node:sqlite';
import { LocalIndex, ProtobufCodec } from 'vectra';
import { embedBatch, embedQuery } from '../src/embeddings.js';
import { getStateRoot } from './context.js';
import { logger } from './logger.js';

/**
 * Resolve the OpenCode store path. `MACRODATA_OPENCODE_DB_PATH` wins; then
 * OpenCode's own `OPENCODE_DB` (absolute, or relative to its data dir — the
 * `opencode2` launcher sets `opencode2.db` to isolate the V2 store); then the
 * default `opencode.db`.
 */
export function resolveOpenCodeDbPath(
  env: Record<string, string | undefined>,
  dataDir: string,
): string {
  if (env.MACRODATA_OPENCODE_DB_PATH) return env.MACRODATA_OPENCODE_DB_PATH;
  const store = env.OPENCODE_DB || 'opencode.db';
  return isAbsolute(store) ? store : join(dataDir, store);
}

const OPENCODE_DB_PATH = resolveOpenCodeDbPath(
  process.env,
  join(homedir(), '.local', 'share', 'opencode'),
);

/**
 * Retention cap for the conversation index (#27).
 *
 * Vectra persists the whole index as ONE file rewritten via a single
 * serialized string, and V8 caps strings at 0x1fffffe8 (~536 MB). At ~20 KB
 * per item the old unbounded JSON index died at ~27k items. 22,000 items is
 * ~220 MB with the protobuf codec (~440 MB even as JSON) — comfortably under
 * the ceiling while keeping months of history.
 */
export const MAX_CONVERSATION_ITEMS = 22000;

/**
 * Keep only the newest `cap` exchanges. Rows arrive oldest-first (the query
 * orders by user_time ASC), so slicing from the end keeps the newest.
 */
export function capExchanges(
  exchanges: ConversationExchange[],
  cap: number = MAX_CONVERSATION_ITEMS,
): ConversationExchange[] {
  if (exchanges.length <= cap) return exchanges;
  return exchanges.slice(exchanges.length - cap);
}

/**
 * FIFO-evict the oldest items inside an open update transaction so the
 * persisted index never exceeds `cap` items. Items are insertion-ordered
 * (chronological for this index), so the head of `existingItems` is oldest.
 * Must be called between beginUpdate() and endUpdate(): deletions mutate the
 * pending update and persist in the same single rewrite as the inserts.
 * Returns the number of evicted items.
 */
export async function enforceRetentionCap(
  idx: LocalIndex,
  existingItems: { id: string }[],
  newCount: number,
  cap: number = MAX_CONVERSATION_ITEMS,
): Promise<number> {
  const overflow = existingItems.length + newCount - cap;
  if (overflow <= 0) return 0;

  const toEvict = existingItems.slice(0, overflow);
  for (const item of toEvict) {
    await idx.deleteItem(item.id);
  }
  logger.log(`Evicted ${toEvict.length} oldest exchanges to enforce the ${cap}-item cap`);
  return toEvict.length;
}

// Conversation index singleton
let convIndex: LocalIndex | null = null;

// Test seam: drop the cached index so a new MACRODATA_ROOT is picked up.
export function resetConversationIndexForTests(): void {
  convIndex = null;
}

async function getConversationIndex(): Promise<LocalIndex> {
  if (convIndex) return convIndex;

  const stateRoot = getStateRoot();
  const indexPath = join(stateRoot, '.index', 'oc-conversations');

  const indexDir = join(stateRoot, '.index');
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }

  // Protobuf codec: packed float32 vectors are ~50% smaller than JSON text,
  // and the binary file (index.pb) sidesteps the JSON codec that could no
  // longer read or write the index past V8's max string length (#27).
  convIndex = new LocalIndex(indexPath, undefined, undefined, new ProtobufCodec());

  // Drop the orphaned pre-protobuf index.json: past ~536 MB it is unreadable
  // by the JSON codec (#27), and after the codec switch it is dead weight.
  const legacyJsonPath = join(indexPath, 'index.json');
  if (existsSync(legacyJsonPath)) {
    logger.log('Removing orphaned legacy index.json (superseded by index.pb)...');
    rmSync(legacyJsonPath, { force: true });
  }

  if (!(await convIndex.isIndexCreated())) {
    logger.log('Creating new conversation index...');
    await convIndex.createIndex();
  }

  return convIndex;
}

export interface ConversationExchange {
  id: string;
  userPrompt: string;
  assistantSummary: string;
  project: string;
  projectPath: string;
  timestamp: string;
  sessionId: string;
  messageId: string;
}

export interface ConversationSearchResult {
  exchange: ConversationExchange;
  score: number;
  adjustedScore: number;
}

/**
 * Open the OpenCode SQLite database (read-only).
 *
 * `node:sqlite` is imported dynamically, NOT statically, and this is load-bearing.
 * OpenCode loads plugins in a runtime that has no `node:sqlite` built-in, so a
 * static top-level import fails at module-resolution time and takes the whole
 * plugin down with "Could not resolve: node:sqlite" — before any code runs.
 *
 * Only the two indexing paths (rebuild/update) ever call this; the read path
 * (`searchConversations`) is served entirely from the Vectra index. Deferring the
 * import to the call site keeps the plugin loadable everywhere, and confines the
 * failure to the indexing paths, which already degrade gracefully on `null`.
 *
 * See: https://github.com/geoql/mdr/issues/68
 */
async function openDb(): Promise<DatabaseSync | null> {
  if (!existsSync(OPENCODE_DB_PATH)) {
    logger.log(`OpenCode database not found at ${OPENCODE_DB_PATH}`);
    return null;
  }

  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(OPENCODE_DB_PATH, { readOnly: true });
  } catch (err) {
    logger.error(`Failed to open OpenCode database: ${String(err)}`);
    return null;
  }
}

interface ExchangeRow {
  user_msg_id: string;
  session_id: string;
  user_time: number;
  user_text: string;
  assistant_text: string;
  worktree: string | null;
  directory: string | null;
}

export interface StoreGenerations {
  /** OpenCode 1 tables (`session`, `message`, `part`) are present. */
  v1: boolean;
  /** OpenCode 2 tables (`session_v2`, `session_message`) are present. */
  v2: boolean;
}

/**
 * Detect which store generations the database carries. Both can be true on a
 * store OpenCode 2 migrated in place; neither means this is not an OpenCode
 * store at all.
 */
export function detectStoreGenerations(db: DatabaseSync): StoreGenerations {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as unknown as { name: string }[];
  const tables = new Set(rows.map((r) => r.name));
  return {
    v1: tables.has('session') && tables.has('message') && tables.has('part'),
    v2: tables.has('session_v2') && tables.has('session_message'),
  };
}

/**
 * Query exchanges from the SQLite database, across every store generation it
 * carries.
 *
 * Each generation query:
 * 1. Finds user messages
 * 2. Finds the next assistant message in the same session
 * 3. Aggregates text parts for both user and assistant messages
 * 4. Joins to project for worktree path
 * 5. Excludes subtask sessions (parent_id IS NULL)
 *
 * Rows are deduped by message id (OpenCode 2's in-place migration keeps ids),
 * V1 winning so already-indexed text never changes, then ordered by user time.
 *
 * Fails closed: a store with neither generation throws instead of returning
 * [], so a schema change can never be mistaken for "no new exchanges" (#25).
 */
export function queryExchanges(db: DatabaseSync, sinceMs?: number): ExchangeRow[] {
  const generations = detectStoreGenerations(db);
  if (!generations.v1 && !generations.v2) {
    const message =
      'OpenCode store has neither the OpenCode 2 tables (session_v2 + session_message) ' +
      'nor the OpenCode 1 tables (session + message + part); refusing to index';
    logger.error(message);
    throw new Error(message);
  }

  const seen = new Set<string>();
  const rows: ExchangeRow[] = [];
  const collect = (batch: ExchangeRow[]) => {
    for (const row of batch) {
      const key = `${row.session_id}:${row.user_msg_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  };

  if (generations.v1) collect(queryV1Exchanges(db, sinceMs));
  if (generations.v2) collect(queryV2Exchanges(db, sinceMs));

  return rows.sort((a, b) => a.user_time - b.user_time);
}

/**
 * OpenCode 2 store: user text lives inline in `data.text`; assistant text is
 * the `text` entries of `data.content[]`. Messages are ordered by `seq`.
 */
function queryV2Exchanges(db: DatabaseSync, sinceMs?: number): ExchangeRow[] {
  const whereClause = sinceMs ? 'AND m.time_created > ?' : '';
  const params = sinceMs ? [sinceMs] : [];

  const sql = `
    WITH user_messages AS (
      SELECT
        m.id AS user_msg_id,
        m.session_id,
        m.time_created AS user_time,
        COALESCE(json_extract(m.data, '$.text'), '') AS user_text,
        (
          SELECT am.id FROM session_message am
          WHERE am.session_id = m.session_id
            AND am.seq > m.seq
            AND am.type = 'assistant'
          ORDER BY am.seq ASC
          LIMIT 1
        ) AS assistant_msg_id
      FROM session_message m
      JOIN session_v2 s ON s.id = m.session_id
      WHERE m.type = 'user'
        AND s.parent_id IS NULL
        ${whereClause}
    )
    SELECT
      um.user_msg_id,
      um.session_id,
      um.user_time,
      um.user_text,
      COALESCE(
        (
          SELECT GROUP_CONCAT(json_extract(c.value, '$.text'), '\n')
          FROM session_message am, json_each(am.data, '$.content') c
          WHERE am.id = um.assistant_msg_id
            AND json_extract(c.value, '$.type') = 'text'
        ),
        ''
      ) AS assistant_text,
      p.worktree,
      s.directory
    FROM user_messages um
    JOIN session_v2 s ON s.id = um.session_id
    LEFT JOIN project p ON p.id = s.project_id
    WHERE um.assistant_msg_id IS NOT NULL
      AND um.user_text != ''
    ORDER BY um.user_time ASC
  `;

  return runExchangeQuery(db, sql, params);
}

function runExchangeQuery(db: DatabaseSync, sql: string, params: number[]): ExchangeRow[] {
  try {
    return db.prepare(sql).all(...params) as unknown as ExchangeRow[];
  } catch (err) {
    // Propagate instead of returning [] so callers can't mistake a schema
    // mismatch for "no new exchanges" (a silent no-op that previously
    // disabled indexing for weeks, see #25).
    logger.error(`Query failed: ${String(err)}`);
    throw err;
  }
}

/**
 * OpenCode 1 store: message roles live in `data.role`; text lives in the
 * `part` table joined by message id.
 */
function queryV1Exchanges(db: DatabaseSync, sinceMs?: number): ExchangeRow[] {
  // Interpolated inside the user_messages CTE body, where only `m` and `s`
  // are in scope (`um` is the outer query's alias and must not be used here).
  const whereClause = sinceMs ? 'AND m.time_created > ?' : '';
  const params = sinceMs ? [sinceMs] : [];

  // Get user-assistant pairs with their text content.
  // We use a CTE to match each user message with its subsequent assistant message,
  // then aggregate text parts for both.
  const sql = `
    WITH user_messages AS (
      SELECT
        m.id AS user_msg_id,
        m.session_id,
        m.time_created AS user_time,
        m.data AS user_data,
        -- Find the next assistant message by time in the same session
        (
          SELECT am.id FROM message am
          WHERE am.session_id = m.session_id
            AND am.time_created > m.time_created
            AND json_extract(am.data, '$.role') = 'assistant'
          ORDER BY am.time_created ASC
          LIMIT 1
        ) AS assistant_msg_id
      FROM message m
      JOIN session s ON s.id = m.session_id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND s.parent_id IS NULL
        ${whereClause}
    )
    SELECT
      um.user_msg_id,
      um.session_id,
      um.user_time,
      COALESCE(
        GROUP_CONCAT(
          CASE WHEN up.message_id = um.user_msg_id AND json_extract(up.data, '$.type') = 'text'
            THEN json_extract(up.data, '$.text')
          END,
          '\n'
        ),
        ''
      ) AS user_text,
      COALESCE(
        GROUP_CONCAT(
          CASE WHEN up.message_id = um.assistant_msg_id AND json_extract(up.data, '$.type') = 'text'
            THEN json_extract(up.data, '$.text')
          END,
          '\n'
        ),
        ''
      ) AS assistant_text,
      p.worktree,
      s.directory
    FROM user_messages um
    LEFT JOIN part up ON up.message_id IN (um.user_msg_id, um.assistant_msg_id)
    LEFT JOIN session s ON s.id = um.session_id
    LEFT JOIN project p ON p.id = s.project_id
    WHERE um.assistant_msg_id IS NOT NULL
    GROUP BY um.user_msg_id
    HAVING user_text != ''
    ORDER BY um.user_time ASC
  `;

  return runExchangeQuery(db, sql, params);
}

/**
 * Convert raw DB rows to ConversationExchange objects
 */
function rowsToExchanges(rows: ExchangeRow[]): ConversationExchange[] {
  return rows.map((row) => {
    // Use project worktree, but fall back to session directory for "global" sessions
    // where worktree is "/" (the root filesystem, not a real project)
    const worktree = row.worktree && row.worktree !== '/' ? row.worktree : '';
    const directory = row.directory || '';
    const projectPath = worktree || directory;
    const name = projectPath ? basename(projectPath) : '';
    const projectName = name || 'unknown';

    return {
      id: `oc-${row.session_id}-${row.user_msg_id}`,
      userPrompt: row.user_text.slice(0, 1000),
      assistantSummary: row.assistant_text.slice(0, 500),
      project: projectName,
      projectPath,
      timestamp: new Date(row.user_time).toISOString(),
      sessionId: row.session_id,
      messageId: row.user_msg_id,
    };
  });
}

// Guard against concurrent rebuilds
let rebuildInProgress: Promise<{ exchangeCount: number }> | null = null;

/**
 * Rebuild conversation index from scratch
 */
export async function rebuildConversationIndex(): Promise<{ exchangeCount: number }> {
  if (rebuildInProgress) {
    logger.log('Conversation index rebuild already in progress, waiting...');
    return rebuildInProgress;
  }

  rebuildInProgress = doRebuildConversationIndex();
  try {
    return await rebuildInProgress;
  } finally {
    rebuildInProgress = null;
  }
}

async function doRebuildConversationIndex(): Promise<{ exchangeCount: number }> {
  logger.log('Rebuilding OpenCode conversation index...');
  const startTime = Date.now();

  const db = await openDb();
  if (!db) return { exchangeCount: 0 };

  try {
    const rows = queryExchanges(db);
    const exchanges = capExchanges(rowsToExchanges(rows));

    logger.log(`Found ${exchanges.length} exchanges`);
    if (exchanges.length === 0) return { exchangeCount: 0 };

    // Generate all embeddings BEFORE touching the index
    const texts = exchanges.map((e) => e.userPrompt);
    logger.log(`Generating embeddings for ${texts.length} exchanges...`);
    const vectors = await embedBatch(texts);
    logger.log(`Embeddings generated, inserting into index...`);

    // Only delete after embeddings succeed
    // Reset singleton since deleteIndex invalidates the cached instance
    convIndex = null;
    const idx = await getConversationIndex();
    if (await idx.isIndexCreated()) {
      await idx.deleteIndex();
    }
    await idx.createIndex();

    // Batch inside a single update transaction: without it, vectra rewrites
    // the entire index.json on every upsert, which is O(n^2) and takes hours
    // for tens of thousands of items.
    await idx.beginUpdate();
    try {
      for (let i = 0; i < exchanges.length; i++) {
        const ex = exchanges[i];
        await idx.upsertItem({
          id: ex.id,
          vector: vectors[i],
          metadata: {
            userPrompt: ex.userPrompt,
            assistantSummary: ex.assistantSummary,
            project: ex.project,
            projectPath: ex.projectPath,
            timestamp: ex.timestamp,
            sessionId: ex.sessionId,
            messageId: ex.messageId,
          },
        });

        /* v8 ignore next 3 -- progress log that only fires past 500 indexed
           exchanges; seeding 500 real embedded rows per test is impractical and
           the line has no behavioural effect. */
        if (i > 0 && i % 500 === 0) {
          logger.log(`  ...inserted ${i}/${exchanges.length}`);
        }
      }
      await idx.endUpdate();
    } catch (err) {
      idx.cancelUpdate();
      throw err;
    }

    const duration = Date.now() - startTime;
    logger.log(`Conversation index rebuilt: ${exchanges.length} exchanges in ${duration}ms`);
    return { exchangeCount: exchanges.length };
  } catch (err) {
    logger.error(`Conversation index rebuild failed: ${String(err)}`);
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Time-based weight for scoring
 */
function getTimeWeight(timestamp: string): number {
  const ts = new Date(timestamp);
  if (isNaN(ts.getTime())) return 0.5;

  const age = Date.now() - ts.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (age < 7 * dayMs) return 1.0;
  if (age < 30 * dayMs) return 0.9;
  if (age < 90 * dayMs) return 0.7;
  if (age < 365 * dayMs) return 0.5;
  return 0.3;
}

/**
 * Search past conversations
 */
export async function searchConversations(
  query: string,
  options: {
    currentProject?: string;
    limit?: number;
    projectOnly?: boolean;
  } = {},
): Promise<ConversationSearchResult[]> {
  const { currentProject, limit = 5, projectOnly = false } = options;

  const idx = await getConversationIndex();
  const stats = await idx.listItems();

  if (stats.length === 0) {
    return [];
  }

  const queryVector = await embedQuery(query);
  const results = await idx.queryItems(queryVector, query, limit * 3);

  const searchResults: ConversationSearchResult[] = results.map((r) => {
    const meta = r.item.metadata as Record<string, string>;

    const exchange: ConversationExchange = {
      id: r.item.id,
      userPrompt: meta.userPrompt,
      assistantSummary: meta.assistantSummary,
      project: meta.project,
      projectPath: meta.projectPath,
      timestamp: meta.timestamp,
      sessionId: meta.sessionId,
      messageId: meta.messageId,
    };

    let adjustedScore = r.score;
    adjustedScore *= getTimeWeight(exchange.timestamp);

    if (currentProject && exchange.projectPath === currentProject) {
      adjustedScore *= 1.5;
    }

    return {
      exchange,
      score: r.score,
      adjustedScore,
    };
  });

  let filtered = searchResults;
  if (projectOnly && currentProject) {
    filtered = searchResults.filter((r) => r.exchange.projectPath === currentProject);
  }

  return filtered.sort((a, b) => b.adjustedScore - a.adjustedScore).slice(0, limit);
}

/**
 * Get conversation index stats
 */
export async function getConversationIndexStats(): Promise<{ exchangeCount: number }> {
  const idx = await getConversationIndex();
  const items = await idx.listItems();
  return { exchangeCount: items.length };
}

/**
 * Incrementally update conversation index (only new exchanges)
 */
export async function updateConversationIndex(): Promise<{ newCount: number; totalCount: number }> {
  logger.log('Updating OpenCode conversation index...');
  const startTime = Date.now();

  const db = await openDb();
  if (!db) return { newCount: 0, totalCount: 0 };

  try {
    const idx = await getConversationIndex();
    const existingItems = await idx.listItems();
    const existingIds = new Set(existingItems.map((item) => item.id));

    // Find the most recent timestamp in the index to narrow the query
    let latestMs = 0;
    for (const item of existingItems) {
      const meta = item.metadata as Record<string, string>;
      if (meta.timestamp) {
        const ms = new Date(meta.timestamp).getTime();
        if (ms > latestMs) latestMs = ms;
      }
    }

    // Query only exchanges after the latest indexed timestamp (with some overlap for safety)
    const sinceMs = latestMs > 0 ? latestMs - 60_000 : undefined;
    const rows = queryExchanges(db, sinceMs);
    const allExchanges = rowsToExchanges(rows);

    // Filter to truly new exchanges; cap BEFORE embedding so a huge backlog
    // (e.g. first index after #27) never embeds more than the index can hold.
    const newExchanges = capExchanges(allExchanges.filter((ex) => !existingIds.has(ex.id)));

    logger.log(`Found ${newExchanges.length} new exchanges (${existingIds.size} already indexed)`);

    if (newExchanges.length === 0) {
      return { newCount: 0, totalCount: existingIds.size };
    }

    const texts = newExchanges.map((e) => e.userPrompt);
    logger.log(`Generating embeddings for ${texts.length} new exchanges...`);
    const vectors = await embedBatch(texts);

    // Single update transaction: one index file write for the whole batch.
    // Eviction runs inside the same transaction so inserts + evictions land
    // in one rewrite and the file never exceeds the cap on disk (#27).
    let evicted = 0;
    await idx.beginUpdate();
    try {
      for (let i = 0; i < newExchanges.length; i++) {
        const ex = newExchanges[i];
        await idx.upsertItem({
          id: ex.id,
          vector: vectors[i],
          metadata: {
            userPrompt: ex.userPrompt,
            assistantSummary: ex.assistantSummary,
            project: ex.project,
            projectPath: ex.projectPath,
            timestamp: ex.timestamp,
            sessionId: ex.sessionId,
            messageId: ex.messageId,
          },
        });
      }
      evicted = await enforceRetentionCap(idx, existingItems, newExchanges.length);
      await idx.endUpdate();
    } catch (err) {
      idx.cancelUpdate();
      throw err;
    }

    const duration = Date.now() - startTime;
    const totalCount = existingIds.size + newExchanges.length - evicted;
    logger.log(`Added ${newExchanges.length} exchanges in ${duration}ms (total: ${totalCount})`);

    return { newCount: newExchanges.length, totalCount };
  } finally {
    db.close();
  }
}
