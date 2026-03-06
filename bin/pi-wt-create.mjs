#!/usr/bin/env node
import { createWorktree } from "../lib/git-worktree.js";
import { parseArgs, printJson } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const name = args._.join(" ").trim();
	if (!name) throw new Error("Usage: pi-wt-create <name> [--cwd <path>]");
	const state = await createWorktree({ cwd: args.cwd || process.cwd(), name });
	printJson({ status: "success", state });
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
