import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { isJoinForcesSpell, isTemptingOfferSpell } from './oracleIrSpellLegacySpellShapeUtils.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';
import { queueJoinForcesResolutionSteps } from './joinForcesResolutionQueue.js';
import { queueTemptingOfferResolutionSteps } from './temptingOfferResolutionQueue.js';

export function applyInstantSorceryJoinForcesAndTemptingOfferHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
  },
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }

  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;

  const cardNameLower = (effectiveCard.name || '').toLowerCase();
  debug(1, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Join Forces spell...`);
  if (isJoinForcesSpell(effectiveCard.name, oracleTextLower)) {
    queueJoinForcesResolutionSteps(ctx, {
      controller,
      cardName: effectiveCard.name || 'Join Forces Spell',
      sourceId: item.id,
      sourceName: effectiveCard.name || 'Join Forces Spell',
      sourceImage: effectiveCard.image_uris?.small,
      effectDescription: oracleText,
      cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      logPrefix: 'resolveTopOfStack',
    });
  } else {
    debug(1, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Join Forces spell (name: "${cardNameLower}", has 'join forces': ${oracleTextLower.includes('join forces')})`);
  }
  
  // Handle Tempting Offer spells (Tempt with Discovery, Tempt with Glory, etc.)
  // These require each opponent to choose whether to accept the offer
  // Uses the unified ResolutionQueueManager for proper APNAP ordering
  debug(2, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Tempting Offer spell...`);
  if (isTemptingOfferSpell(effectiveCard.name, oracleTextLower)) {
    queueTemptingOfferResolutionSteps(ctx, {
      controller,
      cardName: effectiveCard.name || 'Tempting Offer Spell',
      sourceId: item.id,
      sourceName: effectiveCard.name || 'Tempting Offer Spell',
      sourceImage: effectiveCard.image_uris?.small,
      effectDescription: oracleText,
      cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      logPrefix: 'resolveTopOfStack',
    });
  } else {
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Tempting Offer spell`);
  }
}
