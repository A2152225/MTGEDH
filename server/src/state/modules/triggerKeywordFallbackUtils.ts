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
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerKeywordFallbackParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly triggerCard: any;
  readonly battlefield: readonly any[];
}

function normalizeKeywordEffectText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/^you may\s+/i, '')
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKeywordEventStubClause(text: string): boolean {
  return /^(?:enters the battlefield|leaves the battlefield|dies|attacks|blocks|deals combat damage)$/i.test(
    String(text || '').trim(),
  );
}

function triggerTypeOwnsKeywordFallback(triggerType: unknown): boolean {
  const requested = String(triggerType || '').trim().toLowerCase();
  return (
    requested === 'dethrone'
    || requested === 'training'
    || requested === 'bushido'
    || requested === 'mentor'
    || requested === 'exalted'
    || requested === 'melee'
    || requested === 'myriad'
    || requested === 'annihilator'
    || requested === 'afflict'
    || requested === 'flanking'
    || requested === 'rampage'
    || requested === 'battle_cry'
    || requested === 'prowess'
    || requested === 'firebending'
  );
}

function isolatedEffectMatchesKeywordEffect(isolated: string, keywordEffect: string): boolean {
  const isolatedNorm = normalizeKeywordEffectText(isolated);
  const keywordNorm = normalizeKeywordEffectText(keywordEffect);
  if (!isolatedNorm || !keywordNorm) return false;
  return isolatedNorm === keywordNorm
    || isolatedNorm.includes(keywordNorm)
    || keywordNorm.includes(isolatedNorm);
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
    || triggerType === 'firebending'
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

export function applyKeywordTriggerFallbackFromOracle(
  params: TriggerKeywordFallbackParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  const sourceId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const permanent = params.battlefield.find((p: any) => p?.id === sourceId)
    || params.triggerItem?.sourcePermanentSnapshot
    || (String(params.triggerItem?.dyingCreature?.id || '') === String(sourceId || '')
      ? params.triggerItem?.dyingCreature
      : null);
  const sourceCard = Object.keys(params.triggerCard || {}).length > 0
    ? params.triggerCard
    : (permanent?.card || {});
  const effectText = String(params.description || '').trim();
  const cardOracle = String(sourceCard.oracle_text || '').trim();
  const useEffectClauseOnly = effectText.length > 0
    && !/^(?:when|whenever|at)\b/i.test(effectText)
    && !effectText.includes('\n');
  const oracleText = useEffectClauseOnly ? effectText : (cardOracle || effectText);
  const cardNameForKeyword = sourceCard.name || params.sourceName;

  const detectedKeywords = detectKeywords(oracleText, cardNameForKeyword);
  const cardOracleKeywords = cardOracle && oracleText !== cardOracle
    ? detectKeywords(cardOracle, cardNameForKeyword)
    : detectedKeywords;
  // Isolated effect clauses (exile/copy/grant) are not keyword lines. Do not
  // fall back to the source card's static keywords (e.g. Prowess) or the
  // trigger is treated as handled and the real effect never applies.
  // Exception: the isolated clause is the expanded text of a keyword on the
  // card (Soulshift → "Return target Spirit…"), so that keyword still owns it.
  const isolatedMatchingKeywordNames = useEffectClauseOnly && detectedKeywords.keywords.length === 0
    ? new Set(
        cardOracleKeywords.keywords
          .filter((keyword) => isolatedEffectMatchesKeywordEffect(effectText, keyword.effect))
          .map((keyword) => keyword.keyword),
      )
    : null;
  if (
    useEffectClauseOnly
    && detectedKeywords.keywords.length === 0
    && (!isolatedMatchingKeywordNames || isolatedMatchingKeywordNames.size === 0)
    && !isKeywordEventStubClause(effectText)
    && !triggerTypeOwnsKeywordFallback(params.triggerItem?.triggerType)
  ) {
    return false;
  }
  const mergedKeywords = detectedKeywords.keywords.length > 0
    ? detectedKeywords
    : cardOracleKeywords;
  if (mergedKeywords.keywords.length === 0 || !permanent) {
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
    battlefield: [...params.battlefield],
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
  const results = isolatedMatchingKeywordNames && isolatedMatchingKeywordNames.size > 0
    ? rawResults.filter((result) => isolatedMatchingKeywordNames.has(result.keyword))
    : requestedKeyword && rawResults.some((result) => result.keyword === requestedKeyword)
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
