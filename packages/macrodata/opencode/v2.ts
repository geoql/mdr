/**
 * OpenCode 2 bridges for the dual entrypoint (#152).
 *
 * The shared plugin surface (tools, bundled skills, the models section of the
 * context) is defined once in V1 terms. These helpers project it onto the
 * `@opencode/plugin` API so `setup(ctx)` in index.ts stays a thin composition.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { Skill, type Location } from '@opencode/plugin';
import type {
  Info as V2ToolInfo,
  ToolContext as V2ToolContext,
} from '@opencode/plugin/promise/tool';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

type V1ToolContext = Parameters<ToolDefinition['execute']>[1];

/**
 * Project a V1 `tool()` definition onto a V2 tool. The effective name is kept
 * verbatim (skills and user memory reference `macrodata_*` by name), the zod
 * args object is passed as a Standard Schema input, and the V1 string/structured
 * result becomes V2 structured content. Nothing here reads the host at
 * transform time, so the registration is replayable.
 */
export function bridgeTool(
  name: string,
  definition: ToolDefinition,
  location: Location.Info,
): V2ToolInfo {
  return {
    name,
    description: definition.description,
    input: tool.schema.object(definition.args),
    async execute(input, context: V2ToolContext) {
      const result = await definition.execute(input, bridgeToolContext(context, location));
      return { content: typeof result === 'string' ? result : result.output };
    },
  };
}

function bridgeToolContext(context: V2ToolContext, location: Location.Info): V1ToolContext {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: location.directory,
    worktree: location.project.directory,
    abort: context.signal,
    metadata() {},
    ask() {
      return Promise.reject(new Error('tool.ask is not supported on the OpenCode 2 bridge'));
    },
  };
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Read the bundled `skills/<name>/SKILL.md` files into V2 skill definitions.
 * `name`/`description` come from the frontmatter (falling back to the directory
 * name); `content` is the body without the frontmatter block.
 */
export function loadBundledSkills(skillsDir: string): Skill.Info[] {
  if (!existsSync(skillsDir)) return [];

  const skills: Skill.Info[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(path)) continue;

    const raw = readFileSync(path, 'utf-8');
    const match = FRONTMATTER.exec(raw);
    const meta = new Map<string, string>();
    for (const line of match?.[1].split(/\r?\n/) ?? []) {
      const idx = line.indexOf(':');
      if (idx > 0) meta.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    const name = meta.get('name') || entry.name;
    const description = meta.get('description');
    const content = (match ? raw.slice(match[0].length) : raw).trim();

    skills.push(
      Skill.Info.make({
        id: Skill.ID.make(name),
        name: Skill.Name.make(name),
        ...(description ? { description } : {}),
        path: Skill.Info.fields.path.make(path),
        content,
      }),
    );
  }
  return skills;
}

/** The subset of a V2 `ctx.model.list()` record the models section needs. */
export interface ModelSummary {
  readonly id: string;
  readonly providerID: string;
  readonly family?: string;
  readonly time: { readonly released: number };
  readonly capabilities: { readonly tools: boolean };
}

/**
 * Render V2 `ctx.model.list()` output in the V1 `client.config.providers()`
 * shape that context.ts consumes for the models section.
 */
export function providersFromModels(
  models: readonly ModelSummary[],
): Array<{ id: string; models: Record<string, unknown> }> {
  const byProvider = new Map<string, Record<string, unknown>>();
  for (const model of models) {
    const provider = byProvider.get(model.providerID) ?? {};
    provider[model.id] = {
      family: model.family,
      release_date: new Date(model.time.released).toISOString().slice(0, 10),
      capabilities: { toolcall: model.capabilities.tools },
    };
    byProvider.set(model.providerID, provider);
  }
  return Array.from(byProvider, ([id, models]) => ({ id, models }));
}
