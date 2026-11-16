// server/src/state/modules/batch101EnterCopyAndTokens.ts
// Essence of the Wild enter-as-copy, and Esix first-tokens-this-turn optional
// copy choice. Public: applyEssenceEnterAsCopy, listEsixFirstTokenCandidates,
// maybeQueueEsixFirstTokensChoice, ESIX_FIRST_TOKENS_EFFECT_ID, applyEsixTokenChoice.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import { parseEssenceEnterAsCopy, parseEsixFirstTokensCopy } from './batch101Parsers.js';

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function isCreature(perm: any): boolean {
  return /\bcreature\b/.test(typeLineOf(perm));
}

export function applyEssenceEnterAsCopy(state: any, entering: any): { applied: boolean; copiedFrom?: any } {
  if (!entering || !state) return { applied: false };
  const controller = String(entering.controller || '');
  const enteringId = String(entering.id || '');
  if (!controller || !isCreature(entering)) return { applied: false };
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const source = battlefield.find((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== controller) return false;
    if (String(perm.id || '') === enteringId) return false;
    return parseEssenceEnterAsCopy(oracleOf(perm));
  });
  if (!source) return { applied: false };
  const srcCard = source.card || source;
  entering.copiedFromPermanentId = String(source.id || '');
  entering.card = { ...(entering.card || {}), ...srcCard, id: entering.card?.id || entering.id, oracle_id: srcCard.oracle_id };
  entering.copyOf = String(source.card?.name || source.name || '');
  return { applied: true, copiedFrom: source };
}

export const ESIX_FIRST_TOKENS_EFFECT_ID = 'optional-esix-first-tokens-this-turn';

function isPlayersTurn(state: any, playerId: string): boolean {
  const turn = String(state?.turnPlayer || state?.activePlayer || '').trim();
  return !turn || turn === String(playerId);
}

export function listEsixFirstTokenSources(state: any, controller: string): any[] {
  const pid = String(controller || '');
  const used: Record<string, boolean> = (state?.esixFirstTokensUsedThisTurn || {}) as Record<string, boolean>;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== pid) return false;
    const id = String(perm.id || '');
    if (!id || used[id] || used[pid]) return false;
    return parseEsixFirstTokensCopy(oracleOf(perm));
  });
}

export function maybeQueueEsixFirstTokensChoice(
  ctx: GameContext,
  controller: PlayerID | string,
  pending: { name: string; count: number; basePower?: number; baseToughness?: number; options?: any },
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  const playerId = String(controller || '').trim();
  const tokensToCreate = Math.max(0, Math.floor(Number(pending?.count || 0)));
  if (!playerId || tokensToCreate <= 0) return false;
  const state: any = (ctx as any).state;
  if (!isPlayersTurn(state, playerId)) return false;
  const sources = listEsixFirstTokenSources(state, playerId);
  if (!sources.length) return false;
  const source = sources[0];
  const sourceId = String(source.id || '');
  const sourceName = String(source.card?.name || 'Esix');
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const creatureOptions = battlefield.filter((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.id || '') === sourceId) return false;
    return isCreature(perm);
  }).map((perm) => ({
    id: String(perm.id),
    label: `Copy ${String(perm.card?.name || 'creature')} (${tokensToCreate})`,
  }));
  state.esixFirstTokensUsedThisTurn = state.esixFirstTokensUsedThisTurn || {};
  state.esixFirstTokensUsedThisTurn[sourceId] = true;
  state.esixFirstTokensUsedThisTurn[playerId] = true;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    description: `${sourceName}: The first time you would create token(s) this turn, you may instead choose a creature other than ${sourceName} and create that many tokens as copies.`,
    mandatory: true,
    sourceId,
    sourceName,
    esixFirstTokensChoice: true,
    esixSourcePermanentId: sourceId,
    esixOriginalTokenCreate: {
      controller: playerId,
      name: pending.name,
      count: tokensToCreate,
      basePower: pending.basePower,
      baseToughness: pending.baseToughness,
      options: pending.options,
    },
    options: [
      ...creatureOptions,
      { id: 'normal', label: `Create the normal ${tokensToCreate} token(s) (${pending.name || 'Token'})` },
    ],
  } as any);
  return true;
}

export function chosenEsixCopyCreature(state: any, sourceId: string, selectedId: string): any | null {
  if (!selectedId || selectedId === 'normal') return null;
  if (selectedId === sourceId) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = battlefield.find((p) => String(p?.id || '') === String(selectedId));
  if (!perm || !isCreature(perm)) return null;
  return perm;
}
