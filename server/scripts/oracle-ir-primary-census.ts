/*
  Bounded vitest PRIMARY=1 failure census.

  Vitest setup forces ORACLE_IR_*_PRIMARY=0 unless a census env is set.
  This script sets ORACLE_IR_CENSUS_SPELL_PRIMARY=1 (default) and runs a
  spell-resolve slice so production-on failures can be clustered without
  flipping the suite default.

  Usage (from server/):
    npm run oracle-ir:primary-census
    npm run oracle-ir:primary-census -- --scope=spell
    npm run oracle-ir:primary-census -- --scope=graveyard
    npm run oracle-ir:primary-census -- --from-raw
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const testsDir = path.join(serverRoot, 'tests');
const defaultOut = path.join(__dirname, 'out', 'oracle-ir-primary-census.json');
const defaultRaw = path.join(__dirname, 'out', 'oracle-ir-primary-census.raw.json');

const SPELL_PREFIXES = [
  'cast-from-graveyard',
  'stack.',
  'stack-',
  'resolve-spell',
  'resolve-top-of-stack',
  'think-twice-hand-flashback',
  'effect-program',
  'compound-spell',
  'inspiring-call',
  'oracle-ir-phase4',
  'oracle-ir-nibelheim',
  'oracle-ir-approach',
  'oracle-ir-temporary-etb',
];

const GRAVEYARD_PREFIXES = [
  'cast-from-graveyard',
  'think-twice-hand-flashback',
  'oracle-ir-phase4',
  'oracle-ir-nibelheim',
  'oracle-ir-approach',
  'oracle-ir-temporary-etb',
];

type CensusScope = 'spell' | 'graveyard';

type FailedAssertion = {
  file: string;
  fullName: string;
  message: string;
  cluster: string;
  family: string;
};

function parseArgs(argv: string[]): {
  scope: CensusScope;
  outPath: string;
  rawPath: string;
  fromRaw: boolean;
} {
  let scope: CensusScope = 'spell';
  let outPath = defaultOut;
  let rawPath = defaultRaw;
  let fromRaw = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from-raw') {
      fromRaw = true;
    } else if (arg === '--scope' && argv[i + 1]) {
      const value = String(argv[++i] || '').trim();
      if (value === 'spell' || value === 'graveyard') scope = value;
      else throw new Error(`Unknown --scope ${value} (spell|graveyard)`);
    } else if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length).trim();
      if (value === 'spell' || value === 'graveyard') scope = value;
      else throw new Error(`Unknown --scope ${value} (spell|graveyard)`);
    } else if (arg === '--out' && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    } else if (arg === '--raw' && argv[i + 1]) {
      rawPath = path.resolve(argv[++i]);
    }
  }
  return { scope, outPath, rawPath, fromRaw };
}

function classifyFamily(fullName: string): string {
  const name = fullName.toLowerCase();
  if (name.includes('past in flames')) return 'temporary-gy-flashback-grants';
  if (name.includes('will of the jeskai') && name.includes('both modes')) return 'modal-choose-both-commander';
  if (name.includes('will of the jeskai')) return 'modal-flashback-grant';
  if (name.includes('electroduplicate')) return 'token-copy-haste-sacrifice';
  if (name.includes('galvanic')) return 'delayed-copy-next-spell';
  if (
    name.includes('memory deluge')
    || name.includes('siphon insight')
    || name.includes('forbidden alchemy')
    || name.includes('genesis wave')
  ) {
    return 'look-search-library-prompt';
  }
  if (name.includes('otherworldly gaze')) return 'surveil-flashback-exile';
  if (name.includes('nibelheim')) return 'nibelheim-gy-rider';
  if (name.includes('divine reckoning') || name.includes("prisoner's dilemma")) {
    return 'divine-prisoner-replay-exile';
  }
  if (name.includes('faithless') || name.includes('faithful mending')) {
    return 'draw-then-discard-flashback-exile';
  }
  if (name.includes('torrential')) return 'gearhulk-free-cast-exile';
  if (name.includes('summons')) return 'summons-x-from-exile';
  if (name.includes('ponder')) return 'ponder-prompt-type';
  if (name.includes('color-choice') || name.includes('color choice')) {
    return 'color-choice-prompt-payload';
  }
  return 'other';
}

function listTestFiles(prefixes: readonly string[]): string[] {
  const files = fs.readdirSync(testsDir)
    .filter((entry) => entry.endsWith('.test.ts'))
    .filter((entry) => prefixes.some((prefix) => entry.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));
  return files.map((entry) => path.join('tests', entry));
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function clusterKey(message: string): string {
  const firstLine = stripAnsi(message)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '(empty)';
  return firstLine
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:\\[^\s:]+/g, '<path>')
    .replace(/\/?(?:server|tests|src)\/[\w./\\-]+\.(?:ts|js):\d+(?::\d+)?/g, '<file>')
    .replace(/:\d+:\d+/g, '')
    .slice(0, 220);
}

type VitestJsonReport = {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  success?: boolean;
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      failureMessages?: string[];
    }>;
  }>;
};

function collectFailures(report: VitestJsonReport): FailedAssertion[] {
  const failures: FailedAssertion[] = [];
  for (const suite of report.testResults || []) {
    const file = String(suite.name || '')
      .replace(/\\/g, '/')
      .replace(/^.*\/tests\//, 'tests/');
    for (const assertion of suite.assertionResults || []) {
      if (String(assertion.status || '') !== 'failed') continue;
      const message = stripAnsi(String((assertion.failureMessages || [])[0] || ''));
      const fullName = String(assertion.fullName || assertion.title || '');
      failures.push({
        file,
        fullName,
        message,
        cluster: clusterKey(message),
        family: classifyFamily(fullName),
      });
    }
  }
  return failures;
}

function bucketBy(failures: FailedAssertion[], keyOf: (failure: FailedAssertion) => string) {
  const buckets = new Map<string, FailedAssertion[]>();
  for (const failure of failures) {
    const key = keyOf(failure);
    const bucket = buckets.get(key) || [];
    bucket.push(failure);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, items]) => ({
      key,
      count: items.length,
      files: [...new Set(items.map((item) => item.file))],
      tests: items.map((item) => item.fullName),
    }));
}

function main(): void {
  const { scope, outPath, rawPath, fromRaw } = parseArgs(process.argv.slice(2));
  const prefixes = scope === 'graveyard' ? GRAVEYARD_PREFIXES : SPELL_PREFIXES;
  const files = listTestFiles(prefixes);
  if (files.length === 0) {
    throw new Error(`No test files matched scope=${scope}`);
  }

  let vitestExit = 0;
  if (!fromRaw) {
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    if (fs.existsSync(rawPath)) fs.rmSync(rawPath, { force: true });

    console.log(`Oracle IR PRIMARY=1 census: scope=${scope}, ${files.length} file(s)`);
    for (const file of files) console.log(`  ${file}`);

    const result = spawnSync(
      'npx',
      [
        'vitest',
        'run',
        ...files,
        '--pool=threads',
        '--maxWorkers=1',
        '--reporter=json',
        `--outputFile=${rawPath}`,
      ],
      {
        cwd: serverRoot,
        shell: true,
        env: {
          ...process.env,
          ORACLE_IR_CENSUS_SPELL_PRIMARY: '1',
          // vitest.setup.ts only honors census flags inside an explicit census run.
          ORACLE_IR_CENSUS_RUN: '1',
        },
        stdio: 'inherit',
      },
    );
    vitestExit = result.status ?? 1;
  } else {
    console.log(`Re-summarizing PRIMARY=1 census from ${rawPath}`);
  }

  if (!fs.existsSync(rawPath)) {
    throw new Error(`Vitest did not write JSON report to ${rawPath} (exit ${vitestExit})`);
  }

  const report = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as VitestJsonReport;
  const failures = collectFailures(report);
  const clustered = bucketBy(failures, (failure) => failure.cluster);
  const families = bucketBy(failures, (failure) => failure.family);

  const summary = {
    scope,
    censusSpellPrimary: true,
    censusTriggerPrimary: false,
    filesRun: files,
    numTotalTests: report.numTotalTests ?? null,
    numPassedTests: report.numPassedTests ?? null,
    numFailedTests: report.numFailedTests ?? failures.length,
    numPendingTests: report.numPendingTests ?? null,
    vitestExit: fromRaw ? (failures.length > 0 ? 1 : 0) : vitestExit,
    failureCount: failures.length,
    clusterCount: clustered.length,
    familyCount: families.length,
    families,
    clusters: clustered,
    failures: failures.map((failure) => ({
      file: failure.file,
      fullName: failure.fullName,
      family: failure.family,
      cluster: failure.cluster,
    })),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(
    `Census: ${summary.numFailedTests} failed / ${summary.numTotalTests} tests, `
    + `${families.length} famil${families.length === 1 ? 'y' : 'ies'} → ${outPath}`,
  );
  for (const family of families) {
    console.log(`  [${family.count}] ${family.key}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
