// server/src/state/modules/batch99TransformEvents.ts
// Generic "as this transforms" hooks (CR 701.27i): emblem grants and
// choose-an-opponent. Called from transformPermanentToFace when the
// permanent actually changes faces. Public: parsers, applyAsTransformsEvents,
// maybeQueueTransformChooseOpponent, applyTransformChooseOpponentOnContext,
// queuePendingTransformChooseOpponentChoices.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from './context.js';
import { uid } from '../utils.js';
import { asTransformsAbilityAppliesWhileChangingFaces } from '../../../../rules-engine/src/keywordActions/transform.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';

function oracleOfFace(face: any): string {
  return String(face?.oracle_text || '').replace(/\u2019/g, "'");
}

export function parseAsTransformsEmblemGrant(oracle: string): { face: string; text: string } | null {
  const text = String(oracle || '').replace(/\u2019/g, "'");
  const match = text.match(
    /as this creature transforms into (.+?),\s*you get an emblem with\s*["\u201C]([^"\u201D]+)["\u201D]/i,
  );
  if (!match) return null;
  const face = String(match[1] || '').trim();
  const effect = String(match[2] || '').trim();
  if (!face || !effect) return null;
  return { face, text: effect };
}

export function parseAsTransformsChooseOpponent(oracle: string): boolean {
  return /as this creature transforms into .+?,\s*choose an opponent/i.test(String(oracle || '').replace(/\u2019/g, "'"));
}

function listOpponents(state: any, controllerId: string): string[] {
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  return players
    .filter((player) => {
      const id = String(player?.id || '').trim();
      if (!id || id === String(controllerId)) return false;
      if (player?.hasLost || player?.eliminated || player?.conceded || player?.lost || player?.leftGame) return false;
      return true;
    })
    .map((player) => String(player.id));
}

function stampChosenOpponent(permanent: any, opponentId: string): void {
  const id = String(opponentId || '').trim();
  if (!id || !permanent) return;
  permanent.chosenPlayer = id;
  permanent.chosenOpponentId = id;
  permanent.chosenPlayerId = id;
  delete permanent.pendingTransformChooseOpponent;
}

export function applyAsTransformsEmblemGrant(
  ctx: GameContext | undefined,
  permanent: any,
  newFace: any,
): boolean {
  if (!ctx?.state || !newFace) return false;
  if (!asTransformsAbilityAppliesWhileChangingFaces()) return false;
  const parsed = parseAsTransformsEmblemGrant(oracleOfFace(newFace));
  if (!parsed) return false;
  const stateAny = ctx.state as any;
  stateAny.emblems = Array.isArray(stateAny.emblems) ? stateAny.emblems : [];
  const controller = String(permanent?.controller || '').trim();
  const sourceName = String(newFace.name || permanent?.card?.name || 'Emblem').trim() || 'Emblem';
  stateAny.emblems.push({
    id: uid('emblem'),
    controller,
    sourceName,
    effect: parsed.text,
  });
  return true;
}

export function applyAsTransformsChooseOpponent(
  ctx: GameContext | undefined,
  permanent: any,
  newFace: any,
): boolean {
  if (!permanent || !newFace) return false;
  if (!asTransformsAbilityAppliesWhileChangingFaces()) return false;
  if (!parseAsTransformsChooseOpponent(oracleOfFace(newFace))) return false;
  if (permanent.chosenPlayer || permanent.chosenOpponentId || permanent.chosenPlayerId) return true;
  const state = ctx?.state as any;
  const opponents = listOpponents(state, String(permanent.controller || ''));
  if (opponents.length === 1) {
    stampChosenOpponent(permanent, opponents[0]);
    return true;
  }
  if (ctx) maybeQueueTransformChooseOpponent(ctx, permanent);
  else permanent.pendingTransformChooseOpponent = true;
  return true;
}

export function applyAsTransformsEvents(
  ctx: GameContext | undefined,
  permanent: any,
  newFace: any,
): void {
  applyAsTransformsEmblemGrant(ctx, permanent, newFace);
  applyAsTransformsChooseOpponent(ctx, permanent, newFace);
}

export function maybeQueueTransformChooseOpponent(ctx: GameContext, permanent: any): boolean {
  if (!ctx || !permanent) return false;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    (permanent as any).pendingTransformChooseOpponent = true;
    return false;
  }
  const playerId = String(permanent.controller || permanent.controllerId || permanent.owner || '').trim();
  if (!playerId) return false;
  const already = ResolutionQueueManager.getQueue(gameId).steps.some((step: any) =>
    step?.transformChooseOpponent === true
    && String(step?.sourceId || step?.permanentId || '').trim() === String(permanent.id || '').trim(),
  );
  if (already) return false;
  const state: any = (ctx as any).state || {};
  const opponentIds = listOpponents(state, playerId);
  const players: any[] = Array.isArray(state.players) ? state.players : [];
  const validTargets = opponentIds
    .map((id) => {
      const player = players.find((entry: any) => String(entry?.id || '') === id);
      return { id, label: String(player?.name || id), description: 'Opponent', type: 'player' };
    });
  if (!validTargets.length) return false;
  if (validTargets.length === 1) {
    stampChosenOpponent(permanent, validTargets[0].id);
    return false;
  }
  const sourceName = String(permanent?.card?.name || 'Permanent');
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as PlayerID,
    description: `As ${sourceName} transforms, choose an opponent.`,
    mandatory: true,
    sourceId: String(permanent.id || ''),
    sourceName,
    sourceImage: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
    validTargets,
    targetTypes: ['player'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'an opponent',
    transformChooseOpponent: true,
    permanentId: String(permanent.id || ''),
  } as any);
  delete (permanent as any).pendingTransformChooseOpponent;
  return true;
}

export function queuePendingTransformChooseOpponentChoices(ctx: GameContext): number {
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  let queued = 0;
  for (const permanent of battlefield) {
    if (permanent?.pendingTransformChooseOpponent === true) {
      if (maybeQueueTransformChooseOpponent(ctx, permanent)) queued += 1;
    }
  }
  return queued;
}

export function applyTransformChooseOpponentOnContext(
  ctx: GameContext,
  event: { permanentId?: string; playerId?: string },
): { applied: boolean } {
  const permanentId = String(event?.permanentId || '').trim();
  const playerId = String(event?.playerId || '').trim();
  if (!permanentId || !playerId || !ctx) return { applied: false };
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  const permanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === permanentId);
  if (!permanent) return { applied: false };
  stampChosenOpponent(permanent, playerId);
  return { applied: true };
}
