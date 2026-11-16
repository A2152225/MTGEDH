// server/src/state/modules/batch101LandRecoverSurveil.ts
// Land Equilibrium post-enter sacrifice, generic Recover GY trigger, and
// surveil-this-turn tracking. Public: the functions exported below.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import {
  parseLandEquilibrium,
  parseRecoverCost,
  recoverCostLabel,
  halfLifeRoundedUp,
  type RecoverCost,
} from './batch101Parsers.js';

function oracleOf(permOrCard: any): string {
  return String(permOrCard?.card?.oracle_text || permOrCard?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(entry: any): string {
  return String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '').toLowerCase();
}

function landCount(state: any, playerId: string): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((p) => String(p?.controller || '') === String(playerId) && /\bland\b/.test(typeLineOf(p))).length;
}

export function landEquilibriumWouldApply(state: any, enteringController: string, landCountBeforeEnter?: number): { source: any } | null {
  const pid = String(enteringController || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const enteringLands = landCountBeforeEnter != null ? Number(landCountBeforeEnter) : Math.max(0, landCount(state, pid) - 1);
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (!parseLandEquilibrium(oracleOf(perm))) continue;
    const controller = String(perm.controller || '');
    if (!controller || controller === pid) continue;
    const yours = landCount(state, controller);
    if (enteringLands >= yours) return { source: perm };
  }
  return null;
}

export function maybeQueueLandEquilibriumSacrifice(
  ctx: GameContext,
  enteringController: string,
  enteredLandId: string,
  landCountBeforeEnter?: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  const state: any = (ctx as any).state;
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  const match = landEquilibriumWouldApply(state, enteringController, landCountBeforeEnter);
  if (!match) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const options = battlefield.filter((p) => String(p?.controller || '') === String(enteringController) && /\bland\b/.test(typeLineOf(p)))
    .map((p) => ({ id: String(p.id), label: `Sacrifice ${String(p.card?.name || 'land')}` }));
  if (!options.length) return false;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: enteringController as PlayerID,
    description: `${String(match.source.card?.name || 'Land Equilibrium')}: After that land enters, sacrifice a land of your choice.`,
    mandatory: true,
    sourceId: String(match.source.id || ''),
    sourceName: String(match.source.card?.name || 'Land Equilibrium'),
    landEquilibriumSacrificeChoice: true,
    enteredLandId,
    options,
  } as any);
  return true;
}

export function notePlayerSurveilledThisTurn(state: any, playerId: string): void {
  const pid = String(playerId || '').trim();
  if (!state || !pid) return;
  state.surveilledThisTurnByPlayer = state.surveilledThisTurnByPlayer || {};
  state.surveilledThisTurnByPlayer[pid] = true;
}

export function playerSurveilledThisTurn(state: any, playerId: string): boolean {
  return Boolean(state?.surveilledThisTurnByPlayer?.[String(playerId || '')]);
}

export function clearSurveilledThisTurn(state: any): void {
  if (state) delete state.surveilledThisTurnByPlayer;
}

export function noteCreatureCardToGraveyardThisTurn(state: any): void {
  if (!state) return;
  state.creatureCardsPutIntoGraveyardsThisTurn = Number(state.creatureCardsPutIntoGraveyardsThisTurn || 0) + 1;
}

export function creatureCardsPutIntoGraveyardsThisTurn(state: any): number {
  return Number(state?.creatureCardsPutIntoGraveyardsThisTurn || 0);
}

export function clearCreatureCardsToGraveyardsThisTurn(state: any): void {
  if (state) delete state.creatureCardsPutIntoGraveyardsThisTurn;
}

export function listRecoverCardsInGraveyard(state: any, ownerId: string, exceptCardId?: string): Array<{ card: any; cost: RecoverCost }> {
  const pid = String(ownerId || '');
  const gy: any[] = Array.isArray(state?.zones?.[pid]?.graveyard) ? state.zones[pid].graveyard : [];
  const out: Array<{ card: any; cost: RecoverCost }> = [];
  for (const card of gy) {
    if (exceptCardId && String(card?.id || '') === String(exceptCardId)) continue;
    const cost = parseRecoverCost(oracleOf(card));
    if (cost) out.push({ card, cost });
  }
  return out;
}

export function maybeQueueRecoverChoices(ctx: GameContext, graveyardOwnerId: string, diedCardId?: string): number {
  const gameId = String((ctx as any).gameId || '').trim();
  const state: any = (ctx as any).state;
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return 0;
  const cards = listRecoverCardsInGraveyard(state, graveyardOwnerId, diedCardId);
  let queued = 0;
  for (const entry of cards) {
    const card = entry.card;
    const cardId = String(card?.id || '');
    const name = String(card?.name || 'card');
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: graveyardOwnerId as PlayerID,
      description: `Recover — ${recoverCostLabel(entry.cost)}: return ${name} to your hand, or exile it.`,
      mandatory: true,
      sourceId: cardId,
      sourceName: name,
      recoverChoice: true,
      recoverCardId: cardId,
      recoverOwnerId: graveyardOwnerId,
      recoverCost: entry.cost,
      options: [
        { id: 'pay', label: `${recoverCostLabel(entry.cost)} and return ${name} to your hand` },
        { id: 'exile', label: `Exile ${name}` },
      ],
    } as any);
    queued += 1;
  }
  return queued;
}

export function applyRecoverDecision(state: any, ownerId: string, cardId: string, paid: boolean, currentLife?: number): { applied: boolean; destination: 'hand' | 'exile'; lifePaid?: number } {
  const pid = String(ownerId || '');
  const zones = state.zones = state.zones || {};
  zones[pid] = zones[pid] || { graveyard: [], hand: [], exile: [] };
  const gy: any[] = Array.isArray(zones[pid].graveyard) ? zones[pid].graveyard : (zones[pid].graveyard = []);
  const idx = gy.findIndex((c: any) => String(c?.id || '') === String(cardId));
  if (idx < 0) return { applied: false, destination: 'exile' };
  const card = gy.splice(idx, 1)[0];
  zones[pid].graveyardCount = gy.length;
  if (paid) {
    let lifePaid = 0;
    const cost = parseRecoverCost(oracleOf(card));
    if (cost?.kind === 'pay_half_life_rounded_up') {
      lifePaid = halfLifeRoundedUp(currentLife ?? Number(state?.life?.[pid] ?? 0));
      state.life = state.life || {};
      state.life[pid] = Math.max(0, Number(state.life[pid] || 0) - lifePaid);
    } else if (cost?.kind === 'pay_life') {
      lifePaid = cost.amount;
      state.life = state.life || {};
      state.life[pid] = Math.max(0, Number(state.life[pid] || 0) - lifePaid);
    }
    const hand: any[] = Array.isArray(zones[pid].hand) ? zones[pid].hand : (zones[pid].hand = []);
    hand.push({ ...card, zone: 'hand' });
    zones[pid].handCount = hand.length;
    return { applied: true, destination: 'hand', lifePaid };
  }
  const exile: any[] = Array.isArray(zones[pid].exile) ? zones[pid].exile : (zones[pid].exile = []);
  exile.push({ ...card, zone: 'exile' });
  return { applied: true, destination: 'exile' };
}
