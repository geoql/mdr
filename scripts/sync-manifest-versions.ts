/**
 * Sync the published package version into manifests that release-please's
 * per-package `extra-files` cannot reach.
 *
 * release-please bumps `plugins/macrodata/package.json`, and via `extra-files`
 * it also bumps `plugins/macrodata/.claude-plugin/plugin.json` and
 * `plugins/macrodata/jsr.json`. The root Claude Code marketplace manifest
 * (`.claude-plugin/marketplace.json`) lives outside the package directory, so
 * it is synced here from the canonical package version.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync('plugins/macrodata/package.json', 'utf-8'),
);
const { version } = pkg;

const marketplacePath = '.claude-plugin/marketplace.json';
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'));
if (marketplace.plugins?.[0]) {
  marketplace.plugins[0].version = version;
  writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, '\t')}\n`);
  console.log(`Synced ${marketplacePath} to version ${version}`);
}
