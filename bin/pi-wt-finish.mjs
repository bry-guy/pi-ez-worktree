#!/usr/bin/env node
import { finishWorktree } from "../lib/git-worktree.js";
import { asBoolean, parseArgs, printJson, readStateInput } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const state = await readStateInput(args);
	const result = await finishWorktree(state, {
		strategy: args.strategy,
		cleanup: asBoolean(args.cleanup, true),
		commitMessage: args["commit-message"],
	});
	printJson(result);
	if (result.status !== "success") process.exitCode = 2;
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
