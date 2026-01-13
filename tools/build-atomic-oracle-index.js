/*
 * Builds a compact oracle-text index from MTGJSON AtomicCards.json.
 *
 * Usage:
 *   node tools/build-atomic-oracle-index.js
 *   node tools/build-atomic-oracle-index.js --in AtomicCards.json --out tools/atomic-oracle-index.json
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
	const args = { inPath: 'AtomicCards.json', outPath: 'tools/atomic-oracle-index.json' };
	for (let i = 2; i < argv.length; i++) {
		const key = argv[i];
		const value = argv[i + 1];
		if (key === '--in' && value) {
			args.inPath = value;
			i++;
		} else if (key === '--out' && value) {
			args.outPath = value;
			i++;
		}
	}
	return args;
}

function normalizeCardName(name) {
	return String(name || '')
		.trim()
		.toLowerCase()
		.replace(/[’]/g, "'")
		.replace(/\s+/g, ' ');
}

function pickBestPrinting(printings) {
	if (!Array.isArray(printings) || printings.length === 0) return undefined;
	// Prefer a printing with a non-empty `text` field.
	const withText = printings.find((p) => typeof p?.text === 'string' && p.text.trim().length > 0);
	return withText || printings[0];
}

function main() {
	const { inPath, outPath } = parseArgs(process.argv);

	const resolvedIn = path.resolve(process.cwd(), inPath);
	const resolvedOut = path.resolve(process.cwd(), outPath);

	if (!fs.existsSync(resolvedIn)) {
		console.error(`Input not found: ${resolvedIn}`);
		process.exit(1);
	}

	console.log(`Reading: ${resolvedIn}`);
	const raw = fs.readFileSync(resolvedIn, 'utf8');
	const atomic = JSON.parse(raw);

	const sourceVersion = atomic?.meta?.version;
	const sourceDate = atomic?.meta?.date;

	const data = atomic?.data;
	if (!data || typeof data !== 'object') {
		console.error('AtomicCards.json: expected top-level { data: { [name]: printing[] } }');
		process.exit(1);
	}

	const byOracleId = Object.create(null);
	const byName = Object.create(null);

	let cardNameCount = 0;
	let printingCount = 0;
	let skippedNoText = 0;
	let skippedNoOracleId = 0;

	for (const [name, printings] of Object.entries(data)) {
		cardNameCount++;
		if (Array.isArray(printings)) printingCount += printings.length;

		const best = pickBestPrinting(printings);
		const oracleText = typeof best?.text === 'string' ? best.text.trim() : '';
		if (!oracleText) {
			skippedNoText++;
			continue;
		}

		const oracleId = best?.identifiers?.scryfallOracleId;
		if (!oracleId || typeof oracleId !== 'string') {
			// Still index by name if we can, but it won't dedupe well.
			skippedNoOracleId++;
			const fallbackId = `name:${normalizeCardName(name)}`;
			if (!byOracleId[fallbackId]) {
				byOracleId[fallbackId] = { oracleText, names: [name] };
			} else if (!byOracleId[fallbackId].names.includes(name)) {
				byOracleId[fallbackId].names.push(name);
			}
			byName[normalizeCardName(name)] = fallbackId;
			continue;
		}

		if (!byOracleId[oracleId]) {
			byOracleId[oracleId] = { oracleText, names: [name] };
		} else {
			// Prefer the first text we saw; just accumulate name aliases.
			if (!byOracleId[oracleId].names.includes(name)) {
				byOracleId[oracleId].names.push(name);
			}
		}

		byName[normalizeCardName(name)] = oracleId;
	}

	const out = {
		meta: {
			generatedAt: new Date().toISOString(),
			source: 'MTGJSON AtomicCards.json',
			sourceVersion: sourceVersion ?? null,
			sourceDate: sourceDate ?? null,
			notes: [
				'byName maps normalized card name -> oracleId',
				'byOracleId maps oracleId -> { oracleText, names[] }',
				'If scryfallOracleId is missing, oracleId falls back to "name:<normalized>"',
			],
		},
		stats: {
			cardNameCount,
			printingCount,
			uniqueOracleIds: Object.keys(byOracleId).length,
			skippedNoText,
			skippedNoOracleId,
		},
		byName,
		byOracleId,
	};

	fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
	fs.writeFileSync(resolvedOut, JSON.stringify(out));

	console.log(`Wrote: ${resolvedOut}`);
	console.log(
		`Cards: ${cardNameCount} | Printings: ${printingCount} | Unique oracleIds: ${out.stats.uniqueOracleIds}`
	);
	console.log(`Skipped (no text): ${skippedNoText} | Missing oracleId: ${skippedNoOracleId}`);
}

main();