import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../../utils/debug.js';
import {
  getVisitedAttractions,
  isValidVisitRoll,
  VISIT_DIE_SIDES,
} from '../../../../../rules-engine/src/keywordActions/rollVisitAttractions.js';

function isAttractionPermanent(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return typeLine.includes('attraction');
}

function readLitUpNumbers(card: any): number[] {
  const fromCard = Array.isArray(card?.litUpNumbers) ? card.litUpNumbers : [];
  const normalized = fromCard
    .map((value: unknown) => Number(value))
    .filter((value: number) => Number.isInteger(value) && value >= 1 && value <= VISIT_DIE_SIDES);
  if (normalized.length > 0) {
    return normalized;
  }

  const fromVisitAbility = String(card?.visitAbility || '').trim();
  const fromOracle = String(card?.oracle_text || '').trim();
  const source = fromVisitAbility || fromOracle;
  const litMatch = source.match(/lit up on this Attraction[^0-9]*((?:\d+\s*)+)/i);
  if (!litMatch) {
    return [];
  }

  return litMatch[1]
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= VISIT_DIE_SIDES);
}

export function extractVisitAbilityEffect(oracleText: string): string {
  const text = String(oracleText || '').trim();
  if (!text) return '';

  const visitMatch = text.match(/Visit\s*[\u2014-]\s*([\s\S]+)/i);
  if (!visitMatch) return '';

  let effect = String(visitMatch[1] || '').trim();
  effect = effect.replace(/\nPrize\s*[\u2014-][\s\S]*$/i, '').trim();
  return effect;
}

function rollVisitDie(ctx: GameContext): number {
  const rng = (ctx as any).rng;
  if (typeof rng === 'function') {
    return Math.min(VISIT_DIE_SIDES, Math.max(1, Math.floor(rng() * VISIT_DIE_SIDES) + 1));
  }
  return Math.floor(Math.random() * VISIT_DIE_SIDES) + 1;
}

/**
 * Rule 505.5 / 703.4g: Roll to visit Attractions at precombat main after saga lore counters.
 * Visit abilities trigger and are queued on the stack.
 */
export function processAttractionVisitRollAtPrecombatMain(
  ctx: GameContext,
  playerId: PlayerID,
): { roll: number; visitedCount: number } | null {
  const state = (ctx as any).state;
  if (!state) return null;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const controlledAttractions = battlefield.filter(
    (permanent: any) => permanent?.controller === playerId && isAttractionPermanent(permanent),
  );
  if (controlledAttractions.length === 0) {
    return null;
  }

  const roll = rollVisitDie(ctx);
  if (!isValidVisitRoll(roll)) {
    return null;
  }

  const visitCandidates = controlledAttractions.map((permanent: any) => ({
    id: String(permanent.id || ''),
    litNumbers: readLitUpNumbers(permanent.card),
    permanent,
  }));
  const visitedIds = getVisitedAttractions(
    visitCandidates.map(({ id, litNumbers }) => ({ id, litNumbers })),
    roll,
  );
  const visitedPermanents = visitCandidates
    .filter((entry) => visitedIds.includes(entry.id))
    .map((entry) => entry.permanent);

  const timestamp = Date.now();
  state.lastDieRoll = { playerId, sides: VISIT_DIE_SIDES, result: roll, timestamp };
  state.lastDieRollByPlayer = state.lastDieRollByPlayer || {};
  state.lastDieRollByPlayer[playerId] = { sides: VISIT_DIE_SIDES, result: roll, timestamp };
  state.dieRollsThisTurn = state.dieRollsThisTurn || {};
  state.dieRollsThisTurn[playerId] = Array.isArray(state.dieRollsThisTurn[playerId])
    ? state.dieRollsThisTurn[playerId]
    : [];
  state.dieRollsThisTurn[playerId].push({ sides: VISIT_DIE_SIDES, result: roll, timestamp });

  state.stack = Array.isArray(state.stack) ? state.stack : [];
  for (const permanent of visitedPermanents) {
    const card = permanent?.card || {};
    const cardName = String(card?.name || 'Attraction');
    const visitEffect =
      String(card?.visitAbility || '').trim() ||
      extractVisitAbilityEffect(String(card?.oracle_text || ''));
    if (!visitEffect) {
      continue;
    }

    state.stack.push({
      id: `attraction_visit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'triggered_ability',
      controller: playerId,
      source: permanent.id,
      sourceName: cardName,
      description: visitEffect,
      effect: visitEffect,
      triggerType: 'attraction_visit',
      mandatory: true,
      attractionVisitRoll: roll,
      triggeringPlayer: playerId,
    });
  }

  debug(
    2,
    `[attraction] ${playerId} rolled ${roll} to visit Attractions; ${visitedPermanents.length} visited`,
  );

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return { roll, visitedCount: visitedPermanents.length };
}

export function maybeProcessPendingAttractionVisitRoll(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!state?._pendingAttractionVisitRollPlayer) {
    return;
  }

  const stack = Array.isArray(state.stack) ? state.stack : [];
  const pendingSagaChapters = stack.some(
    (item: any) => String(item?.triggerType || '').trim() === 'saga_chapter',
  );
  if (pendingSagaChapters) {
    return;
  }

  const pendingLegacySagaLore = stack.some(
    (item: any) => String(item?.triggerType || '').trim() === 'saga_lore_counter',
  );
  if (pendingLegacySagaLore) {
    return;
  }

  const playerId = String(state._pendingAttractionVisitRollPlayer || '').trim() as PlayerID;
  delete state._pendingAttractionVisitRollPlayer;
  if (!playerId) {
    return;
  }

  processAttractionVisitRollAtPrecombatMain(ctx, playerId);
}
