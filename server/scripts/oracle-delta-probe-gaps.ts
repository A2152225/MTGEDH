/*
  Delta → overlay probe workflow (D1 follow-on).

  Reads overlayWorkQueue from the delta audit report and runs overlay probes
  for each gap card so operators can triage new-set changes in one command.

  Run (from server/):
    npm run oracle-ir:delta:probe
    npm run oracle-ir:delta:probe -- --refresh
    npm run oracle-ir:delta:probe -- --max 10

  Optional env:
    ORACLE_DELTA_PROBE_MAX=25
    ORACLE_DELTA_PROBE_REPORT=path/to/oracle-delta-coverage-audit.json
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import {
  probeCompiledOracleIrOverlay,
  printOverlayProbeResult,
  type OverlayProbeResult,
} from './probeCompiledOracleIrOverlayCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const defaultReportPath = path.join(__dirname, 'out', 'oracle-delta-coverage-audit.json');
const outPath = path.join(__dirname, 'out', 'oracle-delta-probe-gaps.json');

type OverlayWorkQueueEntry = {
  name: string;
  oracleId?: string;
  changeType?: string;
  reasons?: string[];
  suggestedAction?: string;
};

type DeltaReport = {
  delta?: { gapCards?: number };
  overlayWorkQueue?: OverlayWorkQueueEntry[];
};

function parseArgs(): { refresh: boolean; maxCards: number; reportPath: string } {
  const argv = process.argv.slice(2);
  const reportFlagIndex = argv.indexOf('--report');
  const maxFlagIndex = argv.indexOf('--max');
  const reportPath = reportFlagIndex >= 0 && argv[reportFlagIndex + 1]
    ? path.resolve(argv[reportFlagIndex + 1])
    : process.env.ORACLE_DELTA_PROBE_REPORT
      ? path.resolve(process.env.ORACLE_DELTA_PROBE_REPORT)
      : defaultReportPath;
  const maxRaw = maxFlagIndex >= 0 && argv[maxFlagIndex + 1]
    ? argv[maxFlagIndex + 1]
    : process.env.ORACLE_DELTA_PROBE_MAX || '25';
  const maxCards = Math.max(0, Number.parseInt(String(maxRaw), 10) || 25);
  return {
    refresh: argv.includes('--refresh'),
    maxCards,
    reportPath,
  };
}

function runDeltaAudit(): void {
  const result = spawnSync('npm', ['run', 'oracle-ir:delta', '--', '--no-fail'], {
    cwd: serverRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  const args = parseArgs();

  if (args.refresh) {
    console.log('Refreshing delta audit (--no-fail)…\n');
    runDeltaAudit();
  }

  if (!fs.existsSync(args.reportPath)) {
    console.error(`Delta report not found: ${args.reportPath}`);
    console.error('Run: npm run oracle-ir:delta  (or npm run oracle-ir:delta:probe -- --refresh)');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(args.reportPath, 'utf8')) as DeltaReport;
  const queue = Array.isArray(report.overlayWorkQueue) ? report.overlayWorkQueue : [];
  const toProbe = args.maxCards > 0 ? queue.slice(0, args.maxCards) : queue;

  console.log('Oracle delta → overlay probe');
  console.log('============================');
  console.log(`Report: ${args.reportPath}`);
  console.log(`Gap cards in queue: ${queue.length}; probing: ${toProbe.length}`);

  if (toProbe.length === 0) {
    console.log('No gap cards — overlay workflow clear.');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      meta: { generatedAt: new Date().toISOString(), reportPath: args.reportPath },
      probed: 0,
      results: [],
    }, null, 2));
    console.log(`Wrote report: ${outPath}`);
    return;
  }

  ensureLocalCardLookupIndexSync();

  const results: Array<OverlayProbeResult & {
    oracleId?: string;
    changeType?: string;
    gapReasons?: string[];
    suggestedAction?: string;
    probeError?: string;
  }> = [];

  for (const entry of toProbe) {
    console.log(`\n--- ${entry.name} [${entry.changeType || 'gap'}] ---`);
    if (entry.reasons?.length) {
      console.log(`  delta reasons: ${entry.reasons.join(', ')}`);
    }
    if (entry.suggestedAction) {
      console.log(`  suggested: ${entry.suggestedAction}`);
    }
    try {
      const probe = probeCompiledOracleIrOverlay({
        name: entry.name,
        cardId: entry.oracleId,
      });
      printOverlayProbeResult(probe);
      results.push({
        ...probe,
        oracleId: entry.oracleId,
        changeType: entry.changeType,
        gapReasons: entry.reasons,
        suggestedAction: entry.suggestedAction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  probe failed: ${message}`);
      results.push({
        name: entry.name,
        oracleId: entry.oracleId,
        changeType: entry.changeType,
        gapReasons: entry.reasons,
        suggestedAction: entry.suggestedAction,
        probeError: message,
        oracleTextChars: 0,
        parserAbilityCount: 0,
        parserStepKinds: '',
        parserUnknownCount: 0,
        parserUnknownSamples: [],
        collectedStepKinds: '',
        hasStoredOverlay: false,
        overlayStepKinds: '',
        overlayFallbackToBespoke: false,
        recommendation: 'probe_failed',
      });
    }
  }

  const summary = {
    meta: {
      generatedAt: new Date().toISOString(),
      reportPath: args.reportPath,
      gapCards: queue.length,
      probed: results.length,
    },
    results,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote probe summary: ${outPath}`);
}

main();
