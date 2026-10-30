/** Keep-behavior: worktree isolation creates its branch and cleans up. */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cleanupWorktree, createWorktree } from "../src/worktree.js";
import { createGitExec } from "./helpers/fake-harness.js";

const hasGit = Bun.which("git") !== null;

async function initRepo(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "subagents-wt-repo-"));
	const exec = createGitExec() as (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<any>;
	const git = (args: string[]) => exec("git", args, { cwd: dir });
	const check = async (args: string[]) => {
		const result = await git(args);
		if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
		return result;
	};
	await check(["init", "-q"]);
	await check(["config", "user.email", "test@example.com"]);
	await check(["config", "user.name", "test"]);
	writeFileSync(join(dir, "a.txt"), "a\n");
	await check(["add", "-A"]);
	await check(["commit", "-qm", "init"]);
	return dir;
}

async function branches(pi: any, repo: string): Promise<string> {
	const result = await pi.exec("git", ["branch", "--list", "pi-agent-*"], { cwd: repo });
	return result.stdout;
}

test.if(hasGit)("worktree with changes is committed to a branch and removed", async () => {
	const exec = createGitExec();
	const pi = { exec } as any;
	const repo = await initRepo();
	try {
		const worktree = await createWorktree(pi, repo, "wttest1");
		expect(worktree).toBeDefined();
		expect(existsSync(worktree!.path)).toBe(true);

		writeFileSync(join(worktree!.path, "agent-note.txt"), "agent work\n");
		const result = await cleanupWorktree(pi, repo, worktree!, "probe agent work");

		expect(result.hasChanges).toBe(true);
		expect(result.branch).toBe("pi-agent-wttest1");
		expect(await branches(pi, repo)).toContain("pi-agent-wttest1");
		expect(existsSync(worktree!.path)).toBe(false);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test.if(hasGit)("worktree without changes is removed with no branch", async () => {
	const exec = createGitExec();
	const pi = { exec } as any;
	const repo = await initRepo();
	try {
		const worktree = await createWorktree(pi, repo, "wttest2");
		expect(worktree).toBeDefined();

		const result = await cleanupWorktree(pi, repo, worktree!, "probe agent no-op");

		expect(result.hasChanges).toBe(false);
		expect(result.branch).toBeUndefined();
		expect(await branches(pi, repo)).not.toContain("pi-agent-wttest2");
		expect(existsSync(worktree!.path)).toBe(false);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
