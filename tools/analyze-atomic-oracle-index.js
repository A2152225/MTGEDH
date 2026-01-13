/*
 * Bulk analyzer over tools/atomic-oracle-index.json.
 *
 * Usage:
 *   node tools/analyze-atomic-oracle-index.js
 *   node tools/analyze-atomic-oracle-index.js --in tools/atomic-oracle-index.json --limit 5000
 *   node tools/analyze-atomic-oracle-index.js --examples targets 10
 */

const fs = require('fs');
const path = require('path');
const { parseOracleTextToSteps } = require('./oracle-phrase-parser');

function parseArgs(argv) {
  const args = {
    inPath: 'tools/atomic-oracle-index.json',
    limit: undefined,
    examples: undefined, // { kind: string, count: number }
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === '--in' && value) {
      args.inPath = value;
      i++;
    } else if (key === '--limit' && value) {
      args.limit = Number(value);
      i++;
    } else if (key === '--examples') {
      const kind = argv[i + 1];
      const count = argv[i + 2];
      if (kind && count) {
        args.examples = { kind, count: Number(count) };
        i += 2;
      }
    }
  }

  return args;
}

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function main() {
  const args = parseArgs(process.argv);
  const resolvedIn = path.resolve(process.cwd(), args.inPath);

  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedIn, 'utf8');
  const index = JSON.parse(raw);

  const byOracleId = index?.byOracleId;
  if (!byOracleId || typeof byOracleId !== 'object') {
    console.error('Expected atomic-oracle-index.json to have { byOracleId: { ... } }');
    process.exit(1);
  }

  const oracleIds = Object.keys(byOracleId);
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(0, args.limit) : oracleIds.length;

  const counts = {
    total: 0,
    hasTargets: 0,
    hasChoices: 0,
    hasModal: 0,
    hasConditions: 0,
    hasInterveningIf: 0,
    hasThen: 0,
    hasReplacement: 0,
    hasDuration: 0,
    hasTrigger: 0,
  };

  const verbCounts = Object.create(null);

  /** @type {Array<{oracleId:string,name:string,oracleText:string,flags:any}>} */
  const examples = [];
  const wantExamples = args.examples?.kind;
  const wantCount = args.examples?.count || 0;

  for (let i = 0; i < oracleIds.length && counts.total < limit; i++) {
    const oracleId = oracleIds[i];
    const entry = byOracleId[oracleId];
    const oracleText = entry?.oracleText;
    if (typeof oracleText !== 'string' || oracleText.trim().length === 0) continue;

    const parsed = parseOracleTextToSteps(oracleText);

    counts.total++;
    for (const key of Object.keys(counts)) {
      if (key === 'total') continue;
      if (parsed.flags?.[key]) counts[key]++;
    }

    // Aggregate action verb tags.
    for (const block of parsed.blocks) {
      for (const clause of block.clauses) {
        const verbTag = clause.tags.find((t) => t.startsWith('verb:'));
        if (verbTag) inc(verbCounts, verbTag.slice('verb:'.length));
      }
    }

    // Capture examples for a requested category.
    if (wantExamples && examples.length < wantCount) {
      const flagKey =
        wantExamples === 'targets' ? 'hasTargets'
        : wantExamples === 'choices' ? 'hasChoices'
        : wantExamples === 'modal' ? 'hasModal'
        : wantExamples === 'ifs' ? 'hasInterveningIf'
        : wantExamples === 'conditions' ? 'hasConditions'
        : wantExamples === 'then' ? 'hasThen'
        : wantExamples === 'replacement' ? 'hasReplacement'
        : wantExamples === 'duration' ? 'hasDuration'
        : wantExamples === 'trigger' ? 'hasTrigger'
        : undefined;

      if (flagKey && parsed.flags?.[flagKey]) {
        examples.push({
          oracleId,
          name: Array.isArray(entry?.names) ? entry.names[0] : '(unknown)',
          oracleText,
          flags: parsed.flags,
        });
      }
    }
  }

  function pct(n) {
    return counts.total ? ((n / counts.total) * 100).toFixed(1) + '%' : '0.0%';
  }

  const topVerbs = Object.entries(verbCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  console.log('=== Atomic Oracle Clause Analysis ===');
  console.log(`Total parsed: ${counts.total} / ${limit}`);
  console.log(`Targets:        ${counts.hasTargets} (${pct(counts.hasTargets)})`);
  console.log(`Choices:        ${counts.hasChoices} (${pct(counts.hasChoices)})`);
  console.log(`Modal:          ${counts.hasModal} (${pct(counts.hasModal)})`);
  console.log(`Conditions:     ${counts.hasConditions} (${pct(counts.hasConditions)})`);
  console.log(`Intervening if: ${counts.hasInterveningIf} (${pct(counts.hasInterveningIf)})`);
  console.log(`Then:           ${counts.hasThen} (${pct(counts.hasThen)})`);
  console.log(`Replacement:    ${counts.hasReplacement} (${pct(counts.hasReplacement)})`);
  console.log(`Duration:       ${counts.hasDuration} (${pct(counts.hasDuration)})`);
  console.log(`Triggers:       ${counts.hasTrigger} (${pct(counts.hasTrigger)})`);

  console.log('\nTop clause-leading verbs (very rough):');
  for (const [verb, count] of topVerbs) {
    console.log(`- ${verb}: ${count}`);
  }

  if (examples.length) {
    console.log(`\nExamples (${wantExamples}, n=${examples.length}):`);
    for (const ex of examples) {
      console.log('---');
      console.log(`${ex.name} (${ex.oracleId})`);
      console.log(ex.oracleText);
    }
  }
}

main();
