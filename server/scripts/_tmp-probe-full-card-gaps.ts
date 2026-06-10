/**
 * Probe remaining full-card gap clusters — run: npx tsx scripts/_tmp-probe-full-card-gaps.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
    }
    if ((node as any).amount?.kind === 'unknown') unknowns.push(`amount:${(node as any).amount.raw}`);
    if ((node as any).who?.kind === 'unknown') unknowns.push(`who:${(node as any).who.raw}`);
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

function probe(name: string): void {
  const card = cards.find((c) => c.name === name);
  if (!card) { console.log(`\n[${name}] NOT FOUND`); return; }
  const oracle = getCombinedOracleText(card);
  console.log(`\n=== ${name} ===`);
  const parsed = parseOracleTextToIR(oracle, name);
  const unknowns = collectUnknowns(parsed);
  console.log('parser unknowns:', unknowns.length ? unknowns.slice(0, 5) : 'none');
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const irGaps = hasUnknownIRSteps(text, name);
    const steps = collectStepsFromIrText(text, name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (irGaps.length || (rec.status !== 'fully_applied' && rec.status !== 'choice_required')) {
      console.log(' ability:', text.slice(0, 120).replace(/\n/g, ' '));
      console.log('  steps:', steps.map((s) => s.kind).join(', '));
      console.log('  status:', rec.status, 'reasons:', rec.reasonCodes);
      if (irGaps.length) console.log('  irGaps:', irGaps.slice(0, 3));
    }
  }
}

await loadEffectIrParser();

for (const name of [
  'No Witnesses',
  'Summon: Magus Sisters',
  'Xantcha, Sleeper Agent',
  'Jailbreak',
  'Stolen Uniform',
  'Ugin, the Ineffable',
  'The War in Heaven',
  'Wishing Well',
  'Captain America, First Avenger',
  "Eventide's Shadow",
  'Brain Pry',
  'Fateful Tempest',
  "Pharika's Spawn",
  'Jaya Ballard',
  'Seeds of Innocence',
  'Witness the Future',
]) {
  probe(name);
}
