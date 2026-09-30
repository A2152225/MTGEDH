import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { runSBA } from './counters_tokens.js';
import {
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

/**
 * Build a tapped-and-attacking Myriad token copy from a source permanent snapshot.
 */
export function buildMyriadTokenCopy(
  sourcePermanent: any,
  tokenId: string,
  controller: PlayerID,
  targetPlayerId: string,
): any {
  const sourceCard = sourcePermanent?.card && typeof sourcePermanent.card === 'object'
    ? JSON.parse(JSON.stringify(sourcePermanent.card))
    : {};
  const typeLine = String(sourceCard?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const keywords = Array.isArray(sourceCard?.keywords)
    ? sourceCard.keywords.map((value: any) => String(value || ''))
    : [];
  const oracleText = String(sourceCard?.oracle_text || '');
  const hasHaste = keywords.some((value: string) => /\bhaste\b/i.test(value)) || /\bhaste\b/i.test(oracleText);

  return {
    id: tokenId,
    controller,
    owner: controller,
    tapped: true,
    counters: {},
    isToken: true,
    summoningSickness: isCreature && !hasHaste,
    attacking: targetPlayerId,
    copiedFromPermanentId: String(sourcePermanent?.id || ''),
    ...(isCreature
      ? {
          basePower: parsePT(sourceCard?.power),
          baseToughness: parsePT(sourceCard?.toughness),
        }
      : null),
    card: {
      ...sourceCard,
      id: `${tokenId}_card`,
      zone: 'battlefield',
    },
  } as any;
}

/**
 * Create the token copies for a resolved Myriad choice and schedule their end-of-combat exile.
 */
export function applyMyriadTokenCopies(
  ctx: GameContext,
  sourcePermanent: any,
  controller: PlayerID,
  targetPlayerIds: string[],
  createdPermanentIds?: string[],
  sourceName?: string,
): string[] {
  const stateAny = (ctx as any)?.state as any;
  if (!stateAny || !sourcePermanent || !Array.isArray(targetPlayerIds) || targetPlayerIds.length === 0) {
    return [];
  }

  stateAny.battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];
  stateAny.pendingExileAtEndOfCombat = Array.isArray(stateAny.pendingExileAtEndOfCombat)
    ? stateAny.pendingExileAtEndOfCombat
    : [];

  const battlefield = stateAny.battlefield as any[];
  const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
  const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
  const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  const afterEndCombat =
    inEnding ||
    currentStepUpper === 'END_COMBAT' ||
    currentStepUpper === 'MAIN2' ||
    currentStepUpper === 'END' ||
    currentStepUpper === 'CLEANUP';
  const fireAtTurnNumber = afterEndCombat ? currentTurn + 1 : currentTurn;
  const existingPermanentIds = new Set(
    battlefield
      .map((permanent: any) => String(permanent?.id || '').trim())
      .filter(Boolean),
  );
  const createdIds: string[] = [];
  const newTokens: any[] = [];

  for (let index = 0; index < targetPlayerIds.length; index++) {
    const targetPlayerId = String(targetPlayerIds[index] || '').trim();
    if (!targetPlayerId) {
      continue;
    }

    const tokenId = String(createdPermanentIds?.[index] || uid('token_myriad')).trim();
    if (!tokenId) {
      continue;
    }

    createdIds.push(tokenId);
    if (existingPermanentIds.has(tokenId)) {
      continue;
    }

    const token = buildMyriadTokenCopy(sourcePermanent, tokenId, controller, targetPlayerId);
    newTokens.push(token);
    existingPermanentIds.add(tokenId);
  }

  if (newTokens.length > 0) {
    battlefield.push(...newTokens);
    for (const entered of newTokens) stampPermanentEntryTimestamp(stateAny, entered);
  }

  for (const tokenId of createdIds) {
    const alreadyScheduled = (stateAny.pendingExileAtEndOfCombat as any[]).some(
      (entry: any) => String(entry?.permanentId || '').trim() === tokenId,
    );
    if (alreadyScheduled) {
      continue;
    }

    stateAny.pendingExileAtEndOfCombat.push({
      permanentId: tokenId,
      createdBy: String(controller),
      fireAtTurnNumber,
      sourceName: String(sourceName || sourcePermanent?.card?.name || 'Myriad'),
    });
  }

  if (newTokens.length > 0) {
    try {
      const key = String(controller);
      stateAny.tokensCreatedThisTurn = stateAny.tokensCreatedThisTurn || {};
      stateAny.tokensCreatedThisTurn[key] = (stateAny.tokensCreatedThisTurn[key] || 0) + newTokens.length;

      stateAny.tokenCreatedThisTurn = stateAny.tokenCreatedThisTurn || {};
      stateAny.createdTokenThisTurn = stateAny.createdTokenThisTurn || {};
      stateAny.tokenCreatedThisTurn[key] = (stateAny.tokenCreatedThisTurn[key] || 0) + newTokens.length;
      stateAny.createdTokenThisTurn[key] = (stateAny.createdTokenThisTurn[key] || 0) + newTokens.length;
    } catch {
      // best-effort only
    }

    for (const token of newTokens) {
      queueSelfETBTriggersForPermanent(ctx, token, controller as any);
      triggerETBEffectsForToken(ctx, token, controller);
    }
    runSBA(ctx);
  }

  return createdIds;
}
