/**
 * Re-runs probe cases from aborted inline tsx -e terminals as a proper script file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { isExternallyHandledOracleFragmentText } from '../../rules-engine/src/oracleIRParserPostprocess.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.ts';
import { resolvePlayers } from '../../rules-engine/src/oracleIRExecutorPlayerUtils.ts';
import { applyDiscardStep } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  classifyExecutionResult,
  collectStepsFromIrText,
  countOracleSteps,
  dryRunOracleSteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function probeText(label: string, text: string, cardName = 'Test', typeLine = 'Sorcery'): void {
  const irGaps = hasUnknownIRSteps(text, cardName);
  const steps = collectStepsFromIrText(text, cardName);
  const rec = dryRunOracleSteps(steps, { name: cardName, type_line: typeLine }, irGaps, { typeLine });
  console.log(`[${label}] status=${rec.status} irGaps=${irGaps.length} steps=${steps.map((s) => s.kind).join(',')}`);
  if (rec.status !== 'fully_applied' && rec.status !== 'choice_required') {
    console.log('  reasonCodes', rec.reasonCodes);
    for (const s of steps.slice(0, 6)) {
      console.log('  step', s.kind, String((s as any).raw || '').slice(0, 80));
    }
  }
}

function probeCard(name: string): void {
  const card = cards.find((c) => c.name === name);
  if (!card) {
    console.log(`[${name}] NOT FOUND`);
    return;
  }
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const irGaps = hasUnknownIRSteps(text, card.name);
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied' || rec.status === 'choice_required') continue;
    console.log(`[${name}] ${rec.status} | ${text.slice(0, 100)}`);
    console.log('  steps', steps.map((s) => s.kind).join(','), 'gaps', rec.reasonCodes);
  }
}

await loadEffectIrParser();

section('Compound keyword IR');
for (const t of [
  'Trample, ward {2}',
  'Vigilance, trample (Attacking doesn\'t cause this creature to tap.)',
  'Trample, ward {2}, prowess, prowess (Each instance of prowess triggers separately.)',
  'Vigilance, reach, ward {2}',
  'Flying',
]) {
  const ir = parseOracleTextToIR(t, 'Test');
  console.log('INPUT:', t);
  console.log('  steps:', (ir.abilities[0]?.steps || []).map((s) => `${s.kind}:${String(s.raw || '').slice(0, 40)}`));
}

section('Foretell/enchant external handling');
for (const s of [
  'Foretell {2} (During your turn, you may cast this spell from exile for its foretell cost.)',
  'Enchant Mountain',
  'This spell costs {1} less to cast for each creature on the battlefield.',
]) {
  console.log(s.slice(0, 60), '→ external:', isExternallyHandledOracleFragmentText(s), '→ collected:', collectStepsFromIrText(s, 'Test').map((x) => x.kind));
}

section('Shock land + then-if partials');
for (const t of [
  'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control seven or more lands, create a 1/1 green Plant creature token.',
  'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. Then if there are three or more creature cards in your graveyard, draw a card.',
  'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. If you control four or more lands, you may search again.',
]) {
  probeText('shock-then-if', t);
}

section('Fabled Passage');
probeCard('Fabled Passage');

section('Partial cluster cards');
for (const name of ['Path to the Festival', 'Tend the Sprigs', 'Seedship Impact', 'Orbital Plunge', 'Rust-Shield Rampager']) {
  probeCard(name);
}

section('Gix discard player resolution');
{
  const text = 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.';
  const steps = collectStepsFromIrText(text, "Gix's Caress");
  const discard = steps.find((s) => s.kind === 'discard');
  const state = buildAuditFixtureState("Gix's Caress", 'Sorcery');
  const ctx = buildAuditExecutionContext("Gix's Caress");
  console.log('discard who', (discard as any)?.who);
  console.log('resolvePlayers', discard ? resolvePlayers(state, (discard as any).who, ctx) : null);
  console.log('targetPlayerId', ctx.selectorContext?.targetPlayerId);
  if (discard) {
    const r = applyDiscardStep(state, discard as any, ctx);
    console.log('applyDiscard', r.applied ? 'applied' : 'skipped', r.message?.slice(0, 80));
  }
  probeText("Gix's Caress", text);
}

section('War Elephant / Greasefang / attach');
for (const name of ['War Elephant', 'Greasefang, Okiba Boss', 'Sword of Light and Shadow']) {
  probeCard(name);
}

section('Captain America ellipsis');
{
  const card = cards.find((c) => c.name === 'Captain America, First Avenger');
  if (card) {
    const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
    for (const a of parsed.abilities || []) {
      const t = String(a.effectText || a.text || '');
      if (t.includes('...') || t === '...') {
        console.log('ellipsis ability:', JSON.stringify(t), 'external:', isExternallyHandledOracleFragmentText(t));
      }
    }
  }
}

section('Top gap patterns from audit');
for (const t of [
  "Put target creature card from a graveyard onto the battlefield under your control.",
  "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.",
  'this permanent deals X damage divided as you choose among any number of target creatures.',
  'Target creature you control deals damage equal to its power to target creature or planeswalker.',
]) {
  probeText('top-gap', t);
}

console.log('\nDone.');
