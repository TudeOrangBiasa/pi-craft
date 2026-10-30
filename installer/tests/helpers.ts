import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const INSTALLER = join(import.meta.dir, "..", "install.ts");

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Stub {
  dir: string;
  log: string;
}

// Disposable Pi home. Every installer run in these tests points here —
// never at the live home.
export function makePiHome(): string {
  return mkdtempSync(join(tmpdir(), "pi-install-test-"));
}

// Fake `bun` for PATH: answers `bun install --cwd <dest>` by creating
// node_modules and logging the invocation. The installer itself is spawned
// via process.execPath, so the stub only affects its child calls.
export function makeStub(): Stub {
  const dir = mkdtempSync(join(tmpdir(), "pi-install-stub-"));
  const log = join(dir, "installs.log");
  writeFileSync(log, "");
  writeFileSync(
    join(dir, "bun"),
    '#!/bin/sh\nif [ "$1" = "install" ] && [ "$2" = "--cwd" ]; then\n  mkdir -p "$3/node_modules"\n  echo "$3" >> "$FAKE_BUN_LOG"\nfi\nexit 0\n',
    { mode: 0o755 },
  );
  return { dir, log };
}

export function runInstaller(home: string, args: readonly string[], stub: Stub): RunResult {
  const proc = Bun.spawnSync([process.execPath, INSTALLER, ...args], {
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: home,
      PATH: `${stub.dir}:${process.env.PATH ?? ""}`,
      FAKE_BUN_LOG: stub.log,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export function assertOk(run: RunResult): void {
  if (run.exitCode !== 0) throw new Error(`installer exited ${run.exitCode}: ${run.stderr}`);
}

export function installLog(stub: Stub): string[] {
  const text = readFileSync(stub.log, "utf-8");
  return text === "" ? [] : text.trimEnd().split("\n");
}

// relpath + sha256 of every file under root, serialized for equality.
export function snapshotTree(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        rows.push(
          `${relative(root, full)} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`,
        );
      }
    }
  };
  walk(root);
  return rows.join("\n");
}

export function removedLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.startsWith("removed package: "));
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}
