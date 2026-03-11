#!/usr/bin/env node
import { detachWorktree } from "../lib/git-worktree.js";
import { parseArgs, printJson, readStateInput } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const state = await readStateInput(args);
	printJson(detachWorktree(state));
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
