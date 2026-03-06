#!/usr/bin/env node
import { formatStatusText, getWorktreeStatus } from "../lib/git-worktree.js";
import { parseArgs, printJson, readStateInput } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const state = await readStateInput(args);
	const status = await getWorktreeStatus(state);
	printJson({ status: "success", state, details: status, text: formatStatusText(state, status) });
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
