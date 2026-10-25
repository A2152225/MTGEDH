/**
 * triggers/turn-phases.ts
 * 
 * Turn phase-related trigger detection and processing.
 * Includes upkeep, draw step, end step, and untap step triggers.
 * 
 * Phase ordering in MTG:
 * 1. Beginning Phase: Untap Step, Upkeep Step, Draw Step
 * 2. Pre-combat Main Phase
 * 3. Combat Phase: Beginning of Combat, Declare Attackers, Declare Blockers, Combat Damage, End of Combat
 * 4. Post-combat Main Phase
 * 5. Ending Phase: End Step, Cleanup Step
 * 
 * This module uses dynamic regex-based detection instead of card-specific tables
 * to ensure it works with any card automatically.
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { isInterveningIfSatisfied } from "./intervening-if.js";
import { shouldSkipUntapStepForPlayer } from "../skipUntapStepUtils.js";
import { isNoOpOptionalCombatDamagePayLife } from "../../../../../rules-engine/src/oracleIRExecutorCombatDamageCounts.js";
import {
  inferDrawStepWhoseTurn,
  inferEndStepWhoseTurn,
  inferMainPhaseWhoseTurn,
  shouldQueuePhaseTriggerForActivePlayer,
} from "./phaseWhoseTurn.js";
import type { EndStepTrigger } from "./turn-phases-handlers/turnPhaseTriggerTypes.js";
import { getActivePermanentCardFace } from "./turn-phases-handlers/turnPhaseActivePermanentFace.js";
import { detectRequiresChoice, detectAffectsAllPlayers } from "./turn-phases-handlers/turnPhaseEffectChoiceHelpers.js";
import { detectEndStepTriggers } from "./turn-phases-handlers/turnPhaseEndStepTriggers.js";
import { collectDelayedEndStepRegistryTriggers } from "./delayed-end-step-watchers.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from "./triggerConditionFamilyMatch.js";
import { dropTriggersFromAbilitylessSources, permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
import { findStaticSkipDrawStepSource } from '../../../../../rules-engine/src/phaseTransitionTriggers.js';
import { applyOptionalDrawStepSkipLifeGain } from '../optionalDrawStepSkip.js';

// ============================================================================
// Type Definitions for Turn Phase Triggers
// ============================================================================

// NOTE: The canonical type definitions are in types.ts
// These local definitions are used for the implementation and will be
// exported from this module. They align with the types.ts definitions.

export type { EndStepTrigger } from "./turn-phases-handlers/turnPhaseTriggerTypes.js";
export type { UntapStepEffect } from "./turn-phases-handlers/turnPhaseUntapStepEffects.js";
export {
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
} from "./turn-phases-handlers/turnPhaseUntapStepEffects.js";


export interface DrawStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

function shouldSkipNoOpOptionalCombatDamagePayLife(
  ctx: GameContext,
  controllerId: string,
  effectText: string,
): boolean {
  return isNoOpOptionalCombatDamagePayLife((ctx as any).state, controllerId, effectText);
}

export interface DoesntUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  affectedType: 'all_creatures' | 'all_lands' | 'all_permanents' | 'controller_creatures' | 'controller_lands' | 'specific_permanent';
  affectedController: 'all' | 'controller' | 'opponents';
  targetPermanentId?: string;
  /** Magnetic Mountain: "Blue creatures don't untap ..." only stops creatures of this color. */
  colorFilter?: string;
  /** Choke: "Islands don't untap ..." only stops lands with this subtype. */
  landSubtypeFilter?: string;
  description: string;
}


export { detectEndStepTriggers };


/**
 * Detect beginning-of-first-main-phase triggers (parser may omit leading "At").
 */
export function detectPrecombatMainTriggers(card: any, permanent: any, gameState?: any): EndStepTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'step' })) return []; // Humility / Torpor Orb gate
  const triggers: EndStepTrigger[] = [];
  const { cardName, oracleText } = getActivePermanentCardFace(card, permanent);
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const nextMainThisTurnMatch = oracleText.match(
    /at the beginning of the next main phase this turn,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (nextMainThisTurnMatch) {
    const effect = timingTriggerEffect(oracleText, nextMainThisTurnMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: detectAffectsAllPlayers(effect),
      });
    }
  }

  const nextMainMatch = oracleText.match(
    /at the beginning of your next(?: first)? main phase,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (nextMainMatch) {
    const effect = timingTriggerEffect(oracleText, nextMainMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: detectAffectsAllPlayers(effect),
      });
    }
  }

  const hordeFirstMainMatch = oracleText.match(
    /at the beginning of the horde's first main phase,?\s*([^.]+)/i,
  );
  if (hordeFirstMainMatch) {
    const effect = timingTriggerEffect(oracleText, hordeFirstMainMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: false,
      });
    }
  }

  const eachYourMainPhasesMatch = oracleText.match(
    /at the beginning of each of your main phases,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (eachYourMainPhasesMatch) {
    const effect = timingTriggerEffect(oracleText, eachYourMainPhasesMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: false,
      });
    }
  }

  const eachPlayerFirstMainMatch = oracleText.match(
    /at the beginning of each player's first main phase,?\s*([^.]+)/i,
  );
  if (eachPlayerFirstMainMatch) {
    const effect = timingTriggerEffect(oracleText, eachPlayerFirstMainMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: true,
      });
    }
  }

  const firstMainMatch = oracleText.match(
    /(?:at the beginning of|the beginning of) (?:your )?first main phase,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (firstMainMatch) {
    const effect = timingTriggerEffect(oracleText, firstMainMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: detectAffectsAllPlayers(effect),
      });
    }
  }

  const precombatMainMatch = oracleText.match(
    /at the beginning of (?:each player's |your )?(?:pre-?combat )?main (?:phase|step),?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (precombatMainMatch && !firstMainMatch && !eachPlayerFirstMainMatch && !eachYourMainPhasesMatch) {
    const effect = timingTriggerEffect(oracleText, precombatMainMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: detectAffectsAllPlayers(effect),
      });
    }
  }

  return triggers;
}

function appendParsedPhaseEvents(
  ctx: GameContext,
  triggers: EndStepTrigger[],
  activePlayerId: string,
  events: Array<'beginning_of_precombat_main' | 'beginning_of_postcombat_main' | 'each_of_your_main_phases'>,
): void {
  const battlefield = ctx.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const event of events) {
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(permanent.card.oracle_text || ''),
        event,
        subjectPermanent: permanent,
        subjectControllerId: String(permanent.controller || ''),
        sourcePermanent: permanent,
        activePlayerId,
      })) {
        const normalized = line.effect.toLowerCase();
        // Tymna-style "you may pay X life ... dealt combat damage this turn" with X = 0 does nothing.
        if (shouldSkipNoOpOptionalCombatDamagePayLife(ctx, String(permanent.controller || ''), line.effect)) continue;
        if (triggers.some((existing) => (
          sameTriggerSource(existing, permanent)
          && parsedEffectDuplicates([existing.effect, existing.description], line)
        ))) continue;
        triggers.push({
          permanentId: String(permanent.id || ''),
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          triggerType: 'end_step_effect',
          description: line.effect,
          effect: line.effect,
          mandatory: !/\byou may\b/i.test(line.effect),
          stackItem: {
            ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
            ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
          },
        });
      }
    }
  }
}

/**
 * Get all precombat main phase triggers for the active player's first main phase.
 */
export function getPrecombatMainTriggers(
  ctx: GameContext,
  activePlayerId: string,
): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permTriggers = detectPrecombatMainTriggers(permanent.card, permanent, (ctx as any)?.state);
    const { oracleText } = getActivePermanentCardFace(permanent.card, permanent);
    const lowerOracle = oracleText.toLowerCase();

    for (const trigger of permTriggers) {
      const interveningText = String(trigger.effect || trigger.description || '').trim();
      let synthetic = interveningText;
      if (!/^(?:when|whenever|at)\b/i.test(synthetic)) {
        if (lowerOracle.includes("each player's first main phase")) {
          synthetic = `At the beginning of each player's first main phase, ${synthetic}`;
        } else if (lowerOracle.includes('each of your main phases')) {
          synthetic = `At the beginning of each of your main phases, ${synthetic}`;
        } else if (lowerOracle.includes('first main phase')) {
          synthetic = `At the beginning of your first main phase, ${synthetic}`;
        } else {
          synthetic = `At the beginning of your precombat main phase, ${synthetic}`;
        }
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        synthetic,
        permanent,
      );
      if (ok === false) continue;

      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferMainPhaseWhoseTurn(oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: (ctx as any).state,
      })) {
        continue;
      }
      if (
        shouldSkipNoOpOptionalCombatDamagePayLife(
          ctx,
          String(trigger.controllerId || permanent.controller || ''),
          String(trigger.effect || trigger.description || oracleText || ''),
        )
      ) {
        continue;
      }
      triggers.push(trigger);
    }
  }

  appendParsedPhaseEvents(ctx, triggers, activePlayerId, ['beginning_of_precombat_main', 'each_of_your_main_phases']);
  return triggers;
}

/**
 * Detect beginning-of-postcombat-main / second-main-phase triggers.
 */
export function detectPostcombatMainTriggers(card: any, permanent: any, gameState?: any): EndStepTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'step' })) return []; // Humility / Torpor Orb gate
  const triggers: EndStepTrigger[] = [];
  const { cardName, oracleText } = getActivePermanentCardFace(card, permanent);
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const enchantedPlayerPostcombatMatch = oracleText.match(
    /at the beginning of each of enchanted player's postcombat main phases?,?\s*([^.]+)/i,
  );
  if (enchantedPlayerPostcombatMatch) {
    const effect = timingTriggerEffect(oracleText, enchantedPlayerPostcombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: detectAffectsAllPlayers(effect),
    });
  }

  const eachPostcombatMainMatch = oracleText.match(
    /at the beginning of each postcombat main phase,?\s*([^.]+)/i,
  );
  if (eachPostcombatMainMatch) {
    const effect = timingTriggerEffect(oracleText, eachPostcombatMainMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: detectAffectsAllPlayers(effect),
    });
  }

  const postcombatMatch = oracleText.match(
    /at the beginning of (?:(?:each of )?your )?(?:post-?combat|second) main phases?,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (postcombatMatch && !enchantedPlayerPostcombatMatch && !eachPostcombatMainMatch) {
    const effect = timingTriggerEffect(oracleText, postcombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: detectAffectsAllPlayers(effect),
    });
  }

  return triggers;
}

/**
 * Get all postcombat main phase triggers for the active player's second main phase.
 */
export function getPostcombatMainTriggers(
  ctx: GameContext,
  activePlayerId: string,
): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permTriggers = [
      ...detectPostcombatMainTriggers(permanent.card, permanent),
      ...detectPrecombatMainTriggers(permanent.card, permanent).filter((trigger) => {
        const { oracleText } = getActivePermanentCardFace(permanent.card, permanent);
        return oracleText.toLowerCase().includes('each of your main phases');
      }),
    ];
    const { oracleText } = getActivePermanentCardFace(permanent.card, permanent);
    const lowerOracle = oracleText.toLowerCase();

    for (const trigger of permTriggers) {
      const interveningText = String(trigger.effect || trigger.description || '').trim();
      let synthetic = interveningText;
      if (!/^(?:when|whenever|at)\b/i.test(synthetic)) {
        if (lowerOracle.includes('postcombat main phase')) {
          synthetic = `At the beginning of your postcombat main phase, ${synthetic}`;
        } else if (lowerOracle.includes('second main phase')) {
          synthetic = `At the beginning of your second main phase, ${synthetic}`;
        } else if (lowerOracle.includes('each of your main phases')) {
          synthetic = `At the beginning of each of your main phases, ${synthetic}`;
        } else {
          synthetic = `At the beginning of your postcombat main phase, ${synthetic}`;
        }
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        synthetic,
        permanent,
      );
      if (ok === false) continue;

      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferMainPhaseWhoseTurn(oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: (ctx as any).state,
      })) {
        continue;
      }
      if (
        shouldSkipNoOpOptionalCombatDamagePayLife(
          ctx,
          String(trigger.controllerId || permanent.controller || ''),
          String(trigger.effect || trigger.description || oracleText || ''),
        )
      ) {
        continue;
      }
      triggers.push(trigger);
    }
  }

  appendParsedPhaseEvents(ctx, triggers, activePlayerId, ['beginning_of_postcombat_main', 'each_of_your_main_phases']);
  return triggers;
}


/**
 * Get all end step triggers for the active player's end step
 */
export function getEndStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndStepTriggers(permanent.card, permanent, (ctx as any)?.state);
    const { oracleText } = getActivePermanentCardFace(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      // Intervening-if (Rule 603.4): if the condition is false at the time the trigger
      // would trigger, the ability does not trigger and should not be put on the stack.
      // If the condition is unrecognized, keep the trigger (conservative fallback).
      const interveningText = String(trigger.effect || trigger.description || '').trim();
      const lowerOracle = oracleText.toLowerCase();

      // Many trigger detectors store only the post-comma fragment (effect text). Wrap it
      // in a synthetic trigger header so intervening-if extraction can run.
      let synthetic = interveningText;
      if (!/^(?:when|whenever|at)\b/i.test(synthetic)) {
        if (
          trigger.triggersOnOpponentEndStep ||
          lowerOracle.includes("each opponent's end step") ||
          lowerOracle.includes('each opponent\'s end step')
        ) {
          synthetic = `At the beginning of each opponent's end step, ${synthetic}`;
        } else if (lowerOracle.includes('your end step')) {
          synthetic = `At the beginning of your end step, ${synthetic}`;
        } else {
          synthetic = `At the beginning of each end step, ${synthetic}`;
        }
      }

      const needsThatPlayerRef = /\bthat player\b/i.test(synthetic) || /\btheir\b/i.test(synthetic);

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        synthetic,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined
      );
      if (ok === false) continue;

      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferEndStepWhoseTurn(trigger, oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: (ctx as any).state,
      })) {
        continue;
      }
      triggers.push(trigger);
    }

    const parsedPhaseLines = collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'beginning_of_end_step',
      subjectPermanent: permanent,
      subjectControllerId: String(permanent.controller || ''),
      sourcePermanent: permanent,
      activePlayerId,
    });
    for (const line of parsedPhaseLines) {
      const normalized = line.effect.toLowerCase();
      const already = triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates([existing.effect, existing.description], line)
      ));
      if (already) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        triggerType: 'end_step_effect',
        description: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
        stackItem: {
          ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        },
      });
    }
  }

  triggers.push(...collectDelayedEndStepRegistryTriggers(ctx, activePlayerId));

  return dropTriggersFromAbilitylessSources(triggers, ctx.state, (t: any) => String(t?.permanentId || ''), { event: 'step' });
}

// ============================================================================
// Draw Step Trigger System
// ============================================================================

/**
 * Detect draw step triggers from a card's oracle text
 * Pattern: "At the beginning of your draw step" or "At the beginning of each player's draw step"
 *
 * IMPORTANT: Do not put "draws additional card(s)" draw-step effects on the stack.
 * Cards like Font of Mythos / Howling Mine / Kami of the Crescent Moon are handled by
 * calculateAdditionalDraws in game-state-effects.ts (extra cards drawn as the turn-based
 * draw action). Real triggers such as Teferi's Puzzle Box still go on the stack.
 */
/**
 * True when a draw-step trigger's effect is only "draw N additional card(s)".
 * Those are applied via calculateAdditionalDraws (turn-based draw), not the stack.
 */
export function isAdditionalDrawOnlyEffect(effect: string): boolean {
  const text = String(effect || '').trim();
  if (!text) return false;
  // Entire remaining effect is only "… draws/draw N additional card(s)" (optional intervening-if).
  return /^(?:if\b.+?,\s*)?(?:that player\s+)?draws?\s+(?:(?:an?|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?additional\s+cards?\.?$/i.test(
    text,
  );
}

/** True when oracle text is a draw-step additional-draw effect (Font of Mythos, Howling Mine, …). */
export function isAdditionalDrawOnlyDrawStepOracle(oracleText: string): boolean {
  const text = String(oracleText || '');
  if (!/at the beginning of (?:your|each(?: player's)?|each of your) draw steps?/i.test(text)) {
    return false;
  }
  const match = text.match(
    /at the beginning of (?:your|each(?: player's)?|each of your) draw steps?,?\s*([^.]+)/i,
  );
  return Boolean(match && isAdditionalDrawOnlyEffect(String(match[1] || '')));
}

/**
 * Collect additional-draw-only draw-step abilities for diagnostics.
 * Those effects stay off detectDrawStepTriggers (turn-based extra draws via
 * calculateAdditionalDraws) and are not a phase-skip DRAW stop.
 */
export function collectAdditionalDrawOnlyDrawStepTriggers(
  ctx: GameContext,
  activePlayerId: string,
): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const oracleText = String(permanent.card.oracle_text || '');
    if (!isAdditionalDrawOnlyDrawStepOracle(oracleText)) continue;

    const controllerId = String(permanent.controller || '');
    if (!shouldQueuePhaseTriggerForActivePlayer({
      whose: inferDrawStepWhoseTurn(oracleText),
      activePlayerId,
      controllerId,
      sourcePermanent: permanent,
      state: (ctx as any).state,
    })) {
      continue;
    }

    const match = oracleText.match(
      /at the beginning of (?:your|each(?: player's)?|each of your) draw steps?,?\s*([^.]+)/i,
    );
    const effect = String(match?.[1] || 'draw an additional card').trim();
    triggers.push({
      permanentId: String(permanent.id || ''),
      cardName: permanent.card.name || 'Unknown',
      controllerId,
      description: effect,
      effect,
      mandatory: true,
    });
  }

  return triggers;
}

export function detectDrawStepTriggers(card: any, permanent: any, gameState?: any): DrawStepTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'step' })) return []; // Humility / Torpor Orb gate
  const triggers: DrawStepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  const lowerOracle = oracleText.toLowerCase();
  const hasExplicitDrawStepTrigger = /at the beginning of (?:your|each(?: player's)?|each opponent's|enchanted player's) draw step/i.test(oracleText);
  if (
    !hasExplicitDrawStepTrigger &&
    lowerOracle.includes('draw') &&
    (lowerOracle.includes('additional card') || lowerOracle.includes('an extra card'))
  ) {
    return triggers;
  }

  const eachOfYourDrawMatch = oracleText.match(/at the beginning of each of your draw steps,?\s*([^.]+)/i);
  if (eachOfYourDrawMatch) {
    const effect = timingTriggerEffect(oracleText, eachOfYourDrawMatch);
    if (!isAdditionalDrawOnlyEffect(effect)) {
      triggers.push({
        permanentId,
        cardName: card?.name || 'Unknown',
        controllerId,
        description: effect,
        effect,
        mandatory: true,
      });
    }
  }

  // "At the beginning of your draw step" - actual triggers (skip additional-draw-only)
  const yourDrawMatch = oracleText.match(/at the beginning of your draw step,?\s*([^.]+)/i);
  if (yourDrawMatch) {
    const effect = timingTriggerEffect(oracleText, yourDrawMatch);
    if (!isAdditionalDrawOnlyEffect(effect)) {
      triggers.push({
        permanentId,
        cardName: card?.name || "Unknown",
        controllerId,
        description: effect,
        effect: effect,
        mandatory: true,
      });
    }
  }

  // "At the beginning of each player's draw step" - actual triggers (skip additional-draw-only)
  const eachDrawMatch = oracleText.match(/at the beginning of each player's draw step,?\s*([^.]+)/i);
  if (eachDrawMatch) {
    const effect = timingTriggerEffect(oracleText, eachDrawMatch);
    if (!isAdditionalDrawOnlyEffect(effect)) {
      triggers.push({
        permanentId,
        cardName: card?.name || "Unknown",
        controllerId,
        description: effect,
        effect: effect,
        mandatory: true,
      });
    }
  }

  const opponentDrawMatch = oracleText.match(/at the beginning of each opponent's draw step,?\s*([^.]+)/i);
  if (opponentDrawMatch) {
    const effect = timingTriggerEffect(oracleText, opponentDrawMatch);
    if (!isAdditionalDrawOnlyEffect(effect)) {
      triggers.push({
        permanentId,
        cardName: card?.name || 'Unknown',
        controllerId,
        description: effect,
        effect,
        mandatory: !/\byou may\b/i.test(effect),
      });
    }
  }

  const enchantedPlayerDrawMatch = oracleText.match(
    /at the beginning of enchanted player's draw step,?\s*([^.]+)/i,
  );
  if (enchantedPlayerDrawMatch) {
    const effect = timingTriggerEffect(oracleText, enchantedPlayerDrawMatch);
    if (!isAdditionalDrawOnlyEffect(effect)) {
      triggers.push({
        permanentId,
        cardName: card?.name || 'Unknown',
        controllerId,
        description: effect,
        effect,
        mandatory: !/\byou may\b/i.test(effect),
      });
    }
  }

  return triggers;
}

/**
 * Get all draw step triggers for the active player's draw step
 */
export function getDrawStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  // A skipped draw step (Necropotence, Yawgmoth's Bargain) never begins, so its
  // "beginning of draw step" triggers never fire (rule 500.11).
  if (ctx.state && findStaticSkipDrawStepSource(ctx.state as any, activePlayerId)) {
    // Fasting-style optional skip: "If you do, you gain N life" (idempotent per turn).
    applyOptionalDrawStepSkipLifeGain(ctx, activePlayerId);
    return triggers;
  }
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectDrawStepTriggers(permanent.card, permanent, (ctx as any)?.state);
    
    for (const trigger of permTriggers) {
      // Intervening-if (Rule 603.4): if the condition is false at the time the trigger
      // would trigger, the ability does not trigger and should not be put on the stack.
      // If the condition is unrecognized, keep the trigger (conservative fallback).
      const interveningText = String(trigger.effect || trigger.description || '').trim();
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();

      let synthetic = interveningText;
      if (!/^(?:when|whenever|at)\b/i.test(synthetic)) {
        if (lowerOracle.includes('each player') && lowerOracle.includes('draw step')) {
          synthetic = `At the beginning of each player's draw step, ${synthetic}`;
        } else {
          synthetic = `At the beginning of your draw step, ${synthetic}`;
        }
      }

      const needsThatPlayerRef = /\bthat player\b/i.test(synthetic) || /\btheir\b/i.test(synthetic);

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        synthetic,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined
      );
      if (ok === false) continue;

      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferDrawStepWhoseTurn(permanent.card.oracle_text || ''),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: (ctx as any).state,
      })) {
        continue;
      }
      triggers.push(trigger);
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card?.oracle_text || ''),
      event: 'beginning_of_draw_step',
      subjectPermanent: permanent,
      subjectControllerId: String(permanent.controller || ''),
      sourcePermanent: permanent,
      activePlayerId,
    })) {
      const normalized = line.effect.toLowerCase();
      // Additional-draw effects (Howling Mine, Immortal Sun) are applied by calculateAdditionalDraws.
      if (isAdditionalDrawOnlyEffect(line.effect)) continue;
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates([existing.effect, existing.description], line)
      ))) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        description: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
      });
    }
  }
  
  return dropTriggersFromAbilitylessSources(triggers, ctx.state, (t: any) => String(t?.permanentId || ''), { event: 'step' });
}

// ============================================================================
// "Doesn't Untap" Effects
// ============================================================================

/**
 * Detect "doesn't untap" effects from a card's oracle text
 * Handles cards like:
 * - Claustrophobia: "Enchanted creature doesn't untap during its controller's untap step"
 * - Frozen/Sleep effects: "Target creature doesn't untap during its controller's next untap step"
 * - Stasis: "Players skip their untap steps"
 * - Rising Waters: "Lands don't untap during their controllers' untap steps"
 */
export function detectDoesntUntapEffects(card: any, permanent: any): DoesntUntapEffect[] {
  const effects: DoesntUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedTo = permanent?.attachedTo;
  
  // Aura pattern: "Enchanted creature doesn't untap during its controller's untap step"
  if (oracleText.includes('enchanted creature') && oracleText.includes("doesn't untap")) {
    if (attachedTo) {
      effects.push({
        permanentId,
        cardName,
        controllerId,
        affectedType: 'specific_permanent',
        affectedController: 'all',
        targetPermanentId: attachedTo,
        description: "Enchanted creature doesn't untap during its controller's untap step",
      });
    }
  }

  // Self-referential pattern: "[This permanent] doesn't untap during your/its controller's untap step"
  if (
    oracleText.includes("doesn't untap during your untap step") ||
    oracleText.includes("doesn't untap during its controller's untap step")
  ) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      affectedType: 'specific_permanent',
      affectedController: 'all',
      targetPermanentId: permanentId,
      description: `${cardName} doesn't untap during its controller's untap step`,
    });
  }
  
  // Global effect: "Creatures don't untap during their controllers' untap steps"
  if (oracleText.includes('creatures') && oracleText.includes("don't untap") && oracleText.includes('controllers')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      affectedType: 'all_creatures',
      affectedController: 'all',
      ...(() => { const c = oracleText.match(/\b(white|blue|black|red|green)\s+creatures\s+don't untap/); return c ? { colorFilter: c[1] } : {}; })(),
      description: "Creatures don't untap during their controllers' untap steps",
    });
  }
  
  // Global effect: "Lands don't untap during their controllers' untap steps"
  if (oracleText.includes('lands') && oracleText.includes("don't untap") && oracleText.includes('controllers')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      affectedType: 'all_lands',
      affectedController: 'all',
      ...(() => { const l = oracleText.match(/\b(plains|island|swamp|mountain|forest)s?\s+don't untap/); return l ? { landSubtypeFilter: l[1] } : {}; })(),
      description: "Lands don't untap during their controllers' untap steps",
    });
  }
  
  return effects;
}

/**
 * Check if a permanent is prevented from untapping by any "doesn't untap" effects
 */
export function isPermanentPreventedFromUntapping(
  ctx: GameContext,
  permanentToUntap: any,
  untapPlayerId: string
): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permTypeLine = (permanentToUntap?.card?.type_line || '').toLowerCase();
  const isCreature = permTypeLine.includes('creature');
  const isLand = permTypeLine.includes('land');
  const permController = permanentToUntap?.controller;
  
  // Check all permanents for "doesn't untap" effects
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const doesntUntapEffects = detectDoesntUntapEffects(permanent.card, permanent);
    
    for (const effect of doesntUntapEffects) {
      // Check if this effect applies to the permanent trying to untap
      
      // Specific permanent targeting (like Claustrophobia)
      if (effect.affectedType === 'specific_permanent') {
        if (effect.targetPermanentId === permanentToUntap.id) {
          return true; // This permanent is specifically prevented from untapping
        }
        continue;
      }
      
      // Check controller restriction
      let controllerMatches = false;
      switch (effect.affectedController) {
        case 'all':
          controllerMatches = true;
          break;
        case 'controller':
          controllerMatches = permController === effect.controllerId;
          break;
        case 'opponents':
          controllerMatches = permController !== effect.controllerId;
          break;
      }
      
      if (!controllerMatches) continue;
      
      // Check type restriction
      switch (effect.affectedType) {
        case 'all_creatures':
          if (effect.colorFilter && !permanentHasColorName(permanentToUntap, effect.colorFilter)) break;
          if (isCreature) return true;
          break;
        case 'all_lands':
          if (effect.landSubtypeFilter && !new RegExp('\\b' + effect.landSubtypeFilter + '\\b').test(permTypeLine)) break;
          if (isLand) return true;
          break;
        case 'all_permanents':
          return true;
        case 'controller_creatures':
          if (isCreature && permController === untapPlayerId) return true;
          break;
        case 'controller_lands':
          if (isLand && permController === untapPlayerId) return true;
          break;
      }
    }
  }
  
  // Also check if the permanent itself has a "doesn't untap" flag
  // This can be set by spells like Sleep or Hands of Binding
  if (permanentToUntap.doesntUntapNextTurn === true) {
    return true;
  }
  
  return false;
}

function permanentHasColorName(perm: any, color: string): boolean {
  const letter = ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[color];
  const colors = perm?.colors ?? perm?.card?.colors ?? [];
  return Array.isArray(colors) && colors.some((c: any) => String(c).toUpperCase() === letter || String(c).toLowerCase() === color);
}

export { shouldSkipUntapStepForPlayer } from "../skipUntapStepUtils.js";
