import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { attachWorktree, createWorktree } from "../lib/git-worktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
	return execFileAsync("git", args, { cwd });
}

async function createRepo() {
	const root = await mkdtemp(join(tmpdir(), "ezwt-include-test-"));
	const repo = join(root, "repo");
	await mkdir(repo);
	await git(root, ["init", "-q", "-b", "main", repo]);
	await git(repo, ["config", "user.email", "test@example.com"]);
	await git(repo, ["config", "user.name", "Test User"]);
	await writeFile(join(repo, "tracked.txt"), "base\n", "utf8");
	await git(repo, ["add", "tracked.txt"]);
	await git(repo, ["commit", "-q", "-m", "init"]);
	return { root, repo };
}

async function cleanup(path) {
	await rm(path, { recursive: true, force: true });
}

test("createWorktree symlinks configured include files matched by globs", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(repo, ".env.local"), "SECRET=1\n", "utf8");
		await mkdir(join(repo, "foo", "one"), { recursive: true });
		await mkdir(join(repo, "foo", "two"), { recursive: true });
		await writeFile(join(repo, "foo", "one", "bar.json"), "one\n", "utf8");
		await writeFile(join(repo, "foo", "two", "bar.txt"), "two\n", "utf8");
		await writeFile(
			join(repo, ".ez-worktree.json"),
			`${JSON.stringify({ include: [".env.local", "foo/**/bar*.*"] }, null, 2)}\n`,
			"utf8",
		);

		const state = await createWorktree({ cwd: repo, name: "include smoke" });
		assert.equal(state.includeResult.warnings.length, 0);
		assert.deepEqual(new Set(state.includeResult.included), new Set([".env.local", "foo/one/bar.json", "foo/two/bar.txt"]));

		for (const relativePath of state.includeResult.included) {
			const destination = join(state.worktreePath, relativePath);
			const stat = await lstat(destination);
			assert.equal(stat.isSymbolicLink(), true, `${relativePath} should be a symlink`);
			assert.equal(await realpath(destination), await realpath(join(repo, relativePath)));
		}
	} finally {
		await cleanup(root);
	}
});

test("attachWorktree skips existing regular include destinations and reports warnings", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(repo, ".env.local"), "from-main\n", "utf8");
		await writeFile(join(repo, ".ez-worktree.json"), `${JSON.stringify({ include: [".env.local"] }, null, 2)}\n`, "utf8");
		const worktreePath = join(dirname(repo), ".pi-worktrees", "repo", "manual");
		await git(repo, ["worktree", "add", "-q", "-b", "pi/manual", worktreePath, "main"]);
		await writeFile(join(worktreePath, ".env.local"), "from-worktree\n", "utf8");

		const state = await attachWorktree({ cwd: repo, target: "pi/manual" });
		assert.deepEqual(state.includeResult.included, []);
		assert.deepEqual(state.includeResult.warnings, ["Skipped include because destination already exists: .env.local"]);
		assert.equal(await readFile(join(worktreePath, ".env.local"), "utf8"), "from-worktree\n");
	} finally {
		await cleanup(root);
	}
});

test("createWorktree rejects unsafe include patterns", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(repo, ".ez-worktree.json"), `${JSON.stringify({ include: ["../outside"] }, null, 2)}\n`, "utf8");
		await assert.rejects(() => createWorktree({ cwd: repo, name: "bad include" }), /cannot contain '\.\.' path segments/);
	} finally {
		await cleanup(root);
	}
});
