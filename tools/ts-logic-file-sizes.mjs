#!/usr/bin/env node
/**
 * TypeScript logic file size inventory (bytes on disk, not line count).
 *
 * Why bytes: oracleIRParser.ts is only ~2.1k lines but ~863 KB of dense regex
 * and string literals. Line count badly under-reports how much context a file
 * costs an agent, so the ~40KB ceiling in
 * .cursor/rules/typescript-max-40kb-split.mdc is measured in bytes.
 *
 * Usage:
 *   node tools/ts-logic-file-sizes.mjs                # oversized files only
 *   node tools/ts-logic-file-sizes.mjs --all          # every scanned file
 *   node tools/ts-logic-file-sizes.mjs --top 25       # limit rows printed
 *   node tools/ts-logic-file-sizes.mjs --include-tests
 *   node tools/ts-logic-file-sizes.mjs --scope server/src/socket
 *   node tools/ts-logic-file-sizes.mjs --json         # machine-readable
 *
 * Exit code is always 0; this is an inventory, not a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT_BYTES = 40 * 1024; // 40960 - the ~40KB ceiling
const WARN_BYTES = 36 * 1024; // near the ceiling: add a sibling, do not grow

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_ROOTS = [
	path.join('server', 'src'),
	path.join('rules-engine', 'src'),
	path.join('client', 'src'),
	path.join('shared', 'src'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'out']);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts)$/i;
const TEST_DIR = /(^|[\\/])(tests?|__tests__)([\\/]|$)/i;
const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/i;

function parseArgs(argv) {
	const opts = { all: false, json: false, includeTests: false, top: 0, scopes: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--all') opts.all = true;
		else if (arg === '--json') opts.json = true;
		else if (arg === '--include-tests') opts.includeTests = true;
		else if (arg === '--top') opts.top = Number(argv[++i]) || 0;
		else if (arg === '--scope') opts.scopes.push(argv[++i]);
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else if (arg.startsWith('--')) opts.unknown = arg;
		else opts.scopes.push(arg);
	}
	return opts;
}

function walk(dir, out) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(full, out);
		} else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
			out.push(full);
		}
	}
	return out;
}

function kb(bytes) {
	return (bytes / 1024).toFixed(1);
}

function collect(opts) {
	const roots = (opts.scopes.length ? opts.scopes : DEFAULT_ROOTS).map((scope) =>
		path.isAbsolute(scope) ? scope : path.join(repoRoot, scope)
	);
	const files = [];
	for (const root of roots) walk(root, files);

	const rows = [];
	for (const full of files) {
		const rel = path.relative(repoRoot, full).split(path.sep).join('/');
		const isTest = TEST_FILE.test(full) || TEST_DIR.test(rel);
		if (isTest && !opts.includeTests) continue;
		let bytes;
		try {
			bytes = fs.statSync(full).size;
		} catch {
			continue;
		}
		rows.push({ path: rel, bytes, kb: Number(kb(bytes)), over: bytes > LIMIT_BYTES, isTest });
	}
	rows.sort((a, b) => b.bytes - a.bytes);
	return rows;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log('node tools/ts-logic-file-sizes.mjs [--all] [--json] [--include-tests] [--top N] [--scope <dir>]');
		return;
	}
	if (opts.unknown) {
		console.error(`Unknown flag: ${opts.unknown} (try --help)`);
		return;
	}

	const rows = collect(opts);
	const over = rows.filter((r) => r.over);
	const near = rows.filter((r) => !r.over && r.bytes >= WARN_BYTES);
	const shown = opts.all ? rows : over;
	const limited = opts.top > 0 ? shown.slice(0, opts.top) : shown;

	if (opts.json) {
		console.log(
			JSON.stringify(
				{
					limitBytes: LIMIT_BYTES,
					warnBytes: WARN_BYTES,
					scanned: rows.length,
					overCount: over.length,
					nearCount: near.length,
					totalBytes: rows.reduce((sum, r) => sum + r.bytes, 0),
					files: limited,
				},
				null,
				2
			)
		);
		return;
	}

	const label = opts.all ? 'scanned files' : `files over ${kb(LIMIT_BYTES)} KB`;
	console.log(`TS logic file sizes (bytes on disk) - ${label}`);
	console.log(`Ceiling ${LIMIT_BYTES} bytes (~40 KB); near-ceiling warning at ${WARN_BYTES} bytes (~36 KB)`);
	console.log('');

	const width = limited.reduce((max, r) => Math.max(max, r.path.length), 0);
	for (const row of limited) {
		const flag = row.over ? 'OVER' : row.bytes >= WARN_BYTES ? 'NEAR' : '    ';
		console.log(`${flag}  ${String(row.kb).padStart(8)} KB  ${String(row.bytes).padStart(9)} B  ${row.path.padEnd(width)}`);
	}

	if (!limited.length) console.log('(none)');
	console.log('');
	console.log(`Scanned ${rows.length} files. Over ceiling: ${over.length}. Near ceiling (>=36 KB): ${near.length}.`);
	if (!opts.all && over.length) {
		console.log('Add a sibling module instead of growing these. See docs/mtg-logic-module-map.md');
	}
	if (opts.top > 0 && shown.length > limited.length) {
		console.log(`(showing top ${limited.length} of ${shown.length})`);
	}
}

main();
