/**
 * Outcome sweep comparison: diffs per-card classes between a previous run and the current one and
 * writes compare.json + compare.txt into the current run's directory.
 *
 *   newly_ok           failing before (noop / throw / stuck), ok now
 *   newly_broken       ok or skipped before, failing now
 *   changed_failure    failing in both runs, but the class or failure detail changed
 *   unchanged_failure  failing in both runs with the same class and detail
 *   newly_skipped      failing before, skipped now (often a harness change, not a fix)
 *   only_prev / only_cur  cards present in one run only (different selection or still running)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SweepCardOutcome } from './sweepPhaseCore.js';
import { readSweepResults } from './sweepReport.js';

const FAILING = new Set(['noop', 'throw', 'stuck']);

export type SweepCompareEntry = { name: string; prev: string; cur: string };
export type SweepComparison = {
  prevDir: string;
  curDir: string;
  common: number;
  transitions: Record<string, number>;
  groups: Record<string, SweepCompareEntry[]>;
};

function label(record: SweepCardOutcome): string {
  return `${record.class}${record.detail ? ` ${record.detail}` : ''}`;
}

export function compareSweepRuns(prevDir: string, curDir: string): SweepComparison {
  const prev = new Map(readSweepResults(prevDir).map((record) => [record.name, record]));
  const cur = new Map(readSweepResults(curDir).map((record) => [record.name, record]));
  const groups: Record<string, SweepCompareEntry[]> = {
    newly_ok: [], newly_broken: [], changed_failure: [], unchanged_failure: [], newly_skipped: [], only_prev: [], only_cur: [],
  };
  const transitions: Record<string, number> = {};
  let common = 0;
  for (const [name, before] of prev) {
    const after = cur.get(name);
    if (!after) {
      groups.only_prev.push({ name, prev: label(before), cur: '' });
      continue;
    }
    common += 1;
    const key = `${before.class}->${after.class}`;
    transitions[key] = (transitions[key] || 0) + 1;
    const entry = { name, prev: label(before), cur: label(after) };
    const wasFailing = FAILING.has(before.class);
    const isFailing = FAILING.has(after.class);
    if (wasFailing && after.class === 'ok') groups.newly_ok.push(entry);
    else if (wasFailing && after.class === 'skipped') groups.newly_skipped.push(entry);
    else if (!wasFailing && isFailing) groups.newly_broken.push(entry);
    else if (wasFailing && isFailing) (entry.prev === entry.cur ? groups.unchanged_failure : groups.changed_failure).push(entry);
  }
  for (const [name, after] of cur) if (!prev.has(name)) groups.only_cur.push({ name, prev: '', cur: label(after) });
  for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name));
  return { prevDir, curDir, common, transitions, groups };
}

function formatComparison(comparison: SweepComparison, maxPerGroup = 150): string {
  const lines = [
    `Outcome sweep comparison  (${new Date().toISOString()})`,
    `prev: ${comparison.prevDir}`,
    `cur:  ${comparison.curDir}`,
    `cards in both runs: ${comparison.common}`,
    '',
    '== Counts',
    ...Object.entries(comparison.groups).map(([group, list]) => `  ${group.padEnd(18)} ${list.length}`),
    '',
    '== Class transitions (prev->cur)',
    ...Object.entries(comparison.transitions).sort((a, b) => b[1] - a[1]).map(([key, count]) => `  ${String(count).padStart(6)}  ${key}`),
  ];
  for (const group of ['newly_broken', 'newly_ok', 'changed_failure', 'newly_skipped', 'unchanged_failure', 'only_prev', 'only_cur']) {
    const list = comparison.groups[group] || [];
    if (!list.length) continue;
    lines.push('', `== ${group} (${list.length})`);
    for (const entry of list.slice(0, maxPerGroup)) lines.push(`  ${entry.name}: ${entry.prev || '-'}  =>  ${entry.cur || '-'}`);
    if (list.length > maxPerGroup) lines.push(`  ... ${list.length - maxPerGroup} more in compare.json`);
  }
  return `${lines.join('\n')}\n`;
}

export function writeSweepComparison(prevDir: string, curDir: string): SweepComparison {
  const comparison = compareSweepRuns(prevDir, curDir);
  fs.writeFileSync(path.join(curDir, 'compare.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(curDir, 'compare.txt'), formatComparison(comparison), 'utf8');
  return comparison;
}

export function comparisonHeadline(comparison: SweepComparison): string {
  return Object.entries(comparison.groups).map(([group, list]) => `${group}=${list.length}`).join(' ');
}
