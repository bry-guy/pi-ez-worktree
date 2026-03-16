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
	attachWorktree,
	createUserBashOperations,
	createWorktree,
	detachWorktree,
	finishWorktree,
	formatAttachableStatusText,
	formatStatusBadge,
	formatStatusText,
	formatWorktreeCandidate,
	formatWorktreeListText,
	getWorktreeAttachTarget,
	getEffectiveCwd,
	getWorktreeStatus,
	listAttachableWorktrees,
	readStateFromEntries,
	rewritePathForWorktree,
} from "../lib/git-worktree.js";

const beginSchema = Type.Object({
	name: Type.String({ description: "Human-friendly name for the new worktree branch" }),
});

const attachSchema = Type.Object({
	target: Type.Optional(Type.String({ description: "Existing worktree branch name or path. Optional if there is only one attachable worktree." })),
});

const listSchema = Type.Object({});

const detachSchema = Type.Object({});

const finishSchema = Type.Object({
	strategy: Type.Optional(StringEnum(["auto", "ff-only", "squash", "merge"])),
	cleanup: Type.Optional(Type.Boolean({ description: "Remove the worktree after a successful finish. Defaults to true." })),
	commitMessage: Type.Optional(Type.String({ description: "Commit message to use if finishing needs to create a commit." })),
});

const abortSchema = Type.Object({
	force: Type.Optional(Type.Boolean({ description: "Discard uncommitted work if necessary." })),
	deleteBranch: Type.Optional(Type.Boolean({ description: "Delete the worktree branch after aborting. Defaults to true." })),
});

const EZWT_SUBCOMMANDS = [
	{
		name: "start",
		description: "Create and attach this pi session to a fresh git worktree",
		usage: "/ezwt start <name>",
	},
	{
		name: "attach",
		description: "Attach this pi session to an existing git worktree",
		usage: "/ezwt attach [branch-or-path]",
	},
	{
		name: "detach",
		description: "Detach this pi session from its active worktree without deleting it",
		usage: "/ezwt detach",
	},
	{
		name: "list",
		description: "List linked worktrees for this repository",
		usage: "/ezwt list",
	},
	{
		name: "status",
		description: "Show the active pi-ez-worktree status or attachable candidates",
		usage: "/ezwt status",
	},
	{
		name: "finish",
		description: "Commit, merge, and optionally clean up the active worktree",
		usage: "/ezwt finish [--strategy auto|ff-only|squash|merge] [--no-cleanup] [commit message]",
	},
	{
		name: "abort",
		description: "Discard the active worktree flow for this session",
		usage: "/ezwt abort [--force] [--keep-branch]",
	},
	{
		name: "help",
		description: "Show help for ezwt or one of its subcommands",
		usage: "/ezwt help [subcommand]",
	},
];

const EZWT_FINISH_STRATEGIES = ["auto", "ff-only", "squash", "merge"];

function stripQuotes(token) {
	return token.replace(/^("|')(.*)\1$/, "$2");
}

function tokenizeCommandInput(input) {
	return String(input || "").match(/(?:"[^"]*"|'[^']*'|\S+)/g) || [];
}

function parseCommandArgs(input) {
	const tokens = tokenizeCommandInput(input);
	const args = { _: [] };
	for (let index = 0; index < tokens.length; index += 1) {
		const raw = tokens[index];
		const token = stripQuotes(raw);
		if (token === "-h") {
			args.help = true;
			continue;
		}
		if (!token.startsWith("--")) {
			args._.push(token);
			continue;
		}
		const eqIndex = token.indexOf("=");
		if (eqIndex !== -1) {
			args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
			continue;
		}
		const key = token.slice(2);
		const nextRaw = tokens[index + 1];
		const next = nextRaw ? stripQuotes(nextRaw) : undefined;
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

function filterCompletionItems(prefix, items) {
	const normalizedPrefix = String(prefix || "").toLowerCase();
	const filtered = items.filter((item) => item.label.toLowerCase().startsWith(normalizedPrefix));
	return filtered.length > 0 ? filtered : null;
}

function getEzwtArgumentCompletions(argumentPrefix) {
	const endsWithSpace = /\s$/.test(argumentPrefix);
	const tokens = tokenizeCommandInput(argumentPrefix).map(stripQuotes);
	if (tokens.length === 0) {
		return EZWT_SUBCOMMANDS.map((command) => ({
			value: `${command.name} `,
			label: command.name,
			description: command.description,
		}));
	}
	if (tokens.length === 1 && !endsWithSpace) {
		return filterCompletionItems(
			tokens[0],
			EZWT_SUBCOMMANDS.map((command) => ({
				value: `${command.name} `,
				label: command.name,
				description: command.description,
			})),
		);
	}

	const [subcommand, ...rest] = tokens;
	const current = endsWithSpace ? "" : (rest.pop() ?? "");
	const previous = endsWithSpace ? rest.at(-1) ?? subcommand : rest.at(-1);

	if (subcommand === "help") {
		return filterCompletionItems(
			current,
			EZWT_SUBCOMMANDS.filter((command) => command.name !== "help").map((command) => ({
				value: command.name,
				label: command.name,
				description: command.description,
			})),
		);
	}

	if (subcommand === "finish") {
		if (previous === "--strategy") {
			return filterCompletionItems(
				current,
				EZWT_FINISH_STRATEGIES.map((strategy) => ({ value: strategy, label: strategy, description: `Finish with ${strategy} strategy` })),
			);
		}
		const strategyPrefix = current.match(/^--strategy=(.*)$/);
		if (strategyPrefix) {
			return filterCompletionItems(
				strategyPrefix[1],
				EZWT_FINISH_STRATEGIES.map((strategy) => ({
					value: `--strategy=${strategy}`,
					label: strategy,
					description: `Finish with ${strategy} strategy`,
				})),
			);
		}
		if (!current || current.startsWith("--")) {
			return filterCompletionItems(current, [
				{ value: "--strategy ", label: "--strategy", description: "Merge strategy: auto, ff-only, squash, or merge" },
				{ value: "--cleanup ", label: "--cleanup", description: "Explicitly remove the worktree after a successful finish" },
				{ value: "--no-cleanup", label: "--no-cleanup", description: "Keep the worktree after a successful finish" },
				{ value: "--help", label: "--help", description: "Show help for ezwt finish" },
			]);
		}
	}

	if (subcommand === "abort" && (!current || current.startsWith("--"))) {
		return filterCompletionItems(current, [
			{ value: "--force", label: "--force", description: "Discard uncommitted work if necessary" },
			{ value: "--keep-branch", label: "--keep-branch", description: "Keep the worktree branch after aborting" },
			{ value: "--delete-branch", label: "--delete-branch", description: "Explicitly delete the worktree branch after aborting" },
			{ value: "--help", label: "--help", description: "Show help for ezwt abort" },
		]);
	}

	if ((subcommand === "start" || subcommand === "attach") && (!current || current.startsWith("--"))) {
		return filterCompletionItems(current, [{ value: "--help", label: "--help", description: `Show help for ezwt ${subcommand}` }]);
	}

	return null;
}

function formatEzwtHelp(subcommand) {
	const command = subcommand ? EZWT_SUBCOMMANDS.find((entry) => entry.name === subcommand) : undefined;
	if (subcommand && !command) {
		return `Unknown ezwt subcommand "${subcommand}".\n\n${formatEzwtHelp()}`;
	}
	if (!command) {
		return [
			"Usage: /ezwt <subcommand> [args]",
			"",
			"Subcommands:",
			...EZWT_SUBCOMMANDS.filter((entry) => entry.name !== "help").map(
				(entry) => `- ${entry.name}: ${entry.description}`,
			),
			"- help: Show help for ezwt or one of its subcommands",
			"",
			"Examples:",
			"- /ezwt start bugfix-auth",
			"- /ezwt attach",
			"- /ezwt attach pi/bugfix-auth",
			"- /ezwt finish --no-cleanup",
			"",
			"Run /ezwt help <subcommand> for details.",
		].join("\n");
	}
	const lines = [command.usage, "", command.description];
	if (command.name === "attach") {
		lines.push("", "Omit the target in interactive pi to choose from a picker when multiple attachable worktrees exist.");
	}
	if (command.name === "finish") {
		lines.push("", "Flags:", "- --strategy auto|ff-only|squash|merge", "- --cleanup", "- --no-cleanup");
	}
	if (command.name === "abort") {
		lines.push("", "Flags:", "- --force", "- --keep-branch", "- --delete-branch");
	}
	if (command.name === "help") {
		lines.push("", "Example:", "- /ezwt help finish");
	}
	return lines.join("\n");
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
		if (!trimmed) throw new Error("Usage: /ezwt start <name>");
		if (activeState?.active) {
			throw new Error(`This session is already attached to ${activeState.worktreePath}. Finish or abort it first.`);
		}
		const state = await createWorktree({ cwd: ctx.cwd, name: trimmed });
		activeState = state;
		persistState(state);
		updateStatus(ctx);
		return state;
	}

	async function chooseAttachTarget(ctx) {
		const info = await listAttachableWorktrees(ctx.cwd);
		if (info.candidates.length === 0) {
			throw new Error("No attachable linked worktrees found for this repository.");
		}
		if (info.candidates.length === 1 || !ctx.hasUI) {
			if (info.candidates.length === 1) return info.candidates[0].branch;
			throw new Error(`${formatWorktreeListText(info)}\n\nRe-run /ezwt attach with a branch or path.`);
		}
		const labels = info.candidates.map((candidate) => formatWorktreeCandidate(candidate));
		const selected = await ctx.ui.select("Attach this session to which worktree?", labels);
		if (!selected) {
			throw new Error("Attach cancelled.");
		}
		const index = labels.indexOf(selected);
		if (index === -1) throw new Error("Attach selection was not recognized.");
		return getWorktreeAttachTarget(info.candidates[index]);
	}

	async function attachFlow(ctx, target) {
		if (activeState?.active) {
			throw new Error(`This session is already attached to ${activeState.worktreePath}. Finish or abort it first.`);
		}
		const resolvedTarget = target?.trim() ? target.trim() : await chooseAttachTarget(ctx);
		const state = await attachWorktree({ cwd: ctx.cwd, target: resolvedTarget });
		activeState = state;
		persistState(state);
		updateStatus(ctx);
		return state;
	}

	function listCwd(ctx) {
		return activeState?.active ? activeState.worktreePath : ctx.cwd;
	}

	async function currentStatusText(ctx) {
		if (!activeState?.active) {
			const attachable = await listAttachableWorktrees(ctx.cwd).catch(() => undefined);
			if (!attachable) return "No active pi-ez-worktree flow for this session.";
			return formatAttachableStatusText(attachable);
		}
		const status = await getWorktreeStatus(activeState);
		return formatStatusText(activeState, status);
	}

	async function listText(ctx) {
		const info = await listAttachableWorktrees(listCwd(ctx)).catch(() => undefined);
		if (!info) return "No linked worktrees found for this repository.";
		return formatWorktreeListText(info);
	}

	async function detachFlow(ctx) {
		if (!activeState?.active) {
			return { status: "blocked", message: "No active worktree flow for this session." };
		}
		const result = detachWorktree(activeState);
		clearState();
		updateStatus(ctx);
		return result;
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
				`\n\nActive git worktree: ${activeState.worktreePath} on branch ${activeState.taskBranch} based on ${activeState.baseBranch}. All project file edits and bash commands for this session must stay in that worktree. Finish by using the worktree finish tool or /ezwt finish.`,
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

	async function handleEzwtCommand(args, ctx) {
		const parsed = parseCommandArgs(args);
		const [subcommand, ...rest] = parsed._;
		if (!subcommand) {
			ctx.ui.notify(formatEzwtHelp(), "info");
			return;
		}
		if (subcommand === "help") {
			ctx.ui.notify(formatEzwtHelp(rest[0]), "info");
			return;
		}
		if (parsed.help) {
			ctx.ui.notify(formatEzwtHelp(subcommand), "info");
			return;
		}
		switch (subcommand) {
			case "start": {
				const name = rest.join(" ").trim();
				if (!name) {
					ctx.ui.notify(formatEzwtHelp("start"), "warning");
					return;
				}
				const state = await startFlow(ctx, name);
				ctx.ui.notify(`Attached to ${state.worktreePath} on ${state.taskBranch}`, "success");
				return;
			}
			case "attach": {
				const target = rest.join(" ").trim() || undefined;
				const state = await attachFlow(ctx, target);
				ctx.ui.notify(`Attached to existing worktree ${state.worktreePath} on ${state.taskBranch}`, "success");
				return;
			}
			case "detach": {
				const result = await detachFlow(ctx);
				ctx.ui.notify(result.message, result.status === "success" ? "success" : "warning");
				return;
			}
			case "list":
				ctx.ui.notify(await listText(ctx), "info");
				return;
			case "status":
				ctx.ui.notify(await currentStatusText(ctx), "info");
				return;
			case "finish": {
				const commitMessage = rest.join(" ").trim() || undefined;
				const result = await finishFlow(ctx, {
					strategy: parsed.strategy,
					cleanup: parsed["no-cleanup"] ? false : asBoolean(parsed.cleanup, true),
					commitMessage,
				});
				ctx.ui.notify(result.message, result.status === "success" ? "success" : result.status === "conflict" ? "warning" : "error");
				return;
			}
			case "abort": {
				const result = await abortFlow(ctx, {
					force: asBoolean(parsed.force, false),
					deleteBranch: parsed["keep-branch"] ? false : asBoolean(parsed["delete-branch"], true),
				});
				ctx.ui.notify(result.message, result.status === "success" ? "success" : "warning");
				return;
			}
			default:
				throw new Error(formatEzwtHelp(subcommand));
		}
	}

	pi.registerCommand("ezwt", {
		description: "Manage this session's pi-ez-worktree flow",
		getArgumentCompletions: getEzwtArgumentCompletions,
		handler: handleEzwtCommand,
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
		name: "worktree_attach",
		label: "Worktree Attach",
		description: "Attach the current pi session to an existing git worktree by branch name or path. If omitted, interactive sessions prompt you to pick one and non-interactive sessions require the target when multiple worktrees exist.",
		promptSnippet: "Attach this session to an existing git worktree.",
		promptGuidelines: [
			"Use this when the user wants to resume or continue work in an already-created worktree.",
		],
		parameters: attachSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await attachFlow(ctx, params.target);
			return {
				content: [
					{ type: "text", text: `Attached to ${state.worktreePath} on branch ${state.taskBranch} (base ${state.baseBranch}).` },
				],
				details: state,
			};
		},
	});

	pi.registerTool({
		name: "worktree_detach",
		label: "Worktree Detach",
		description: "Detach the current pi session from its active worktree without deleting the worktree or branch.",
		promptSnippet: "Detach this session from its active worktree but keep the worktree around.",
		parameters: detachSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const result = await detachFlow(ctx);
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "worktree_list",
		label: "Worktree List",
		description: "List linked worktrees for this repository, marking the current checkout when relevant.",
		promptSnippet: "List linked worktrees for the repository.",
		parameters: listSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const info = await listAttachableWorktrees(listCwd(ctx));
			return {
				content: [{ type: "text", text: formatWorktreeListText(info) }],
				details: info,
			};
		},
	});

	pi.registerTool({
		name: "worktree_status",
		label: "Worktree Status",
		description: "Show the current session's active git worktree status, or list attachable worktrees when none is active.",
		promptSnippet: "Inspect the current pi worktree flow status.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (!activeState?.active) {
				const attachable = await listAttachableWorktrees(ctx.cwd).catch(() => undefined);
				const text = attachable ? formatAttachableStatusText(attachable) : "No active worktree flow for this session.";
				return { content: [{ type: "text", text }], details: { attachable } };
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
