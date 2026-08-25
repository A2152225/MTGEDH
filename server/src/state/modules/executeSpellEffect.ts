import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { EngineEffect } from '../../rules-engine/targeting.js';
import { uid, triggerLifeGainEffects } from '../utils.js';
import { calculateModifiedDamage, processLifeChange, resolveOpponentDirectedDamage } from './game-state-effects.js';
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from './triggers/damage-received.js';
import { queueBecomesUntappedTriggers } from './triggers/tap-untap.js';
import { drawCards as drawCardsFromZone, movePermanentToHand } from './zones.js';
import { applyMillCardsSpellEffect } from './executeSpellEffectMillCards.js';
import { createToken, destroyPermanent, movePermanentToExile, updateCounters, runSBA } from './counters_tokens.js';
import { applyCreatureDamageFromSource, resolvePlayerDamage } from './combat-damage-processing.js';
import { addExtraCombat } from './turn.js';
import { applyGoadToCreature } from './goad-effects.js';
import { shouldExileStackCardInsteadOfGraveyard } from './stack-zone-replacements.js';
import { cleanupCardLeavingExile } from './playable-from-exile.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { queueDealsDamageToPlayerTriggersFromPermanent } from './triggerLifeDamageUtils.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { detectEntersWithCounters } from './detectEntersWithCounters.js';
import { processSpellCounteredTriggers } from './spellCounteredTriggerUtils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  normalizeFlickerReturnAt,
  resolveFlickerReturnAfterExile,
  scheduleExiledCardReturnToBattlefield as scheduleExiledCardReturnToBattlefieldImpl,
  returnExiledCardToBattlefield as returnExiledCardToBattlefieldImpl,
} from './executeSpellEffect-handlers/executeSpellEffectFlickerHelpers.js';
import { executeSpellEffect as executeSpellEffectImpl } from './executeSpellEffect-handlers/executeSpellEffectCore.js';
/**
 * Execute a single spell effect
 */
export function executeSpellEffect(
  ctx: GameContext,
  effect: EngineEffect,
  caster: PlayerID,
  spellName: string,
  sourcePermanentId?: string,
  sourceId?: string,
): void {
  executeSpellEffectImpl(ctx, effect, caster, spellName, sourcePermanentId, sourceId);
}

export function scheduleExiledCardReturnToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  returnAt: 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat',
  sourceName: string,
): boolean {
  return scheduleExiledCardReturnToBattlefieldImpl(ctx, ownerId, cardId, returnAt, sourceName);
}

export function returnExiledCardToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  sourceName = 'Flicker effect',
): any | null {
  return returnExiledCardToBattlefieldImpl(ctx, ownerId, cardId, sourceName);
}

