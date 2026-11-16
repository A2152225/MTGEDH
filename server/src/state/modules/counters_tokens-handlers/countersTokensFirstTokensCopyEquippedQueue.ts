// server/src/state/modules/counters_tokens-handlers/countersTokensFirstTokensCopyEquippedQueue.ts
// Choice-bearing token replacement: "As long as this Equipment is attached to
// a creature, the first time you would create one or more tokens each turn,
// you may instead create that many tokens that are copies of equipped
// creature." Detected by oracle pattern, not card name. Public:
// listFirstTokensCopyEquippedCandidates, maybeQueueFirstTokensCopyEquippedChoice,
// FIRST_TOKENS_COPY_EQUIPPED_EFFECT_ID.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { normalizeOraclePatternText, readCardOracleText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import type { ReplacementOrderCandidate } from '../replacementOrderChoice.js';

export const FIRST_TOKENS_COPY_EQUIPPED_EFFECT_ID = 'optional-copy-equipped-first-tokens-this-turn';

const COPY_EQUIPPED_RE =
  /as long as this equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature/i;

function oracleOf(perm: any): string {
  return normalizeOraclePatternText(readCardOracleText(perm?.card || perm) || '').replace(/\u2019/g, "'");
}

export function listFirstTokensCopyEquippedCandidates(state: unknown, controller: string): ReplacementOrderCandidate[] {
  const pid = String(controller || '').trim();
  if (!pid || !state) return [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const used: Record<string, boolean> = ((state as any).mirrormindCrownUsedThisTurn || {}) as Record<string, boolean>;
  const out: ReplacementOrderCandidate[] = [];

  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '').trim() !== pid) continue;
    if (!COPY_EQUIPPED_RE.test(oracleOf(perm))) continue;
    const eqId = String(perm.id || '').trim();
    if (!eqId || used[eqId]) continue;
    const attachedTo = String(perm.attachedTo || '').trim();
    if (!attachedTo) continue;
    const creature = battlefield.find((bp: any) => String(bp?.id || '') === attachedTo);
    const typeLine = String(creature?.card?.type_line || creature?.type_line || '').toLowerCase();
    if (!creature || !typeLine.includes('creature')) continue;
    const sourceName = String(perm.card?.name || 'Equipment').trim() || 'Equipment';
    out.push({
      id: `${FIRST_TOKENS_COPY_EQUIPPED_EFFECT_ID}:${eqId}`,
      effectId: FIRST_TOKENS_COPY_EQUIPPED_EFFECT_ID,
      sourceName,
      sourcePermanentId: eqId,
      sourceController: pid,
      label: sourceName,
      description: `${sourceName}: You may create those tokens as copies of the equipped creature`,
      metadata: {
        equipmentId: eqId,
        equippedCreatureId: String(creature.id || ''),
      },
    });
  }
  return out;
}

export function maybeQueueFirstTokensCopyEquippedChoice(
  ctx: GameContext,
  controller: PlayerID | string,
  pending: {
    name: string;
    count: number;
    basePower?: number;
    baseToughness?: number;
    options?: any;
    sourcePermanentId?: string;
  },
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  const playerId = String(controller || '').trim();
  const tokensToCreate = Math.max(0, Math.floor(Number(pending?.count || 0)));
  if (!playerId || tokensToCreate <= 0) return false;

  const candidates = listFirstTokensCopyEquippedCandidates((ctx as any).state, playerId);
  const forced = String((ctx as any)._replacementOrderForcedId || '').trim();
  const match = forced
    ? candidates.find((c) => c.id === forced || c.sourcePermanentId === pending.sourcePermanentId)
    : candidates[0];
  const preferred = pending.sourcePermanentId
    ? candidates.find((c) => c.sourcePermanentId === String(pending.sourcePermanentId)) || match
    : match;
  if (!preferred) return false;

  const state: any = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const eqId = preferred.sourcePermanentId;
  const crown = battlefield.find((p: any) => String(p?.id || '') === eqId);
  const attachedTo = String(crown?.attachedTo || preferred.metadata?.equippedCreatureId || '').trim();
  const equippedCreature = battlefield.find((bp: any) => String(bp?.id || '') === attachedTo);
  if (!equippedCreature?.card) return false;

  state.mirrormindCrownUsedThisTurn = state.mirrormindCrownUsedThisTurn || {};
  // Mark used immediately: declining still counts as the first time this turn.
  state.mirrormindCrownUsedThisTurn[eqId] = true;

  const equippedCardSnapshot = JSON.parse(JSON.stringify(equippedCreature.card));
  const tokenName = String(pending.name || 'Token');
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    description: `${preferred.sourceName}: The first time you would create token(s) this turn, you may instead create that many copies of the equipped creature.`,
    mandatory: true,
    sourceId: eqId,
    sourceName: preferred.sourceName,
    mirrormindCrownTokenReplacementChoice: true,
    mirrormindCrownEquipmentId: eqId,
    mirrormindCrownEquippedCreatureId: String(equippedCreature.id),
    mirrormindCrownEquippedCreatureCard: equippedCardSnapshot,
    mirrormindCrownOriginalTokenCreate: {
      controller: playerId,
      name: tokenName,
      count: tokensToCreate,
      basePower: pending.basePower,
      baseToughness: pending.baseToughness,
      options: pending.options,
    },
    options: [
      { id: 'replace', label: `Replace with ${tokensToCreate} token(s) copying ${String(equippedCreature.card?.name || 'equipped creature')}` },
      { id: 'normal', label: `Create the normal ${tokensToCreate} token(s) (${tokenName})` },
    ],
  } as any);
  return true;
}
