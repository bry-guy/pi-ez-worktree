import { StringEnum } from "@mariozechner/pi-ai";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	STATE_ENTRY_TYPE,
	abortWorktree,
	createUserBashOperations,
	createWorktree,
	finishWorktree,
	formatStatusBadge,
	formatStatusText,
	getEffectiveCwd,
	getWorktreeStatus,
	readStateFromEntries,
	rewritePathForWorktree,
} from "../lib/git-worktree.js";

const beginSchema = Type.Object({
	name: Type.String({ description: "Human-friendly name for the new worktree branch" }),
});

const finishSchema = Type.Object({
	strategy: Type.Optional(StringEnum(["auto", "ff-only", "squash", "merge"])),
	cleanup: Type.Optional(Type.Boolean({ description: "Remove the worktree after a successful finish. Defaults to true." })),
	commitMessage: Type.Optional(Type.String({ description: "Commit message to use if finishing needs to create a commit." })),
});

const abortSchema = Type.Object({
	force: Type.Optional(Type.Boolean({ description: "Discard uncommitted work if necessary." })),
	deleteBranch: Type.Optional(Type.Boolean({ description: "Delete the worktree branch after aborting. Defaults to true." })),
});

function parseCommandArgs(input) {
	const tokens = String(input || "").match(/(?:"[^"]*"|'[^']*'|\S+)/g) || [];
	const args = { _: [] };
	for (let index = 0; index < tokens.length; index += 1) {
		const raw = tokens[index];
		const token = raw.replace(/^(["'])(.*)\1$/, "$2");
		if (!token.startsWith("--")) {
			args._.push(token);
			continue;
		}
		const key = token.slice(2);
		const nextRaw = tokens[index + 1];
		const next = nextRaw?.replace(/^(["'])(.*)\1$/, "$2");
		if (!next || next.startsWith("--")) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		index += 1;
	}
	return args;
}

function asBoolean(value, fallback) {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	return !["false", "0", "no"].includes(String(value).toLowerCase());
}

export default function gitWorktreeExtension(pi) {
	let activeState;

	function restoreState(ctx) {
		activeState = readStateFromEntries(ctx.sessionManager.getBranch());
	}

	function persistState(state) {
		pi.appendEntry(STATE_ENTRY_TYPE, state);
	}

	function clearState() {
		activeState = undefined;
		pi.appendEntry(STATE_ENTRY_TYPE, { active: false, clearedAt: new Date().toISOString() });
	}

	function updateStatus(ctx) {
		if (!ctx.hasUI) return;
		if (activeState?.active) {
			ctx.ui.setStatus("pi-ez-worktree", ctx.ui.theme.fg("accent", formatStatusBadge(activeState)));
		} else {
			ctx.ui.setStatus("pi-ez-worktree", undefined);
		}
	}

	async function startFlow(ctx, name) {
		const trimmed = name?.trim();
		if (!trimmed) throw new Error("Usage: /wt-start <name>");
		if (activeState?.active) {
			throw new Error(`This session is already attached to ${activeState.worktreePath}. Finish or abort it first.`);
		}
		const state = await createWorktree({ cwd: ctx.cwd, name: trimmed });
		activeState = state;
		persistState(state);
		updateStatus(ctx);
		return state;
	}

	async function currentStatusText() {
		if (!activeState?.active) return "No active pi-ez-worktree flow for this session.";
		const status = await getWorktreeStatus(activeState);
		return formatStatusText(activeState, status);
	}

	async function finishFlow(ctx, options = {}) {
		if (!activeState?.active) {
			return { status: "blocked", message: "No active worktree flow for this session." };
		}
		const result = await finishWorktree(activeState, options);
		if (result.status === "success" && (options.cleanup ?? true)) {
			clearState();
		}
		updateStatus(ctx);
		return result;
	}

	async function abortFlow(ctx, options = {}) {
		if (!activeState?.active) {
			return { status: "blocked", message: "No active worktree flow for this session." };
		}
		const result = await abortWorktree(activeState, options);
		if (result.status === "success") clearState();
		updateStatus(ctx);
		return result;
	}

	function rewriteParams(params, ctx, pathKey = "path") {
		if (!activeState?.active || !params?.[pathKey]) return params;
		return {
			...params,
			[pathKey]: rewritePathForWorktree(activeState, params[pathKey], getEffectiveCwd(activeState, ctx.cwd)),
		};
	}

	function registerWrappedTool(factory, config = {}) {
		pi.registerTool({
			...factory(process.cwd()),
			execute: async (toolCallId, params, signal, onUpdate, ctx) => {
				const effectiveCwd = getEffectiveCwd(activeState, ctx.cwd);
				const rewritten = config.pathKey ? rewriteParams(params, ctx, config.pathKey) : params;
				const tool = config.makeTool ? config.makeTool(effectiveCwd) : factory(effectiveCwd);
				return tool.execute(toolCallId, rewritten, signal, onUpdate);
			},
		});
	}

	registerWrappedTool(createReadTool, { pathKey: "path" });
	registerWrappedTool(createWriteTool, { pathKey: "path" });
	registerWrappedTool(createEditTool, { pathKey: "path" });
	registerWrappedTool(createGrepTool, { pathKey: "path" });
	registerWrappedTool(createFindTool, { pathKey: "path" });
	registerWrappedTool(createLsTool, { pathKey: "path" });
	registerWrappedTool(createBashTool, {
		makeTool: (effectiveCwd) =>
			createBashTool(effectiveCwd, {
				spawnHook: ({ command, cwd, env }) => ({
					command,
					cwd,
					env: {
						...env,
						PI_EZ_WORKTREE_CWD: effectiveCwd,
						PI_EZ_WORKTREE_ACTIVE: activeState?.active ? "1" : "0",
						PI_EZ_WORKTREE_BRANCH: activeState?.taskBranch ?? "",
					},
				}),
			}),
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreState(ctx);
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreState(ctx);
		updateStatus(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		restoreState(ctx);
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!activeState?.active) return;
		updateStatus(ctx);
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nActive git worktree: ${activeState.worktreePath} on branch ${activeState.taskBranch} based on ${activeState.baseBranch}. All project file edits and bash commands for this session must stay in that worktree. Finish by using the worktree finish tool or /wt-finish.`,
		};
	});

	pi.on("session_before_switch", async (_event, ctx) => {
		if (!activeState?.active) return;
		const status = await getWorktreeStatus(activeState);
		if (!status.dirty && !status.rebaseInProgress && !status.mergeInProgress) return;
		if (!ctx.hasUI) return { cancel: true };
		const choice = await ctx.ui.select("This session still has an active worktree with unfinished changes. Switch anyway?", [
			"No, keep this session active",
			"Yes, switch sessions anyway",
		]);
		if (choice !== "Yes, switch sessions anyway") return { cancel: true };
	});

	pi.on("user_bash", (event) => {
		if (!activeState?.active) return;
		return { operations: createUserBashOperations(getEffectiveCwd(activeState, event.cwd)) };
	});

	pi.registerCommand("wt-start", {
		description: "Create and attach this pi session to a fresh git worktree",
		handler: async (args, ctx) => {
			const state = await startFlow(ctx, args);
			ctx.ui.notify(`Attached to ${state.worktreePath} on ${state.taskBranch}`, "success");
		},
	});

	pi.registerCommand("wt-status", {
		description: "Show the active pi-ez-worktree status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(await currentStatusText(), "info");
		},
	});

	pi.registerCommand("wt-finish", {
		description: "Commit, merge, and optionally clean up the active worktree",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			const commitMessage = parsed._.join(" ").trim() || undefined;
			const result = await finishFlow(ctx, {
				strategy: parsed.strategy,
				cleanup: parsed["no-cleanup"] ? false : asBoolean(parsed.cleanup, true),
				commitMessage,
			});
			ctx.ui.notify(result.message, result.status === "success" ? "success" : result.status === "conflict" ? "warning" : "error");
		},
	});

	pi.registerCommand("wt-abort", {
		description: "Discard the active worktree flow for this session",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			const result = await abortFlow(ctx, {
				force: asBoolean(parsed.force, false),
				deleteBranch: parsed["keep-branch"] ? false : asBoolean(parsed["delete-branch"], true),
			});
			ctx.ui.notify(result.message, result.status === "success" ? "success" : "warning");
		},
	});

	pi.registerTool({
		name: "worktree_begin",
		label: "Worktree Begin",
		description: "Create a fresh git worktree for the current pi session and route future project tool calls there.",
		promptSnippet: "Create an isolated git worktree for the current session.",
		promptGuidelines: [
			"Use this when the user asks to do the task in its own worktree or wants multiple pi instances working in the same repository without branch interference.",
		],
		parameters: beginSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await startFlow(ctx, params.name);
			return {
				content: [
					{
						type: "text",
						text: `Worktree ready at ${state.worktreePath} on branch ${state.taskBranch} (base ${state.baseBranch}). Future project tool calls in this session will use it automatically.`,
					},
				],
				details: state,
			};
		},
	});

	pi.registerTool({
		name: "worktree_status",
		label: "Worktree Status",
		description: "Show the current session's active git worktree status.",
		promptSnippet: "Inspect the current pi worktree flow status.",
		parameters: Type.Object({}),
		async execute() {
			if (!activeState?.active) {
				return { content: [{ type: "text", text: "No active worktree flow for this session." }], details: {} };
			}
			const status = await getWorktreeStatus(activeState);
			return {
				content: [{ type: "text", text: formatStatusText(activeState, status) }],
				details: { state: activeState, status },
			};
		},
	});

	pi.registerTool({
		name: "worktree_finish",
		label: "Worktree Finish",
		description: "Commit uncommitted work if needed, merge the worktree branch back into its base branch, and optionally clean up.",
		promptSnippet: "Finish and merge the active session worktree back into its base branch.",
		promptGuidelines: [
			"Prefer strategy auto unless the user explicitly wants squash or merge commit behavior.",
		],
		parameters: finishSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await finishFlow(ctx, params);
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "worktree_abort",
		label: "Worktree Abort",
		description: "Discard the active session worktree and optionally delete its branch.",
		promptSnippet: "Abort and clean up the active session worktree.",
		parameters: abortSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await abortFlow(ctx, params);
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});
}
