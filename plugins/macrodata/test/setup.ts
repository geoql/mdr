/**
 * Global test setup — hermeticity guard.
 *
 * Several tests exercise code paths that call `getRemoteEmbeddingConfig()`,
 * which reads `~/.config/macrodata/config.json` when `MACRODATA_CONFIG_PATH`
 * is unset. On a developer machine that has a real remote-embedding config
 * (PR #36), those tests would otherwise hit a live API — flaky, and prone to
 * 429s. Default the config path to a nonexistent file before every test so the
 * suite always resolves to the local, offline embedding model unless a test
 * explicitly opts in by setting its own `MACRODATA_CONFIG_PATH`.
 */
import { beforeEach } from "vitest";

const HERMETIC_CONFIG_PATH = "/nonexistent/macrodata-test/config.json";

beforeEach(() => {
  process.env.MACRODATA_CONFIG_PATH = HERMETIC_CONFIG_PATH;
});
