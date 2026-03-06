#!/usr/bin/env node
import { attachWorktree } from "../lib/git-worktree.js";
import { parseArgs, printJson } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const target = args._.join(" ").trim() || undefined;
	const state = await attachWorktree({ cwd: args.cwd || process.cwd(), target });
	printJson({ status: "success", state });
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
