import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());
const interveningIfPath = path.join(repoRoot, 'server', 'src', 'state', 'modules', 'triggers', 'intervening-if.ts');
const serverSrcRoot = path.join(repoRoot, 'server', 'src');

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

function extractStateKeysFromInterveningIf(text) {
	// Best-effort extraction of property names accessed via: state.foo, stateAny.foo, ctx.state.foo, (ctx.state as any).foo
	const keys = new Set();
	const patterns = [
		// Allow optional chaining: state?.foo
		/\bstate\??\.(?<key>[A-Za-z_][A-Za-z0-9_]*)\b/g,
		/\bstateAny\??\.(?<key>[A-Za-z_][A-Za-z0-9_]*)\b/g,
		/\bctx\.state\??\.(?<key>[A-Za-z_][A-Za-z0-9_]*)\b/g,
		/\b\(ctx\.state\s+as\s+any\)\??\.(?<key>[A-Za-z_][A-Za-z0-9_]*)\b/g,
		/\b\(state\s+as\s+any\)\??\.(?<key>[A-Za-z_][A-Za-z0-9_]*)\b/g,

		// Bracket access for literal keys: stateAny['foo']
		/\bstateAny\s*\[\s*['"](?<key>[A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
		/\b\(ctx\.state\s+as\s+any\)\s*\[\s*['"](?<key>[A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
		/\b\(state\s+as\s+any\)\s*\[\s*['"](?<key>[A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
	];
	for (const re of patterns) {
		for (const m of text.matchAll(re)) {
			const k = m?.groups?.key;
			if (k) keys.add(k);
		}
	}
	return [...keys].sort();
}

function isWriteLine(line, key) {
	// Detect common write patterns (assignment, compound assignment, inc/dec, mutating calls).
	// Note: we intentionally avoid deep parsing; this is a fast heuristic.
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	// property assignment: .key = ... (not ==/=== etc)
	const assignRe = new RegExp(`\\.${escapedKey}\\b[^\\n]*?(?<![=!<>])=(?![=])`);

	// map/array element assignment: .key[...]=
	const bracketAssignRe = new RegExp(`\\.${escapedKey}\\b\\s*\\[[^\\]]*\\]\\s*(?<![=!<>])=(?![=])`);

	// compound assignments / inc/dec
	const compoundRe = new RegExp(`\\.${escapedKey}\\b[^\\n]*?(\\+=|-=|\\*=|\\/=|\\+\\+|--)`);

	// mutating method calls on property
	const mutateMethodRe = new RegExp(`\\.${escapedKey}\\b\\s*\\.\\s*(push|unshift|splice|pop|shift|add|set|delete|clear)\\s*\\(`);

	return assignRe.test(line) || bracketAssignRe.test(line) || compoundRe.test(line) || mutateMethodRe.test(line);
}

function scanWrites(files, key, excludeFile) {
	const hits = [];
	for (const file of files) {
		if (excludeFile && path.resolve(file) === path.resolve(excludeFile)) continue;
		const text = fs.readFileSync(file, 'utf8');
		if (!text.includes(`.${key}`)) continue;

		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.includes(`.${key}`)) continue;
			if (isWriteLine(line, key)) {
				hits.push({ file, line: i + 1, text: line.trim() });
			}
		}
	}
	return hits;
}

function rel(p) {
	return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function main() {
	if (!fs.existsSync(interveningIfPath)) {
		console.error(`Could not find intervening-if.ts at: ${interveningIfPath}`);
		process.exit(1);
	}

	const interveningText = fs.readFileSync(interveningIfPath, 'utf8');
	const keys = extractStateKeysFromInterveningIf(interveningText);

	const files = walk(serverSrcRoot);

	const results = [];
	for (const key of keys) {
		const writes = scanWrites(files, key, interveningIfPath);
		results.push({ key, writes });
	}

	const writerless = results.filter(r => r.writes.length === 0).map(r => r.key);
	const resetOnly = results
		.filter(r => r.writes.length > 0)
		.filter(r => r.writes.every(w => rel(w.file) === 'server/src/state/modules/turn.ts'))
		.map(r => r.key);

	const hasWriters = results
		.filter(r => r.writes.length > 0)
		.filter(r => !r.writes.every(w => rel(w.file) === 'server/src/state/modules/turn.ts'))
		.map(r => r.key);

	console.log(`Intervening-if referenced state keys: ${keys.length}`);
	console.log('');

	console.log(`WRITERLESS (no writes found in server/src excluding intervening-if): ${writerless.length}`);
	for (const k of writerless) console.log(`  - ${k}`);
	console.log('');

	console.log(`RESET_ONLY (writes only in turn.ts): ${resetOnly.length}`);
	for (const k of resetOnly) console.log(`  - ${k}`);
	console.log('');

	console.log(`HAS_WRITERS (writes outside turn.ts): ${hasWriters.length}`);
	// Print a smaller sample (top 30) to avoid flooding.
	for (const k of hasWriters.slice(0, 30)) console.log(`  - ${k}`);
	if (hasWriters.length > 30) console.log(`  ... (${hasWriters.length - 30} more)`);
	console.log('');

	// For writerless keys, print 1-2 read occurrences in intervening-if to help map back to templates.
	const readContext = [];
	for (const k of writerless) {
		const re = new RegExp(
			`\\b(?:state|stateAny|ctx\\.state|\\(ctx\\.state\\s+as\\s+any\\)|\\(state\\s+as\\s+any\\))\\.${k}\\b`,
			'g',
		);
		const lines = interveningText.split(/\r?\n/);
		const hits = [];
		for (let i = 0; i < lines.length && hits.length < 2; i++) {
			if (re.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
			re.lastIndex = 0;
		}
		readContext.push({ key: k, hits });
	}

	if (readContext.length) {
		console.log('Writerless read sites in intervening-if (first 1-2 each):');
		for (const rc of readContext) {
			console.log(`  ${rc.key}:`);
			for (const h of rc.hits) {
				console.log(`    - intervening-if.ts:${h.line}: ${h.text}`);
			}
		}
	}
}

main();