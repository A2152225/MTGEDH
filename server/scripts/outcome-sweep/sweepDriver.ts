/**
 * Outcome sweep driver: runs one card through cast / play, ETB, activated abilities and death on a
 * fresh table, then classifies every phase as ok, noop, throw, stuck or skipped.
 *
 *   ok      state changed (or a resolution-time prompt appeared)
 *   noop    the action completed with no observable change
 *   throw   exception, error log, or the action was rejected with a socket error
 *   stuck   a prompt or the stack could not be resolved (or the card timed out)
 *   skipped the minimal board cannot exercise it (reason recorded)
 */
import { extractActivatedAbilitiesFromText } from '../../src/socket/interaction-handlers/interactionActivateBattlefieldAbilityHelpers.js';
import { getOracleIrGapTelemetrySnapshot, resetOracleIrGapTelemetry } from '../../src/state/modules/oracleIrGapTelemetry.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { primaryFace, refillManaPool, sourcePermanent, SWEEP_P1, SWEEP_SOURCE_CARD_ID, type SweepCard } from './sweepBoard.js';
import { closeSweepTable, openSweepTable, type SweepTable } from './sweepHarness.js';
import {
  apply, calibratedNoise, changeVerdict, errorText, failureVerdict, meaningfulWeak, phase, runAction,
  type SweepCardOutcome, type SweepClass, type SweepPhaseKind, type SweepPhaseOutcome,
} from './sweepPhaseCore.js';
import {
  diesTriggerLine, errorFamily, etbTriggerLine, isConditionalText, needsStackTarget, normalizeSelfName,
  oracleFamily, unsupportedCardReason, untestedTriggerKinds, zoneOnlyAbility,
} from './sweepFamilies.js';
import { activationXValue, zoneAbilityPhases } from './sweepZoneAbilities.js';

export type { SweepCardOutcome, SweepClass, SweepPhaseKind, SweepPhaseOutcome } from './sweepPhaseCore.js';

const CLASS_RANK: Record<SweepClass, number> = { throw: 4, stuck: 3, noop: 2, ok: 1, skipped: 0 };
const MAX_ABILITIES = 6;

function findSource(table: SweepTable): any {
  const battlefield: any[] = table.game.state?.battlefield || [];
  return battlefield.find((perm) => String(perm?.card?.id ?? '') === SWEEP_SOURCE_CARD_ID);
}

function sourceStillInHand(table: SweepTable): boolean {
  return (table.game.state?.zones?.[SWEEP_P1]?.hand || []).some((card: any) => String(card?.id) === SWEEP_SOURCE_CARD_ID);
}

/**
 * The seat that activates the source's abilities: its current controller (Pendant of Prosperity and other
 * "enters under the control of an opponent" permanents belong to p2 by now), falling back to p1.
 */
export function sweepActivatingPlayer(table: Pick<SweepTable, 'handlers'>, perm: any): string {
  const controller = String(perm?.controller ?? '').trim();
  return controller && table.handlers[controller] ? controller : SWEEP_P1;
}

/** Clears leftovers between phases so a stuck cast cannot poison later phases. */
function resetBetweenPhases(table: SweepTable): void {
  try { ResolutionQueueManager.removeQueue(table.gameId); } catch { /* reset */ }
  table.game.state.stack = [];
  table.game.state.priority = SWEEP_P1;
  refillManaPool(table.game.state, SWEEP_P1);
}

function readyPermanent(table: SweepTable, perm: any): void {
  perm.tapped = false;
  perm.summoningSickness = false;
  perm.enteredThisTurn = false;
  for (const key of Object.keys(perm)) if (/^loyaltyActivat/i.test(key)) delete perm[key];
  for (const key of Object.keys(table.game.state)) if (/^loyaltyActivat/i.test(key)) delete table.game.state[key];
  refillManaPool(table.game.state, SWEEP_P1);
}

/** The client sends a face index for cards whose face is chosen at cast time (MDFC, split, adventure, omen). */
function castFaceIndex(card: SweepCard): { faceIndex?: number } {
  const faced = Array.isArray(card.card_faces) && card.card_faces.length > 1;
  return faced && ['modal_dfc', 'split', 'adventure', 'omen', 'prepare'].includes(String(card.layout || '')) ? { faceIndex: 0 } : {};
}

/** Abilities written inside quotes are granted to other objects (tokens, equipped creature), not the source's own. */
function isQuotedGrant(oracle: string, ability: { cost: string; fullText: string }): boolean {
  const unquoted = oracle.replace(/"[^"]*"/g, ' ');
  const cost = String(ability.cost || '').toLowerCase().trim();
  return Boolean(cost) && oracle.includes(cost) && !unquoted.includes(cost);
}

async function castOrPlayPhases(table: SweepTable, card: SweepCard, faceType: string, text: string, out: SweepPhaseOutcome[]): Promise<void> {
  const isLand = /\bLand\b/.test(faceType);
  const isPermanent = /\b(?:Creature|Artifact|Enchantment|Planeswalker|Land|Battle)\b/.test(faceType);
  const name = String(card.name || '');
  if (!isPermanent && needsStackTarget(text)) {
    out.push(apply(phase('cast', 'spell', text), { cls: 'skipped', detail: 'needs_stack_target' }));
    return;
  }
  const gameId = table.gameId;
  const run = isLand
    ? await runAction(table, () => table.handlers[SWEEP_P1].playLand({ gameId, cardId: SWEEP_SOURCE_CARD_ID }), { ignoreCardIds: [SWEEP_SOURCE_CARD_ID] })
    : await runAction(table, () => table.handlers[SWEEP_P1].requestCastSpell({ gameId, cardId: SWEEP_SOURCE_CARD_ID, ...castFaceIndex(card) }), { ignoreCardIds: [SWEEP_SOURCE_CARD_ID] });
  const kind: SweepPhaseKind = isLand ? 'play' : 'cast';
  const main = phase(kind, isPermanent ? 'permanent' : 'spell', isPermanent ? `enter: ${faceType}` : text, run);
  const failure = failureVerdict(run);
  const onBattlefield = Boolean(findSource(table));
  if (failure) {
    out.push(apply(main, failure));
  } else if (!run.settle.preResolve && !isLand && sourceStillInHand(table)) {
    out.push(apply(main, { cls: 'stuck', detail: `cast_not_started${run.settle.castPrompts.length ? `:${run.settle.castPrompts[run.settle.castPrompts.length - 1]}` : ''}` }));
  } else if (isPermanent) {
    // Gone again with other changes (Shivan Wumpus put back on top after a land sacrifice): the entry worked.
    const leftWithEffect = !onBattlefield && (run.diff.strong.length > 0 || run.settle.resolvePrompts.length > 0);
    out.push(apply(main, onBattlefield ? { cls: 'ok' } : leftWithEffect ? { cls: 'ok', detail: 'left_battlefield_after_entry' } : { cls: 'noop', detail: 'permanent_not_on_battlefield' }));
  } else {
    out.push(apply(main, changeVerdict(run.diff, run.settle.resolvePrompts)));
  }
  const entered = findSource(table);
  const counters = entered?.counters && Object.keys(entered.counters).length ? JSON.stringify(entered.counters) : '';
  if (counters) main.notes.push(`source_counters:${counters}`);
  const etbLine = isPermanent ? etbTriggerLine(text, name) : undefined;
  if (etbLine) {
    const etb = phase('etb', 'etb_trigger', etbLine, run);
    if (failure) apply(etb, { cls: 'skipped', detail: `entry_failed:${failure.cls}` });
    else if (!onBattlefield && run.diff.strong.length === 0 && run.settle.resolvePrompts.length === 0) apply(etb, { cls: 'skipped', detail: 'not_on_battlefield' });
    else apply(etb, changeVerdict(run.diff, run.settle.resolvePrompts));
    out.push(etb);
  }
}

async function activationPhases(table: SweepTable, text: string, out: SweepPhaseOutcome[]): Promise<void> {
  let perm = findSource(table);
  if (!perm) return;
  const oracle = String(perm.card?.oracle_text || text || '').toLowerCase();
  const abilities = extractActivatedAbilitiesFromText(oracle).slice(0, MAX_ABILITIES);
  for (let index = 0; index < abilities.length; index++) {
    const ability = abilities[index];
    const label = `ability_${index}`;
    perm = findSource(table);
    if (!perm) {
      out.push(apply(phase('activate', label, ability.fullText), { cls: 'skipped', detail: 'source_left_battlefield' }));
      continue;
    }
    if (isQuotedGrant(oracle, ability)) {
      out.push(apply(phase('activate', label, ability.fullText), { cls: 'skipped', detail: 'quoted_grant_not_own_ability' }));
      continue;
    }
    if (needsStackTarget(ability.effect)) {
      out.push(apply(phase('activate', label, ability.fullText), { cls: 'skipped', detail: 'needs_stack_target' }));
      continue;
    }
    const zone = zoneOnlyAbility(ability.fullText);
    if (zone) {
      // Swept from its own zone by zoneAbilityPhases (when cheap); never activated from the battlefield.
      out.push(apply(phase('activate', label, ability.fullText), { cls: 'skipped', detail: `zone_ability:${zone}` }));
      continue;
    }
    resetBetweenPhases(table);
    readyPermanent(table, perm);
    const permId = String(perm.id);
    const actor = sweepActivatingPlayer(table, perm);
    if (actor !== SWEEP_P1) {
      table.game.state.priority = actor;
      refillManaPool(table.game.state, actor);
    }
    const run = await runAction(
      table,
      () => table.handlers[actor].activateBattlefieldAbility({
        gameId: table.gameId, permanentId: permId, abilityId: `${SWEEP_SOURCE_CARD_ID}-ability-${index}`, ...activationXValue(ability),
      }),
      { ignoreSigOfPermId: permId },
    );
    const outcome = phase('activate', label, ability.fullText, run);
    if (actor !== SWEEP_P1) outcome.notes.push('activated_as:' + actor);
    outcome.family = oracleFamily(ability.effect);
    outcome.conditional = isConditionalText(ability.fullText);
    const failure = failureVerdict(run);
    if (failure) {
      out.push(apply(outcome, failure));
      continue;
    }
    const anyPrompt = [...run.settle.castPrompts, ...run.settle.resolvePrompts].filter((type) => type !== 'mana_payment_choice');
    if (!run.settle.preResolve && anyPrompt.length === 0 && run.totalDiff.strong.length === 0 && !run.totalDiff.manaGain) {
      const weak = meaningfulWeak(run.totalDiff.weak);
      out.push(apply(outcome, weak.length ? { cls: 'ok', detail: `no_stack_weak:${weak.slice(0, 3).join(',')}` } : { cls: 'noop', detail: 'nothing_happened' }));
      continue;
    }
    out.push(apply(outcome, changeVerdict(run.diff, run.settle.preResolve ? run.settle.resolvePrompts : anyPrompt)));
  }
}

async function deathPhase(table: SweepTable, text: string, name: string, out: SweepPhaseOutcome[]): Promise<void> {
  const line = diesTriggerLine(text, name);
  if (!line) return;
  const perm = findSource(table);
  if (!perm) {
    out.push(apply(phase('death', 'dies_trigger', line), { cls: 'skipped', detail: 'source_not_on_battlefield' }));
    return;
  }
  resetBetweenPhases(table);
  const run = await runAction(table, () => table.game.movePermanentToGraveyard(String(perm.id), true), { ignoreCardIds: [SWEEP_SOURCE_CARD_ID] });
  const outcome = phase('death', 'dies_trigger', line, run);
  out.push(apply(outcome, failureVerdict(run) || changeVerdict(run.diff, [...run.settle.castPrompts, ...run.settle.resolvePrompts])));
}

async function runCardPhases(table: SweepTable, card: SweepCard, out: SweepPhaseOutcome[], index: number): Promise<void> {
  const face = primaryFace(card);
  const faceType = String(face.type_line || card.type_line || '');
  const text = String(face.oracle_text || '');
  await castOrPlayPhases(table, card, faceType, text, out);
  const isPermanent = /\b(?:Creature|Artifact|Enchantment|Planeswalker|Land|Battle)\b/.test(faceType);
  const wantsBoard = extractActivatedAbilitiesFromText(text.toLowerCase()).length > 0 || Boolean(diesTriggerLine(text, String(card.name || '')));
  if (isPermanent && wantsBoard && !findSource(table)) {
    resetBetweenPhases(table);
    table.game.state.battlefield.push(sourcePermanent(card));
    out.push(apply(phase('cast', 'placed_directly', 'source placed on battlefield for ability phases'), { cls: 'skipped', detail: 'placed_directly' }));
  }
  if (isPermanent) {
    await activationPhases(table, text, out);
    await deathPhase(table, text, String(card.name || ''), out);
  }
  await zoneAbilityPhases(card, `${table.gameId}_zone`, index, out);
}

function summarize(card: SweepCard, phases: SweepPhaseOutcome[], started: number, telemetry: string[], untested: string[]): SweepCardOutcome {
  const face = primaryFace(card);
  let worst: SweepPhaseOutcome | undefined;
  for (const entry of phases) if (!worst || CLASS_RANK[entry.class] > CLASS_RANK[worst.class]) worst = entry;
  return {
    name: String(card.name || ''),
    set: card.set,
    typeLine: String(face.type_line || card.type_line || ''),
    class: worst ? worst.class : 'skipped',
    detail: worst ? `${worst.phase}:${worst.detail || worst.family}` : 'no_phases',
    phases,
    telemetry,
    untestedTriggers: untested,
    ms: Date.now() - started,
  };
}

function telemetryLines(): string[] {
  try {
    const snapshot = getOracleIrGapTelemetrySnapshot();
    return [...new Set(snapshot.recentEvents.map((event) => `${event.kind}:${event.scope}:${String(event.reasons?.[0] || '').slice(0, 80)}`))].slice(0, 8);
  } catch {
    return [];
  }
}

export async function sweepOneCard(card: SweepCard, options: { index: number; timeoutMs?: number }): Promise<SweepCardOutcome> {
  const started = Date.now();
  const face = primaryFace(card);
  const text = String(face.oracle_text || '');
  const untested = untestedTriggerKinds(text, String(card.name || ''));
  const unsupported = unsupportedCardReason(String(card.type_line || face.type_line || ''), card.layout);
  if (unsupported) {
    const skipped = apply(phase('cast', 'card', text), { cls: 'skipped', detail: unsupported });
    return summarize(card, [skipped], started, [], untested);
  }
  const gameId = `outcome_sweep_${options.index}`;
  const phases: SweepPhaseOutcome[] = [];
  resetOracleIrGapTelemetry();
  let timer: NodeJS.Timeout | undefined;
  try {
    const table = openSweepTable(gameId, card);
    const work = runCardPhases(table, card, phases, options.index);
    const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? 20000); });
    const finished = work.then(() => 'done' as const);
    finished.catch(() => { /* surfaced through the race below */ });
    const winner = await Promise.race([finished, timeout]);
    if (winner === 'timeout') {
      phases.push(apply(phase('cast', 'card', normalizeSelfName(text, String(card.name || ''))), { cls: 'stuck', detail: 'timeout' }));
    }
  } catch (error) {
    phases.push(apply(phase('cast', 'harness', text), { cls: 'throw', detail: errorFamily(`harness: ${errorText(error)}`) }));
  } finally {
    if (timer) clearTimeout(timer);
    closeSweepTable(gameId);
  }
  return summarize(card, phases, started, telemetryLines(), untested);
}

const CALIBRATION_CARDS: SweepCard[] = [
  { name: 'Sweep Calibration Sorcery', type_line: 'Sorcery', mana_cost: '{1}', cmc: 1, colors: [], oracle_text: 'Sweep calibration text.' },
  { name: 'Sweep Calibration Golem', type_line: 'Artifact Creature \u2014 Golem', mana_cost: '{1}', cmc: 1, colors: [], power: '1', toughness: '1',
    oracle_text: '{1}: Sweep calibration text.' },
];

/** Learns the weak keys a no-effect spell, permanent and activation still touch; returns them. */
export async function calibrateSweepNoise(): Promise<string[]> {
  for (let i = 0; i < CALIBRATION_CARDS.length; i++) {
    const outcome = await sweepOneCard(CALIBRATION_CARDS[i], { index: 990000 + i });
    for (const entry of outcome.phases) for (const key of entry.weak) calibratedNoise.add(key);
  }
  return [...calibratedNoise].sort();
}
