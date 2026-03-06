import { execFile, spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;
const METADATA_FILE = ".pi-ez-worktree.json";

export const STATE_ENTRY_TYPE = "pi-ez-worktree-state";

export function stripAtPrefix(value) {
	return typeof value === "string" && value.startsWith("@") ? value.slice(1) : value;
}

export function slugify(value) {
	const slug = String(value)
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	if (!slug) throw new Error("Worktree name must contain at least one letter or number.");
	return slug;
}

export async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function metadataPath(worktreePath) {
	return join(worktreePath, METADATA_FILE);
}

async function writeWorktreeMetadata(state) {
	await writeFile(metadataPath(state.worktreePath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readWorktreeMetadata(worktreePath) {
	try {
		const content = await readFile(metadataPath(worktreePath), "utf8");
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

async function runCommand(command, args, options = {}) {
	try {
		const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
			cwd: options.cwd,
			env: options.env,
			maxBuffer: options.maxBuffer ?? MAX_BUFFER,
		});
		return { stdout, stderr, code: 0 };
	} catch (error) {
		const result = {
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? error.message ?? "",
			code: typeof error.code === "number" ? error.code : 1,
		};
		if (options.allowFailure) return result;
		throw new Error([`${command} ${args.join(" ")}`.trim(), result.stderr || result.stdout].filter(Boolean).join("\n\n"));
	}
}

async function runGit(cwd, args, options = {}) {
	return runCommand("git", args, { ...options, cwd });
}

async function gitStdout(cwd, args) {
	const { stdout } = await runGit(cwd, args);
	return stdout.trim();
}

async function branchExists(cwd, branch) {
	const result = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true });
	return result.code === 0;
}

async function gitPathExists(cwd, gitPath) {
	const resolved = await gitStdout(cwd, ["rev-parse", "--git-path", gitPath]);
	const absolute = isAbsolute(resolved) ? resolved : resolve(cwd, resolved);
	return pathExists(absolute);
}

async function hasDirtyWorktree(cwd) {
	const { stdout } = await runGit(cwd, ["status", "--porcelain"]);
	return stdout.trim().length > 0;
}

export async function getRepoRoot(cwd) {
	return gitStdout(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function getCurrentBranch(cwd) {
	const branch = await gitStdout(cwd, ["branch", "--show-current"]);
	if (!branch) throw new Error("Current checkout is detached. pi-ez-worktree requires starting from a named branch.");
	return branch;
}

function getWorktreeBaseDir(repoRoot) {
	return join(dirname(repoRoot), ".pi-worktrees", basename(repoRoot));
}

async function listGitWorktrees(cwd) {
	const { stdout } = await runGit(cwd, ["worktree", "list", "--porcelain"]);
	const worktrees = [];
	let current = undefined;
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) {
			if (current?.worktree) worktrees.push(current);
			current = undefined;
			continue;
		}
		const [key, ...rest] = line.split(" ");
		const value = rest.join(" ").trim();
		if (key === "worktree") {
			current = { worktree: resolve(value), branch: "", detached: false, bare: false };
			continue;
		}
		if (!current) continue;
		if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
		else if (key === "detached") current.detached = true;
		else if (key === "bare") current.bare = true;
	}
	if (current?.worktree) worktrees.push(current);
	return worktrees;
}

async function inferBaseBranch(mainCheckoutPath, taskBranch) {
	const current = await gitStdout(mainCheckoutPath, ["branch", "--show-current"]).catch(() => "");
	if (current && current !== taskBranch) return current;
	const remoteHead = await gitStdout(mainCheckoutPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
	const remoteBranch = remoteHead.replace(/^origin\//, "");
	if (remoteBranch && remoteBranch !== taskBranch) return remoteBranch;
	return "main";
}

export function getEffectiveCwd(state, fallbackCwd) {
	if (!state?.active) return fallbackCwd;
	const subdir = state.sessionSubdir && state.sessionSubdir !== "." ? state.sessionSubdir : "";
	return subdir ? join(state.worktreePath, subdir) : state.worktreePath;
}

export function rewritePathForWorktree(state, inputPath, toolCwd) {
	const path = stripAtPrefix(inputPath);
	if (!state?.active || !path) return path;
	if (!isAbsolute(path)) return path;
	const absolute = resolve(path);
	const repoRoot = resolve(state.repoRoot);
	const worktreeRoot = resolve(state.worktreePath);
	if (absolute === worktreeRoot || absolute.startsWith(`${worktreeRoot}/`)) return absolute;
	if (absolute === repoRoot || absolute.startsWith(`${repoRoot}/`)) {
		const rel = relative(repoRoot, absolute);
		return rel ? join(worktreeRoot, rel) : worktreeRoot;
	}
	return absolute;
}

export async function createWorktree({ cwd, name, branchPrefix = "pi" }) {
	const repoRoot = await getRepoRoot(cwd);
	const baseBranch = await getCurrentBranch(cwd);
	const sessionSubdir = relative(repoRoot, cwd) || "";
	const slug = slugify(name);
	const baseDir = getWorktreeBaseDir(repoRoot);

	let candidateBranch = `${branchPrefix}/${slug}`;
	let candidatePath = join(baseDir, slug);
	let suffix = 2;
	while ((await branchExists(repoRoot, candidateBranch)) || (await pathExists(candidatePath))) {
		candidateBranch = `${branchPrefix}/${slug}-${suffix}`;
		candidatePath = join(baseDir, `${slug}-${suffix}`);
		suffix += 1;
	}

	await runGit(repoRoot, ["worktree", "add", "-b", candidateBranch, candidatePath, baseBranch]);

	const state = {
		active: true,
		repoRoot,
		mainCheckoutPath: repoRoot,
		sessionSubdir,
		worktreePath: candidatePath,
		taskBranch: candidateBranch,
		baseBranch,
		createdAt: new Date().toISOString(),
	};
	await writeWorktreeMetadata(state);
	return state;
}

export async function attachWorktree({ cwd, target }) {
	const currentTopLevel = await getRepoRoot(cwd);
	const worktrees = await listGitWorktrees(cwd);
	const normalizedTarget = target?.trim();
	let match;

	if (normalizedTarget) {
		match = worktrees.find((entry) => entry.branch === normalizedTarget);
		if (!match) {
			const looksLikePath = normalizedTarget.includes("/") || normalizedTarget.startsWith(".") || normalizedTarget.startsWith("~");
			if (looksLikePath) {
				const resolvedTarget = resolve(cwd, normalizedTarget);
				match = worktrees.find((entry) => resolve(entry.worktree) === resolvedTarget);
			}
		}
		if (!match) {
			const summary = worktrees.map((entry) => `- ${entry.branch || "(detached)"}: ${entry.worktree}`).join("\n");
			throw new Error(`Could not find a git worktree for \"${normalizedTarget}\".\n\nKnown worktrees:\n${summary}`);
		}
	} else {
		const currentMetadata = await readWorktreeMetadata(currentTopLevel);
		if (currentMetadata?.worktreePath && resolve(currentMetadata.worktreePath) === resolve(currentTopLevel)) {
			match = worktrees.find((entry) => resolve(entry.worktree) === resolve(currentTopLevel));
		}
		const candidates = worktrees.filter((entry) => !entry.bare && resolve(entry.worktree) !== resolve(currentTopLevel));
		if (!match && candidates.length === 1) match = candidates[0];
		else if (!match && candidates.length === 0) throw new Error("No attachable linked worktrees found for this repository.");
		else if (!match) {
			const summary = candidates.map((entry) => `- ${entry.branch || "(detached)"}: ${entry.worktree}`).join("\n");
			throw new Error(`Multiple linked worktrees are available. Re-run wt-attach with a branch or path.\n\nCandidates:\n${summary}`);
		}
	}

	const metadata = await readWorktreeMetadata(match.worktree);
	const mainCheckoutPath = metadata?.mainCheckoutPath || currentTopLevel;
	const repoRoot = metadata?.repoRoot || mainCheckoutPath;
	const sessionSubdir = metadata?.sessionSubdir ?? (relative(repoRoot, cwd) || "");
	const taskBranch = metadata?.taskBranch || match.branch || (await getCurrentBranch(match.worktree));
	const baseBranch = metadata?.baseBranch || (await inferBaseBranch(mainCheckoutPath, taskBranch));
	const state = {
		active: true,
		repoRoot,
		mainCheckoutPath,
		sessionSubdir,
		worktreePath: match.worktree,
		taskBranch,
		baseBranch,
		createdAt: metadata?.createdAt || new Date().toISOString(),
	};
	await writeWorktreeMetadata(state);
	return state;
}

export async function getWorktreeStatus(state) {
	const worktreeExists = await pathExists(state.worktreePath);
	const mainCheckoutExists = await pathExists(state.mainCheckoutPath);
	if (!worktreeExists) {
		return {
			worktreeExists: false,
			mainCheckoutExists,
			dirty: false,
			currentBranch: "",
			ahead: 0,
			behind: 0,
			rebaseInProgress: false,
			mergeInProgress: false,
			mainCheckoutDirty: mainCheckoutExists ? await hasDirtyWorktree(state.mainCheckoutPath) : false,
			mainCheckoutBranch: mainCheckoutExists ? await gitStdout(state.mainCheckoutPath, ["branch", "--show-current"]).catch(() => "") : "",
		};
	}

	const dirty = await hasDirtyWorktree(state.worktreePath);
	const currentBranch = await gitStdout(state.worktreePath, ["branch", "--show-current"]).catch(() => "");
	const aheadBehind = await runGit(state.worktreePath, ["rev-list", "--left-right", "--count", `${state.baseBranch}...HEAD`], {
		allowFailure: true,
	});
	let behind = 0;
	let ahead = 0;
	if (aheadBehind.code === 0) {
		const [left, right] = aheadBehind.stdout.trim().split(/\s+/);
		behind = Number(left || 0);
		ahead = Number(right || 0);
	}

	const rebaseInProgress = (await gitPathExists(state.worktreePath, "rebase-merge")) || (await gitPathExists(state.worktreePath, "rebase-apply"));
	const mergeInProgress = await gitPathExists(state.worktreePath, "MERGE_HEAD");
	const mainCheckoutDirty = mainCheckoutExists ? await hasDirtyWorktree(state.mainCheckoutPath) : false;
	const mainCheckoutBranch = mainCheckoutExists ? await gitStdout(state.mainCheckoutPath, ["branch", "--show-current"]).catch(() => "") : "";

	return {
		worktreeExists,
		mainCheckoutExists,
		dirty,
		currentBranch,
		ahead,
		behind,
		rebaseInProgress,
		mergeInProgress,
		mainCheckoutDirty,
		mainCheckoutBranch,
	};
}

function defaultCommitMessage(state) {
	const leaf = state.taskBranch.split("/").at(-1) || state.taskBranch;
	return `pi-ez-worktree: ${leaf}`;
}

async function commitDirtyChanges(state, commitMessage) {
	await runGit(state.worktreePath, ["add", "-A"]);
	const diffCheck = await runGit(state.worktreePath, ["diff", "--cached", "--quiet"], { allowFailure: true });
	if (diffCheck.code === 0) return false;
	if (diffCheck.code !== 1) {
		throw new Error(diffCheck.stderr || diffCheck.stdout || "Unable to inspect staged changes.");
	}
	await runGit(state.worktreePath, ["commit", "-m", commitMessage]);
	return true;
}

async function cleanupMergedWorktree(state, strategy) {
	let removedWorktree = false;
	let deletedBranch = false;
	if (await pathExists(state.worktreePath)) {
		await runGit(state.mainCheckoutPath, ["worktree", "remove", state.worktreePath]);
		removedWorktree = true;
	}
	const deleteMode = strategy === "squash" ? "-D" : "-d";
	const deleteResult = await runGit(state.mainCheckoutPath, ["branch", deleteMode, state.taskBranch], { allowFailure: true });
	deletedBranch = deleteResult.code === 0;
	return { removedWorktree, deletedBranch };
}

export async function finishWorktree(state, options = {}) {
	const strategy = options.strategy ?? "auto";
	const cleanup = options.cleanup ?? true;
	const commitMessage = options.commitMessage?.trim() || defaultCommitMessage(state);
	const initialStatus = await getWorktreeStatus(state);

	if (!initialStatus.worktreeExists) {
		return { status: "blocked", message: `Worktree path does not exist: ${state.worktreePath}`, details: { phase: "missing-worktree" } };
	}
	if (initialStatus.currentBranch && initialStatus.currentBranch !== state.taskBranch) {
		return {
			status: "blocked",
			message: `Worktree is on ${initialStatus.currentBranch}, expected ${state.taskBranch}.`,
			details: { phase: "wrong-branch", currentBranch: initialStatus.currentBranch },
		};
	}
	if (initialStatus.rebaseInProgress || initialStatus.mergeInProgress) {
		return {
			status: "blocked",
			message: "Worktree already has a merge or rebase in progress. Resolve that first, then rerun wt-finish.",
			details: { phase: "existing-conflict" },
		};
	}
	if (initialStatus.mainCheckoutDirty) {
		return {
			status: "blocked",
			message: `Main checkout at ${state.mainCheckoutPath} is dirty. Clean it before finishing this worktree.`,
			details: { phase: "main-dirty" },
		};
	}
	if (initialStatus.mainCheckoutBranch !== state.baseBranch) {
		return {
			status: "blocked",
			message: `Main checkout is on ${initialStatus.mainCheckoutBranch || "(detached)"}, expected ${state.baseBranch}.`,
			details: { phase: "main-branch", currentBranch: initialStatus.mainCheckoutBranch },
		};
	}

	const autoCommitted = await commitDirtyChanges(state, commitMessage);

	if (strategy === "auto") {
		const rebaseResult = await runGit(state.worktreePath, ["rebase", state.baseBranch], { allowFailure: true });
		if (rebaseResult.code !== 0) {
			return {
				status: "conflict",
				message: "Rebase hit conflicts inside the active worktree. Resolve them in this pi session, then rerun wt-finish.",
				details: { phase: "rebase", output: `${rebaseResult.stdout}${rebaseResult.stderr}`.trim() },
			};
		}
	}

	const postPrepStatus = await getWorktreeStatus(state);
	if (postPrepStatus.mainCheckoutDirty) {
		return {
			status: "blocked",
			message: `Main checkout at ${state.mainCheckoutPath} is dirty. Clean it before finishing this worktree.`,
			details: { phase: "main-dirty" },
		};
	}
	if (postPrepStatus.mainCheckoutBranch !== state.baseBranch) {
		return {
			status: "blocked",
			message: `Main checkout is on ${postPrepStatus.mainCheckoutBranch || "(detached)"}, expected ${state.baseBranch}.`,
			details: { phase: "main-branch", currentBranch: postPrepStatus.mainCheckoutBranch },
		};
	}

	if (postPrepStatus.ahead === 0) {
		const cleanupResult = cleanup ? await cleanupMergedWorktree(state, strategy) : { removedWorktree: false, deletedBranch: false };
		return {
			status: "success",
			message: cleanup
				? "Nothing new needed merging. Cleaned up the worktree."
				: "Nothing new needed merging.",
			details: { phase: "noop", autoCommitted, cleanup: cleanupResult, merged: false },
		};
	}

	if (strategy === "auto" || strategy === "ff-only") {
		const mergeResult = await runGit(state.mainCheckoutPath, ["merge", "--ff-only", state.taskBranch], { allowFailure: true });
		if (mergeResult.code !== 0) {
			return {
				status: "blocked",
				message: "Fast-forward merge failed. The base branch moved in an incompatible way; rerun with strategy auto after resolving the worktree state.",
				details: { phase: "ff-merge", output: `${mergeResult.stdout}${mergeResult.stderr}`.trim() },
			};
		}
	} else if (strategy === "merge") {
		const mergeResult = await runGit(state.mainCheckoutPath, ["merge", "--no-ff", "-m", commitMessage, state.taskBranch], { allowFailure: true });
		if (mergeResult.code !== 0) {
			return {
				status: "conflict",
				message: "Merge hit conflicts in the main checkout.",
				details: { phase: "merge", output: `${mergeResult.stdout}${mergeResult.stderr}`.trim() },
			};
		}
	} else if (strategy === "squash") {
		const squashResult = await runGit(state.mainCheckoutPath, ["merge", "--squash", state.taskBranch], { allowFailure: true });
		if (squashResult.code !== 0) {
			return {
				status: "conflict",
				message: "Squash merge hit conflicts in the main checkout.",
				details: { phase: "squash", output: `${squashResult.stdout}${squashResult.stderr}`.trim() },
			};
		}
		await runGit(state.mainCheckoutPath, ["commit", "-m", commitMessage]);
	} else {
		throw new Error(`Unsupported finish strategy: ${strategy}`);
	}

	const cleanupResult = cleanup ? await cleanupMergedWorktree(state, strategy) : { removedWorktree: false, deletedBranch: false };
	return {
		status: "success",
		message: cleanup
			? `Merged ${state.taskBranch} back into ${state.baseBranch} and cleaned up the worktree.`
			: `Merged ${state.taskBranch} back into ${state.baseBranch}.`,
		details: {
			phase: "merged",
			strategy,
			autoCommitted,
			cleanup: cleanupResult,
			merged: true,
		},
	};
}

export async function abortWorktree(state, options = {}) {
	const force = options.force ?? false;
	const deleteBranch = options.deleteBranch ?? true;
	const status = await getWorktreeStatus(state);
	if (status.worktreeExists && (status.dirty || status.rebaseInProgress || status.mergeInProgress) && !force) {
		return {
			status: "blocked",
			message: "Worktree has uncommitted or in-progress git state. Rerun abort with force if you really want to discard it.",
			details: { phase: "dirty-worktree" },
		};
	}

	let removedWorktree = false;
	if (status.worktreeExists) {
		const args = ["worktree", "remove", ...(force ? ["--force"] : []), state.worktreePath];
		await runGit(state.mainCheckoutPath, args);
		removedWorktree = true;
	}

	let deleted = false;
	if (deleteBranch) {
		const deleteResult = await runGit(state.mainCheckoutPath, ["branch", "-D", state.taskBranch], { allowFailure: true });
		deleted = deleteResult.code === 0;
	}

	return {
		status: "success",
		message: removedWorktree
			? `Removed worktree ${state.worktreePath}${deleted ? " and deleted its branch." : "."}`
			: `Cleared state for missing worktree ${state.worktreePath}${deleted ? " and deleted its branch." : "."}`,
		details: { removedWorktree, deletedBranch: deleted },
	};
}

export function formatStatusText(state, status) {
	const lines = [
		`repo: ${state.repoRoot}`,
		`main checkout: ${state.mainCheckoutPath}`,
		`worktree: ${state.worktreePath}${status.worktreeExists ? "" : " (missing)"}`,
		`task branch: ${state.taskBranch}`,
		`base branch: ${state.baseBranch}`,
		`worktree branch: ${status.currentBranch || "(unknown)"}`,
		`dirty: ${status.dirty ? "yes" : "no"}`,
		`ahead/behind vs ${state.baseBranch}: +${status.ahead} / -${status.behind}`,
		`rebase in progress: ${status.rebaseInProgress ? "yes" : "no"}`,
		`merge in progress: ${status.mergeInProgress ? "yes" : "no"}`,
		`main checkout branch: ${status.mainCheckoutBranch || "(unknown)"}`,
		`main checkout dirty: ${status.mainCheckoutDirty ? "yes" : "no"}`,
	];
	return lines.join("\n");
}

export function createUserBashOperations(activeCwd, baseEnv = process.env) {
	return {
		exec(command, _cwd, options) {
			return new Promise((resolvePromise, rejectPromise) => {
				const child = spawn("bash", ["-lc", command], {
					cwd: activeCwd,
					env: { ...baseEnv, PI_EZ_WORKTREE_CWD: activeCwd },
					stdio: ["ignore", "pipe", "pipe"],
				});

				let finished = false;
				let timeoutId;

				const finish = (value, isError = false) => {
					if (finished) return;
					finished = true;
					if (timeoutId) clearTimeout(timeoutId);
					if (options.signal) options.signal.removeEventListener("abort", onAbort);
					if (isError) rejectPromise(value);
					else resolvePromise(value);
				};

				const onAbort = () => {
					child.kill("SIGTERM");
				};

				child.stdout.on("data", (data) => options.onData(data));
				child.stderr.on("data", (data) => options.onData(data));
				child.on("error", (error) => finish(error, true));
				child.on("close", (code) => finish({ exitCode: code }));

				if (options.timeout && options.timeout > 0) {
					timeoutId = setTimeout(() => child.kill("SIGTERM"), options.timeout * 1000);
				}
				if (options.signal) {
					if (options.signal.aborted) onAbort();
					options.signal.addEventListener("abort", onAbort, { once: true });
				}
			});
		},
	};
}

export function readStateFromEntries(entries) {
	let state;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		const data = entry.data;
		if (!data || data.active === false) {
			state = undefined;
			continue;
		}
		state = data;
	}
	return state;
}

export function formatStatusBadge(state) {
	const leaf = basename(state.worktreePath);
	return `wt:${leaf}→${state.baseBranch}`;
}

