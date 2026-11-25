/**
 * Outcome sweep report: reads per-card JSONL results and writes summary.json + summary.txt grouped
 * by class, failure kind (detail) and oracle-pattern family (phase:family), with example cards.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SweepCardOutcome, SweepClass, SweepPhaseOutcome } from './sweepDriver.js';

type Group = { key: string; count: number; examples: string[] };

function bump(map: Map<string, Group>, key: string, example: string, maxExamples = 8): void {
  const group = map.get(key) || { key, count: 0, examples: [] };
  group.count += 1;
  if (group.examples.length < maxExamples && !group.examples.includes(example)) group.examples.push(example);
  map.set(key, group);
}

function sorted(map: Map<string, Group>, top = 40): Group[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, top);
}

export function readSweepResults(outDir: string): SweepCardOutcome[] {
  const byName = new Map<string, SweepCardOutcome>();
  if (!fs.existsSync(outDir)) return [];
  for (const file of fs.readdirSync(outDir).filter((name) => /^results(?:\.\d+)?\.jsonl$/.test(name)).sort()) {
    for (const line of fs.readFileSync(path.join(outDir, file), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as SweepCardOutcome;
        if (record?.name) byName.set(record.name, record);
      } catch { /* partial line from an interrupted chunk */ }
    }
  }
  return [...byName.values()];
}

export function buildSweepSummary(results: SweepCardOutcome[]) {
  const classes: Record<SweepClass, number> = { ok: 0, noop: 0, throw: 0, stuck: 0, skipped: 0 };
  const phaseClasses: Record<string, number> = {};
  const byKind = new Map<string, Group>();
  const byFamily: Record<string, Map<string, Group>> = { noop: new Map(), throw: new Map(), stuck: new Map() };
  const okWeak = new Map<string, Group>();
  const skippedReasons = new Map<string, Group>();
  const telemetryOnFailures = new Map<string, Group>();
  const untested = new Map<string, Group>();
  const builderRejects = new Map<string, Group>();
  let totalMs = 0;
  for (const card of results) {
    classes[card.class] = (classes[card.class] || 0) + 1;
    totalMs += Number(card.ms || 0);
    for (const kind of card.untestedTriggers || []) bump(untested, kind, card.name, 4);
    for (const entry of card.phases as SweepPhaseOutcome[]) {
      phaseClasses[`${entry.phase}:${entry.class}`] = (phaseClasses[`${entry.phase}:${entry.class}`] || 0) + 1;
      const example = `${card.name} [${entry.label}]`;
      for (const note of entry.notes || []) if (note.startsWith('ai_builder_rejected:')) bump(builderRejects, note.slice('ai_builder_rejected:'.length), example);
      if (entry.class === 'skipped') bump(skippedReasons, String(entry.detail || 'unknown'), card.name, 4);
      if (entry.class === 'ok' && entry.detail?.startsWith('weak:')) {
        for (const key of entry.detail.slice(5).split(',')) bump(okWeak, key, example, 4);
      }
      if (entry.class === 'noop' || entry.class === 'throw' || entry.class === 'stuck') {
        bump(byKind, `${entry.class} ${entry.phase}:${entry.detail || '-'}`, example);
        bump(byFamily[entry.class], `${entry.phase}:${entry.family}${entry.conditional ? ' (conditional)' : ''}`, example);
        for (const line of card.telemetry || []) bump(telemetryOnFailures, line, card.name, 4);
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    cards: results.length,
    classes,
    phaseClasses,
    avgMsPerCard: results.length ? Math.round(totalMs / results.length) : 0,
    failureKinds: sorted(byKind, 60),
    noopFamilies: sorted(byFamily.noop),
    throwFamilies: sorted(byFamily.throw),
    stuckFamilies: sorted(byFamily.stuck),
    okWeakKeys: sorted(okWeak, 20),
    skippedReasons: sorted(skippedReasons, 20),
    telemetryOnFailures: sorted(telemetryOnFailures, 20),
    untestedTriggers: sorted(untested, 12),
    aiBuilderRejections: sorted(builderRejects, 20),
  };
}

function section(title: string, groups: Group[]): string {
  if (!groups.length) return `\n== ${title} ==\n  (none)\n`;
  return `\n== ${title} ==\n${groups.map((group) => `  ${String(group.count).padStart(5)}  ${group.key}\n         e.g. ${group.examples.join('; ')}`).join('\n')}\n`;
}

export function writeSweepReport(outDir: string): ReturnType<typeof buildSweepSummary> {
  const results = readSweepResults(outDir);
  const summary = buildSweepSummary(results);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const failing = results.filter((card) => card.class === 'noop' || card.class === 'throw' || card.class === 'stuck')
    .sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(outDir, 'failures.json'), `${JSON.stringify(failing, null, 2)}\n`, 'utf8');
  const lines = [
    `Outcome sweep summary  (${summary.generatedAt})`,
    `cards: ${summary.cards}   avg ms/card: ${summary.avgMsPerCard}`,
    `classes: ${Object.entries(summary.classes).map(([key, value]) => `${key}=${value}`).join('  ')}`,
    `phases: ${Object.entries(summary.phaseClasses).sort().map(([key, value]) => `${key}=${value}`).join('  ')}`,
    section('Failure kinds (class phase:detail)', summary.failureKinds),
    section('Noop families (phase:oracle family)', summary.noopFamilies),
    section('Throw families (phase:oracle family)', summary.throwFamilies),
    section('Stuck families (phase:oracle family)', summary.stuckFamilies),
    section('Oracle IR telemetry on failing cards', summary.telemetryOnFailures),
    section('ok via weak-only changes (review: flag-only effects or noise)', summary.okWeakKeys),
    section('Skipped reasons', summary.skippedReasons),
    section('Trigger kinds present but not driven', summary.untestedTriggers),
    section('AI builder answers rejected by the step (retried with a human-style answer; AI bugs, not card failures)', summary.aiBuilderRejections),
  ];
  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${lines.join('\n')}\n`, 'utf8');
  return summary;
}
