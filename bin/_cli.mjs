import { readFile } from "node:fs/promises";

export function parseArgs(argv) {
	const args = { _: [] };
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) {
			args._.push(token);
			continue;
		}
		const key = token.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		index += 1;
	}
	return args;
}

export function asBoolean(value, fallback) {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	return !["false", "0", "no"].includes(String(value).toLowerCase());
}

export async function readStateInput(args) {
	if (args["state-json"]) return JSON.parse(args["state-json"]);
	if (!process.stdin.isTTY) {
		const input = (await readFile(process.stdin.fd, "utf8")).trim();
		if (input) return JSON.parse(input);
	}
	throw new Error("Provide worktree state via --state-json or stdin.");
}

export function printJson(result) {
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
