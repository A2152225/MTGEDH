import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { detectKeywords } from './keyword-detection.js';
import {
  applyKeywordCounters,
  applyKeywordPTMod,
  processKeywordTriggers,
  type KeywordTriggerContext,
} from './keyword-handlers.js';
import { debug } from '../../utils/debug.js';
import { enqueueSupportedKeywordChoiceStep } from './triggerKeywordChoiceUtils.js';
import { applyTriggerLifeGain, modifyTriggerEffectLife } from './triggerLifeDamageUtils.js';

export interface TriggerLegacyKeywordParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly triggerCard: any;
  readonly battlefield: readonly any[];
}

function resolveKeywordTriggerTiming(
  triggerType: unknown,
): 'attacks' | 'blocks' | 'etb' | 'dies' | 'combat_damage' | 'cast' | 'noncreature_cast' {
  if (
    triggerType === 'attacks'
    || triggerType === 'creature_attacks'
    || triggerType === 'myriad'
    || triggerType === 'annihilator'
    || triggerType === 'dethrone'
    || triggerType === 'melee'
    || triggerType === 'exalted'
    || triggerType === 'battle_cry'
    || triggerType === 'mentor'
    || triggerType === 'training'
  ) {
    return 'attacks';
  }

  if (
    triggerType === 'blocks'
    || triggerType === 'blocked'
    || triggerType === 'afflict'
    || triggerType === 'flanking'
    || triggerType === 'bushido'
    || triggerType === 'rampage'
  ) {
    return 'blocks';
  }

  if (triggerType === 'etb' || triggerType === 'etb_self') {
    return 'etb';
  }

  if (
    triggerType === 'dies'
    || triggerType === 'death'
    || triggerType === 'creature_dies'
    || triggerType === 'any_creature_dies'
  ) {
    return 'dies';
  }

  if (triggerType === 'combat_damage' || triggerType === 'deals_combat_damage') {
    return 'combat_damage';
  }

  if (triggerType === 'cast' || triggerType === 'spell_cast') {
    return 'cast';
  }

  return 'cast';
}

export function applyRetiredTriggerLegacyKeywordTriggerFallback(
  params: TriggerLegacyKeywordParams,
): boolean {
  const sourceId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const permanent = params.battlefield.find((p: any) => p?.id === sourceId)
    || params.triggerItem?.sourcePermanentSnapshot
    || (String(params.triggerItem?.dyingCreature?.id || '') === String(sourceId || '')
      ? params.triggerItem?.dyingCreature
      : null);
  const sourceCard = Object.keys(params.triggerCard || {}).length > 0
    ? params.triggerCard
    : (permanent?.card || {});
  const oracleText = sourceCard.oracle_text || params.description;
  const cardNameForKeyword = sourceCard.name || params.sourceName;

  const detectedKeywords = detectKeywords(oracleText, cardNameForKeyword);
  if (detectedKeywords.keywords.length === 0 || !permanent) {
    return false;
  }

  debug(2, `[executeTriggerEffect] Found ${detectedKeywords.keywords.length} keywords via dynamic detection for ${params.sourceName}`);

  const triggerType = params.triggerItem?.triggerType;
  const timing = resolveKeywordTriggerTiming(triggerType);
  const blockingCreatureIds = Array.isArray(params.triggerItem?.value?.blockingCreatureIds)
    ? params.triggerItem.value.blockingCreatureIds
        .map((value: any) => String(value || '').trim())
        .filter(Boolean)
    : [];

  const keywordCtx: KeywordTriggerContext = {
    gameId: (params.ctx as any).gameId || 'unknown',
    permanent,
    controller: params.controller,
    state: params.state,
    battlefield: params.battlefield,
    players: params.state.players || [],
    activePlayer: params.state.activePlayer || params.controller,
    defendingPlayer:
      params.triggerItem?.defendingPlayer ||
      params.triggerItem?.value?.defendingPlayer,
    attackingCreatures: params.triggerItem?.attackingCreatures,
    blockingCreatureIds,
    blockingCreatures: blockingCreatureIds.length > 0
      ? params.battlefield.filter((entry: any) => entry && blockingCreatureIds.includes(String(entry.id || '')))
      : undefined,
    spellCast: params.triggerItem?.spellCast,
    dyingCreature: params.triggerItem?.dyingCreature,
  };

  const rawResults = processKeywordTriggers(keywordCtx, timing);
  const requestedKeyword = typeof triggerType === 'string' ? String(triggerType).trim().toLowerCase() : '';
  const results = requestedKeyword && rawResults.some((result) => result.keyword === requestedKeyword)
    ? rawResults.filter((result) => result.keyword === requestedKeyword)
    : rawResults;

  for (const result of results) {
    debug(2, `[executeTriggerEffect] Keyword ${result.keyword} processed: ${result.chatMessage || result.effect}`);

    if (result.countersAdded) {
      applyKeywordCounters(permanent, result);
    }

    if (result.lifeChange) {
      const targetPlayerId = String(result.lifeChange.player || '').trim();
      const amount = Number(result.lifeChange.amount || 0);
      if (targetPlayerId && Number.isFinite(amount) && amount !== 0) {
        if (amount > 0) {
          applyTriggerLifeGain(params.state, targetPlayerId, amount, `${params.sourceName} (${result.keyword})`);
        } else {
          modifyTriggerEffectLife(params.state, targetPlayerId, amount);
        }
      }
    }

    if (result.ptModification) {
      const affectedPermanentIds = Array.isArray(result.affectedPermanentIds)
        ? result.affectedPermanentIds.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [];

      if (affectedPermanentIds.length > 0) {
        for (const affectedPermanentId of affectedPermanentIds) {
          const affectedPermanent = params.battlefield.find((entry: any) => entry && String(entry.id || '') === affectedPermanentId);
          if (!affectedPermanent) continue;
          applyKeywordPTMod(affectedPermanent, result);
        }
      } else {
        applyKeywordPTMod(permanent, result);
      }
    }

    if (result.requiresPlayerChoice) {
      if (!enqueueSupportedKeywordChoiceStep(params.ctx, permanent, params.sourceName, sourceId, result)) {
        const keywordChoice = result.requiresPlayerChoice;
        params.state.pendingKeywordChoice = params.state.pendingKeywordChoice || [];
        params.state.pendingKeywordChoice.push({
          keyword: result.keyword,
          playerId: keywordChoice.playerId,
          permanentId: keywordChoice.permanentId,
          type: keywordChoice.type,
          options: keywordChoice.options,
          sourceName: params.sourceName,
          sourceId,
        });
      }
    }
  }

  return results.length > 0;
}
