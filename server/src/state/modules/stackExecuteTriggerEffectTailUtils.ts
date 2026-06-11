import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { tryResolveThassasOracleWin } from './game-state-effects.js';
import { applyOracleIRFallbackForTriggeredEffect } from './stackExecuteTriggerEffectIrFallbackUtils.js';
import type { TriggerEffectLegacyBodyContinuation } from './stackResolveSharedTypes.js';
import { maybeApplyPreparedStateChange } from './triggerPreparedStateUtils.js';
import { getTriggerSourcePermanent } from './triggerSourceUtils.js';
import {
  shouldSkipLegacyTriggerRegexHandlers,
} from './oracleIrTriggerLegacyRouting.js';
import {
  applyRetiredTriggerLegacyCombinedEffectsRegexBatch,
  applyRetiredTriggerLegacyPutLandFromHand,
} from './oracleIrTriggerLegacyCombinedHandlers.js';
import {
  applyRetiredTriggerLegacyLateEffectRegexBatch,
} from './oracleIrTriggerLegacyLateEffectRegexBatch.js';
import {
  applyRetiredTriggerLegacySingleEffectRegexBatch,
} from './oracleIrTriggerLegacySingleEffectRegexBatch.js';

function isCreateCreatureTokenTriggerText(text: string): boolean {
  return /create (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+).*?\s+tokens?/i.test(String(text || ''));
}

function createTokenTriggerBattlefieldSynced(text: string, state: any, battlefieldCountBefore: number): boolean {
  if (!isCreateCreatureTokenTriggerText(text)) {
    return true;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.length <= battlefieldCountBefore) {
    return false;
  }

  const typeMatch = String(text || '').match(
    /\d+\/\d+\s+(?:\w+\s+)*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+creature/i,
  );
  if (!typeMatch?.[1]) {
    return true;
  }

  const tokenType = typeMatch[1].trim().split(/\s+/).pop()?.toLowerCase() || '';
  if (!tokenType) {
    return true;
  }

  return battlefield.some((perm: any) => {
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    const name = String(perm?.card?.name || '').toLowerCase();
    return typeLine.includes(tokenType) || name.includes(tokenType);
  });
}

function battlefieldCount(state: any): number {
  return Array.isArray(state?.battlefield) ? state.battlefield.length : 0;
}

function isDrawTriggerText(text: string): boolean {
  return /draw (?:a card|(\d+) cards?)/i.test(String(text || ''));
}

function expectedDrawCount(text: string): number {
  const drawMatch = String(text || '').match(/draw (?:a card|(\d+) cards?)/i);
  if (!drawMatch) return 0;
  return drawMatch[1] ? parseInt(drawMatch[1], 10) : 1;
}

function libraryCountForPlayer(ctx: GameContext, controller: PlayerID): number {
  const fromMap = (ctx as any).libraries?.get?.(controller);
  if (Array.isArray(fromMap)) return fromMap.length;
  const player = ((ctx as any).state?.players || []).find(
    (entry: any) => String(entry?.id || '') === String(controller),
  );
  if (Array.isArray(player?.library)) return player.library.length;
  const zonesLibraryCount = (ctx as any).state?.zones?.[controller]?.libraryCount;
  if (typeof zonesLibraryCount === 'number') return zonesLibraryCount;
  return 0;
}

function drawTriggerLibrarySynced(
  text: string,
  ctx: GameContext,
  controller: PlayerID,
  libraryCountBefore: number,
): boolean {
  if (!isDrawTriggerText(text)) {
    return true;
  }

  const expectedDrawn = expectedDrawCount(text);
  if (expectedDrawn <= 0) {
    return true;
  }

  const libraryCountAfter = libraryCountForPlayer(ctx, controller);
  return libraryCountAfter <= libraryCountBefore - expectedDrawn;
}

export function tryApplyTriggerEffectLegacyTailHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  triggerCard: any,
  state: any,
  continuation: TriggerEffectLegacyBodyContinuation,
): boolean {
  const {
    desc,
    descriptionForOracleFallback,
    isKynaiosEffect,
    opponents,
    players,
    battlefield,
  } = continuation;

  if (shouldSkipLegacyTriggerRegexHandlers(descriptionForOracleFallback, sourceName)) {
    debug(
      1,
      `[executeTriggerEffect] ${sourceName}: IR primary owns trigger effect but did not apply; falling through to legacy regex handlers: ${String(descriptionForOracleFallback || '').trim()}`,
    );
  }

  const combinedEffectsHandled = applyRetiredTriggerLegacyCombinedEffectsRegexBatch({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
    isKynaiosEffect,
    opponents,
    battlefield,
  });

  applyRetiredTriggerLegacyPutLandFromHand({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  });

  if (combinedEffectsHandled) {
    tryResolveThassasOracleWin(ctx, controller, sourceName);
    return true;
  }

  const libraryCountBefore = libraryCountForPlayer(ctx, controller);
  const battlefieldCountBefore = battlefieldCount(state);
  const triggeredOracleIRApplied = isKynaiosEffect
    ? 0
    : applyOracleIRFallbackForTriggeredEffect(
      ctx,
      controller,
      sourceName,
      descriptionForOracleFallback,
      triggerItem,
    );
  const createTokenTrigger = isCreateCreatureTokenTriggerText(desc)
    || isCreateCreatureTokenTriggerText(descriptionForOracleFallback);
  const createTokenBattlefieldSynced = !createTokenTrigger
    || createTokenTriggerBattlefieldSynced(desc, state, battlefieldCountBefore)
    || createTokenTriggerBattlefieldSynced(descriptionForOracleFallback, state, battlefieldCountBefore);
  const drawLibrarySynced = drawTriggerLibrarySynced(desc, ctx, controller, libraryCountBefore)
    && drawTriggerLibrarySynced(descriptionForOracleFallback, ctx, controller, libraryCountBefore);

  if (triggeredOracleIRApplied > 0 && createTokenBattlefieldSynced && drawLibrarySynced) {
    tryResolveThassasOracleWin(ctx, controller, sourceName);
    return true;
  }

  if (applyRetiredTriggerLegacySingleEffectRegexBatch({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    triggerCard,
    state,
    opponents,
    players,
    battlefield,
    isKynaiosEffect,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyLateEffectRegexBatch({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    triggerCard,
    state,
    opponents,
    players,
    battlefield,
  })) {
    return true;
  }

  if (maybeApplyPreparedStateChange(ctx, controller, description, triggerItem, getTriggerSourcePermanent(state, triggerItem))) {
    return true;
  }

  return false;
}
