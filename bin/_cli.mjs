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

async function readStdinText() {
	return await new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

export async function readStateInput(args) {
	if (args["state-json"]) return JSON.parse(args["state-json"]);
	if (!process.stdin.isTTY) {
		const input = (await readStdinText()).trim();
		if (input) return JSON.parse(input);
	}
	throw new Error("Provide worktree state via --state-json or stdin.");
}

export function printJson(result) {
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
