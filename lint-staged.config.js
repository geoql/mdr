// oxlint and oxfmt are dev-deps of the plugin package, so their binaries live
// in packages/macrodata/node_modules/.bin (invoked directly — never through
// vite-plus, which is not used in this repo).
//
// We run oxlint --fix on staged TypeScript only. oxfmt is intentionally NOT
// wired in here: the shipped source predates any oxfmt pass, and the JSON
// manifests (package.json, plugin.json, marketplace.json) use tabs by
// deliberate house style that oxfmt would rewrite. Formatting is available
// on demand via `pnpm run format`, but is not enforced on commit.
const OXLINT = './packages/macrodata/node_modules/.bin/oxlint';

const ignorePatterns = [
  /(?:^|\/)CHANGELOG\.md$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)dist\//,
];

const isIgnored = (file) =>
  ignorePatterns.some((pattern) => pattern.test(file));

export default {
  '*.ts': (files) => {
    const filtered = files.filter((f) => !isIgnored(f));
    return filtered.length > 0 ? [`${OXLINT} --fix ${filtered.join(' ')}`] : [];
  },
};
