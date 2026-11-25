/**
 * Outcome sweep zone abilities: abilities that only work from the hand (cycling) or the graveyard
 * (unearth, embalm, eternalize, scavenge, encore, "exile this card from your graveyard: ...") are skipped
 * on the battlefield and swept here instead, each on a fresh table with the card in the right zone,
 * through the same socket events the client sends (activateCycling, activateGraveyardAbility).
 * Other hand abilities (channel, ninjutsu, transmute, ...) are recorded as skipped.
 */
import { fullOracleText, SWEEP_P1, SWEEP_SOURCE_CARD_ID, type SweepCard } from './sweepBoard.js';
import { closeSweepTable, openSweepTable, type SweepTable } from './sweepHarness.js';
import { apply, changeVerdict, failureVerdict, phase, runAction, type SweepPhaseOutcome } from './sweepPhaseCore.js';
import { normalizeSelfName } from './sweepFamilies.js';

/** Activated abilities whose cost has {X}: the client asks for X first and sends xValue (X = 1 here). */
export function activationXValue(ability: { cost?: string; fullText?: string }): { xValue?: number } {
  const cost = String(ability.cost || String(ability.fullText || '').split(':')[0] || '');
  return /\{x\}/i.test(cost) ? { xValue: 1 } : {};
}

type ZoneAbility = { zone: 'hand' | 'graveyard'; abilityId: string; line: string; event?: 'activateCycling' | 'activateGraveyardAbility' };

const GRAVEYARD_KEYWORDS = ['unearth', 'embalm', 'eternalize', 'scavenge', 'encore'];
const HAND_UNSWEPT = /^(channel|ninjutsu|commander ninjutsu|transmute|forecast|bloodrush|reinforce)\b/;

/** Zone abilities in the card's text, one entry per kind (first cycling line, each graveyard keyword...). */
export function findZoneAbilities(card: SweepCard): ZoneAbility[] {
  const lines = normalizeSelfName(fullOracleText(card), String(card.name || '')).toLowerCase().split('\n').map((line) => line.trim());
  const found: ZoneAbility[] = [];
  const seen = new Set<string>();
  const add = (entry: ZoneAbility) => {
    if (seen.has(entry.abilityId)) return;
    seen.add(entry.abilityId);
    found.push(entry);
  };
  for (const line of lines) {
    const body = line.replace(/^[^\u2014{]{1,40}\u2014\s*/, '');
    // The client sends `<cardId>-cycling-<n>` (n = index among the card's cycling abilities); typecycling included.
    if (/^[\w ]*cycling\b/.test(body)) add({ zone: 'hand', abilityId: `${SWEEP_SOURCE_CARD_ID}-cycling-0`, line, event: 'activateCycling' });
    const unswept = HAND_UNSWEPT.exec(body);
    if (unswept) add({ zone: 'hand', abilityId: unswept[1], line });
    const keyword = GRAVEYARD_KEYWORDS.find((word) => new RegExp(`^${word}\\b`).test(body));
    if (keyword) add({ zone: 'graveyard', abilityId: keyword, line, event: 'activateGraveyardAbility' });
    else if (/(?:exile|return) (?:this card|~) from your graveyard/.test(body.split(':')[0]) && body.includes(':')) {
      const abilityId = /counter/.test(body) && /^[^:]*exile/.test(body) ? 'exile-to-add-counters'
        : /return (?:this card|~) from your graveyard/.test(body) ? 'return-from-graveyard' : 'graveyard-activated';
      add({ zone: 'graveyard', abilityId, line, event: 'activateGraveyardAbility' });
    }
  }
  return found;
}

function sourceLocation(table: SweepTable): string {
  const state = table.game.state || {};
  if ((state.battlefield || []).some((perm: any) => String(perm?.card?.id ?? '') === SWEEP_SOURCE_CARD_ID)) return 'battlefield';
  for (const zone of ['hand', 'graveyard', 'exile', 'library']) {
    if ((state.zones?.[SWEEP_P1]?.[zone] || []).some((card: any) => String(card?.id) === SWEEP_SOURCE_CARD_ID)) return zone;
  }
  return 'elsewhere';
}

/** Moves the swept card from p1's hand to p1's graveyard (graveyard abilities start there). */
function moveSourceToGraveyard(table: SweepTable): void {
  const zones = table.game.state.zones[SWEEP_P1];
  const index = zones.hand.findIndex((card: any) => String(card?.id) === SWEEP_SOURCE_CARD_ID);
  if (index < 0) return;
  const [card] = zones.hand.splice(index, 1);
  zones.graveyard.push({ ...card, zone: 'graveyard' });
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;
}

async function sweepZoneAbility(card: SweepCard, entry: ZoneAbility, gameId: string): Promise<SweepPhaseOutcome> {
  const label = `${entry.zone}:${entry.abilityId.replace(`${SWEEP_SOURCE_CARD_ID}-`, '')}`;
  if (!entry.event) return apply(phase('zone', label, entry.line), { cls: 'skipped', detail: `zone_ability_not_swept:${entry.abilityId}` });
  const table = openSweepTable(gameId, card);
  try {
    const handler = table.handlers[SWEEP_P1][entry.event];
    if (typeof handler !== 'function') return apply(phase('zone', label, entry.line), { cls: 'skipped', detail: `no_socket_handler:${entry.event}` });
    if (entry.zone === 'graveyard') moveSourceToGraveyard(table);
    const from = sourceLocation(table);
    const xValue = /\{x\}/.test(entry.line.split(/[:(]/)[0]) ? { xValue: 1 } : {};
    const run = await runAction(table, () => handler({ gameId, cardId: SWEEP_SOURCE_CARD_ID, abilityId: entry.abilityId, ...xValue }), { ignoreCardIds: [SWEEP_SOURCE_CARD_ID] });
    const outcome = phase('zone', label, entry.line, run);
    const to = sourceLocation(table);
    if (to !== from) outcome.notes.push(`source:${from}->${to}`);
    const failure = failureVerdict(run);
    if (failure) return apply(outcome, failure);
    // Unearth / embalm-style returns: the card itself entering the battlefield is the effect.
    if (entry.zone === 'graveyard' && to === 'battlefield') return apply(outcome, { cls: 'ok', detail: 'source_entered_battlefield' });
    const prompts = [...run.settle.castPrompts, ...run.settle.resolvePrompts].filter((type) => type !== 'mana_payment_choice');
    if (!run.settle.preResolve && prompts.length === 0 && run.totalDiff.strong.length === 0 && !run.totalDiff.manaGain && to === from) {
      return apply(outcome, { cls: 'noop', detail: 'nothing_happened' });
    }
    return apply(outcome, changeVerdict(run.settle.preResolve ? run.diff : run.totalDiff, run.settle.preResolve ? run.settle.resolvePrompts : prompts));
  } finally {
    closeSweepTable(gameId);
  }
}

/** Sweeps every zone ability of the card from its own zone; appends one phase per ability. */
export async function zoneAbilityPhases(card: SweepCard, gameId: string, index: number, out: SweepPhaseOutcome[]): Promise<void> {
  const abilities = findZoneAbilities(card);
  for (let i = 0; i < abilities.length; i++) {
    out.push(await sweepZoneAbility(card, abilities[i], `${gameId}_${index}_${i}`));
  }
}
