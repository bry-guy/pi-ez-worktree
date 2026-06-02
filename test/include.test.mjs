import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { attachWorktree, createWorktree } from "../lib/git-worktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args, options = {}) {
	return execFileAsync("git", args, { cwd, ...options });
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

test("createWorktree symlinks required and optional include files matched by globs", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(repo, ".env.local"), "SECRET=1\n", "utf8");
		await mkdir(join(repo, "foo", "one"), { recursive: true });
		await mkdir(join(repo, "foo", "two"), { recursive: true });
		await writeFile(join(repo, "foo", "one", "bar.json"), "one\n", "utf8");
		await writeFile(join(repo, "foo", "two", "bar.txt"), "two\n", "utf8");
		await writeFile(join(root, "external.toml"), "external\n", "utf8");
		await writeFile(
			join(repo, ".ez-worktree.json"),
			`${JSON.stringify({ include: [".env.local", "foo/**/bar*.*", "../external.toml"], includeOptional: ["missing-optional"] }, null, 2)}\n`,
			"utf8",
		);

		const state = await createWorktree({ cwd: repo, name: "include smoke" });
		assert.equal(state.includeResult.warnings.length, 0);
		assert.deepEqual(
			new Set(state.includeResult.included),
			new Set([".env.local", "foo/one/bar.json", "foo/two/bar.txt", "external.toml"]),
		);

		for (const relativePath of state.includeResult.included) {
			const destination = join(state.worktreePath, relativePath);
			const stat = await lstat(destination);
			assert.equal(stat.isSymbolicLink(), true, `${relativePath} should be a symlink`);
		}
		assert.equal(await realpath(join(state.worktreePath, "external.toml")), await realpath(join(root, "external.toml")));
		assert.equal(await realpath(join(state.worktreePath, ".env.local")), await realpath(join(repo, ".env.local")));
	} finally {
		await cleanup(root);
	}
});

test("attachWorktree skips optional include conflicts and reports warnings", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(root, ".env"), "from-parent\n", "utf8");
		await writeFile(join(repo, ".ez-worktree.json"), `${JSON.stringify({ includeOptional: ["../.env"] }, null, 2)}\n`, "utf8");
		const worktreePath = join(dirname(repo), ".pi-worktrees", "repo", "manual");
		await git(repo, ["worktree", "add", "-q", "-b", "pi/manual", worktreePath, "main"]);
		await writeFile(join(worktreePath, ".env"), "from-worktree\n", "utf8");

		const state = await attachWorktree({ cwd: repo, target: "pi/manual" });
		assert.deepEqual(state.includeResult.included, []);
		assert.deepEqual(state.includeResult.warnings, ["Skipped include because destination already exists: .env"]);
		assert.equal(await readFile(join(worktreePath, ".env"), "utf8"), "from-worktree\n");
	} finally {
		await cleanup(root);
	}
});

test("createWorktree fails required include conflicts and cleans up the failed worktree", async () => {
	const { root, repo } = await createRepo();
	try {
		await writeFile(join(root, "tracked.txt"), "external\n", "utf8");
		await writeFile(join(repo, ".ez-worktree.json"), `${JSON.stringify({ include: ["../tracked.txt"] }, null, 2)}\n`, "utf8");
		await assert.rejects(() => createWorktree({ cwd: repo, name: "bad include" }), /destination already exists: tracked\.txt/);
		const { stdout } = await git(repo, ["worktree", "list", "--porcelain"]);
		assert.equal(stdout.includes("pi/bad-include"), false);
	} finally {
		await cleanup(root);
	}
});
