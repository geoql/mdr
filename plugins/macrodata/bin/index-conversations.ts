#!/usr/bin/env node
/**
 * Index conversations incrementally
 *
 * Called by hooks at session end / after compact to keep the conversation index fresh.
 */

import { updateConversationIndex } from "../src/conversations.js";

export async function main(
  update: typeof updateConversationIndex = updateConversationIndex
): Promise<number> {
  try {
    const result = await update();
    console.log(
      `Indexed conversations: ${result.filesUpdated} updated, ${result.skipped} skipped, ${result.exchangeCount} total`
    );
    return 0;
  } catch (err) {
    console.error("Failed to index conversations:", err);
    return 1;
  }
}

export function isRunAsMain(argv1: string | undefined, moduleUrl: string): boolean {
  return Boolean(argv1) && moduleUrl === `file://${argv1}`;
}

/* v8 ignore next 3 -- entry-point glue: only runs when this file is the process
   entry (node dist/bin/index-conversations.js), a subprocess vitest cannot
   instrument. main() and isRunAsMain() are covered directly. */
if (isRunAsMain(process.argv[1], import.meta.url)) {
  main().then((code) => process.exit(code));
}
