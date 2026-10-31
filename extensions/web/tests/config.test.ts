import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWebConfig,
  redactCredential,
  resolveCredential,
  webConfigPath,
} from "../src/config.js";
import { withEnv } from "./helpers/fake-pi.js";

let scratch: string | undefined;

afterEach(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

function useScratchConfig(config: Record<string, unknown>): string {
  scratch = mkdtempSync(join(tmpdir(), "web-config-"));
  writeFileSync(join(scratch, "web-search.json"), JSON.stringify(config));
  return scratch;
}

describe("web config", () => {
  test("missing file means empty config, bad json throws", async () => {
    await withEnv(
      { PI_CODING_AGENT_DIR: join(tmpdir(), "web-no-such-dir"), XDG_CONFIG_HOME: undefined },
      async () => {
        expect(loadWebConfig()).toEqual({});
      },
    );
    const dir = mkdtempSync(join(tmpdir(), "web-bad-"));
    scratch = dir;
    writeFileSync(join(dir, "web-search.json"), "{oops");
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(() => loadWebConfig()).toThrow("Failed to parse");
    });
  });

  test("env var wins over config file", async () => {
    const dir = useScratchConfig({ exaApiKey: "from-file" });
    await withEnv({ PI_CODING_AGENT_DIR: dir, EXA_API_KEY: "from-env" }, async () => {
      expect(resolveCredential("exaApiKey", "EXA_API_KEY")).toBe("from-env");
    });
    await withEnv({ PI_CODING_AGENT_DIR: dir, EXA_API_KEY: undefined }, async () => {
      expect(resolveCredential("exaApiKey", "EXA_API_KEY")).toBe("from-file");
    });
  });

  test("$NAME config values read that env var, empty env is ignored", async () => {
    const dir = useScratchConfig({ exaApiKey: "$MY_EXA_KEY" });
    await withEnv(
      { PI_CODING_AGENT_DIR: dir, EXA_API_KEY: undefined, MY_EXA_KEY: "indirect" },
      async () => {
        expect(resolveCredential("exaApiKey", "EXA_API_KEY")).toBe("indirect");
      },
    );
    const dir2 = useScratchConfig({ exaApiKey: "file-wins" });
    await withEnv({ PI_CODING_AGENT_DIR: dir2, EXA_API_KEY: "  " }, async () => {
      expect(resolveCredential("exaApiKey", "EXA_API_KEY")).toBe("file-wins");
    });
  });

  test("webConfigPath honors PI_CODING_AGENT_DIR", async () => {
    await withEnv({ PI_CODING_AGENT_DIR: "/tmp/pi-test-dir" }, async () => {
      expect(webConfigPath()).toBe("/tmp/pi-test-dir/web-search.json");
    });
  });

  test("redactCredential scrubs every occurrence, null is a no-op", () => {
    expect(redactCredential("key abc key", "abc")).toBe("key [redacted] key");
    expect(redactCredential("untouched", null)).toBe("untouched");
  });
});
