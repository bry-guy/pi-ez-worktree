#!/usr/bin/env node
import { formatWorktreeListText, listAttachableWorktrees } from "../lib/git-worktree.js";
import { parseArgs, printJson } from "./_cli.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const info = await listAttachableWorktrees(args.cwd || process.cwd());
	printJson({ status: "success", details: info, text: formatWorktreeListText(info) });
}

main().catch((error) => {
	printJson({ status: "error", message: error.message });
	process.exitCode = 1;
});
