/*
  Evidence-driven legacy handler triage (task D3).

  Cross-references applyRetiredTriggerLegacy* exports with legacy_handled
  telemetry so deletions are justified by migration/soak data instead of
  speculative audits.

  Usage (from server/):
    npm run oracle-ir:legacy-triage
    npm run oracle-ir:legacy-triage -- --snapshot scripts/out/telemetry-snapshot.json
    npm run test:oracle-ir-migration   # then triage reads in-process snapshot via --after-migration

  Workflow:
    1. Reset telemetry, run migration (or live soak).
    2. Save GET /api/oracle-ir/telemetry JSON to scripts/out/telemetry-snapshot.json
       OR pass --snapshot to this script.
    3. Delete handler families marked "orphaned" (not in routing) or "never_fired"
       (no legacy_family in telemetry), then lower ratchet ceilings.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getOracleIrGapTelemetrySnapshot,
  loadOracleIrGapTelemetrySnapshotFromAppendLog,
  resetOracleIrGapTelemetry,
  type OracleIrGapTelemetrySnapshot,
} from '../src/state/modules/oracleIrGapTelemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulesDir = path.join(__dirname, '..', 'src', 'state', 'modules');
const defaultOut = path.join(__dirname, 'out', 'oracle-ir-legacy-triage.json');

function parseArgs(argv: string[]): { snapshotPath?: string; afterMigration: boolean; outPath: string } {
  let snapshotPath: string | undefined;
  let afterMigration = false;
  let outPath = defaultOut;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--after-migration') {
      afterMigration = true;
    } else if (arg === '--snapshot' && argv[i + 1]) {
      snapshotPath = argv[++i];
    } else if (arg === '--out' && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    }
  }

  return { snapshotPath, afterMigration, outPath };
}

function listLegacyHandlerExports(): Array<{ name: string; file: string }> {
  const exports: Array<{ name: string; file: string }> = [];
  const pattern = /export function (applyRetiredTriggerLegacy\w+)/g;
  for (const file of fs.readdirSync(modulesDir).filter((entry) => entry.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(modulesDir, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      exports.push({ name: match[1], file });
    }
  }
  return exports.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}

function handlersReferencedInRouting(): Set<string> {
  const allExports = new Map<string, string>();
  const pattern = /export function (applyRetiredTriggerLegacy\w+)/g;
  for (const file of fs.readdirSync(modulesDir).filter((entry) => entry.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(modulesDir, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      allExports.set(match[1], file);
    }
  }

  const roots = [
    'stackExecuteTriggerEffectUtils.ts',
    'stackExecuteTriggerEffectLegacyBodyUtils.ts',
    'stackExecuteTriggerEffectTailUtils.ts',
    'stackExecuteTriggerEffectPrefaceUtils.ts',
    'oracleIrTriggerUncategorizedFallback.ts',
  ];

  const referenced = new Set<string>();
  const queue = [...roots.map((file) => path.join(modulesDir, file))];
  const visitedFiles = new Set<string>();

  while (queue.length > 0) {
    const filePath = queue.pop()!;
    if (visitedFiles.has(filePath) || !fs.existsSync(filePath)) continue;
    visitedFiles.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/applyRetiredTriggerLegacy\w+/g)) {
      const name = match[0];
      referenced.add(name);
      const ownerFile = allExports.get(name);
      if (ownerFile) {
        queue.push(path.join(modulesDir, ownerFile));
      }
    }
  }

  return referenced;
}

export function collectLegacyFamilies(snapshot: OracleIrGapTelemetrySnapshot): Set<string> {
  const families = new Set<string>();
  for (const event of snapshot.recentEvents) {
    if (event.kind !== 'legacy_handled') continue;
    for (const reason of event.reasons || []) {
      const match = /^legacy_family:(.+)$/.exec(String(reason));
      if (match) families.add(match[1]);
    }
  }
  return families;
}

export function collectLegacyHandlers(snapshot: OracleIrGapTelemetrySnapshot): Set<string> {
  const handlers = new Set<string>();
  for (const event of snapshot.recentEvents) {
    if (event.kind !== 'legacy_handled') continue;
    for (const reason of event.reasons || []) {
      const match = /^legacy_handler:(.+)$/.exec(String(reason));
      if (match) handlers.add(match[1]);
    }
  }
  return handlers;
}

function loadSnapshot(snapshotPath?: string): OracleIrGapTelemetrySnapshot {
  if (snapshotPath) {
    const resolved = path.resolve(snapshotPath);
    const appendPath = `${resolved}.jsonl`;
    if (fs.existsSync(appendPath)) {
      return loadOracleIrGapTelemetrySnapshotFromAppendLog(appendPath);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw) as OracleIrGapTelemetrySnapshot;
  }
  return getOracleIrGapTelemetrySnapshot();
}

function main(): void {
  const { snapshotPath, afterMigration, outPath } = parseArgs(process.argv.slice(2));

  if (!snapshotPath && !afterMigration) {
    // Read-only triage against current in-process counters (often empty).
    console.warn(
      '[oracle-ir-legacy-triage] No --snapshot provided. Using in-process telemetry ' +
        '(run migration first or pass --snapshot scripts/out/telemetry-snapshot.json).',
    );
  }

  const snapshot = loadSnapshot(snapshotPath);
  const exports = listLegacyHandlerExports();
  const referenced = handlersReferencedInRouting();
  const firedFamilies = collectLegacyFamilies(snapshot);
  const firedHandlers = collectLegacyHandlers(snapshot);

  const orphaned = exports.filter((entry) => !referenced.has(entry.name));
  const wired = exports.filter((entry) => referenced.has(entry.name));

  const report = {
    generatedAt: new Date().toISOString(),
    snapshotSource: snapshotPath || (afterMigration ? 'in-process-after-migration' : 'in-process'),
    exportCount: exports.length,
    referencedCount: wired.length,
    orphanedCount: orphaned.length,
    legacyHandledEvents: snapshot.byKind?.legacy_handled ?? 0,
    allOrNothingFailures: snapshot.byKind?.all_or_nothing_failure ?? 0,
    ownedButUnhandled: snapshot.byKind?.owned_but_unhandled ?? 0,
    staticOwnedButUnhandled: snapshot.byScopeKind?.['static:owned_but_unhandled'] ?? 0,
    replacementOwnedButUnhandled: snapshot.byScopeKind?.['replacement:owned_but_unhandled'] ?? 0,
    firedLegacyFamilies: [...firedFamilies].sort(),
    firedLegacyHandlers: [...firedHandlers].sort(),
    orphanedExports: orphaned,
    wiredExportsNeverFiredInSnapshot: wired
      .map((entry) => entry.name)
      .filter((name) => !firedHandlers.has(name)),
    telemetryTopLabels: snapshot.topLabels?.filter((row) => row.kind === 'legacy_handled') ?? [],
    recommendation:
      'Delete orphanedExports first (not imported by routing). For wired handlers, delete ' +
      'only when legacy_handler never appears in firedLegacyHandlers after a forced-legacy soak ' +
      'and IR-primary migration soak shows no owned_but_unhandled for that effect class.',
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote legacy triage report: ${outPath}`);
  console.log(
    `Exports: ${report.exportCount} (${report.orphanedCount} orphaned, ${report.referencedCount} wired); ` +
      `legacy_handled events in snapshot: ${report.legacyHandledEvents}` +
      (firedFamilies.size > 0 ? `; families: ${[...firedFamilies].sort().join(', ')}` : '') +
      (firedHandlers.size > 0 ? `; handlers: ${[...firedHandlers].sort().join(', ')}` : ''),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reset')) {
    resetOracleIrGapTelemetry();
  }
  main();
}
