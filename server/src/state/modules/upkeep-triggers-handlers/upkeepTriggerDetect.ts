// server/src/state/modules/upkeep-triggers-handlers/upkeepTriggerDetect.ts
// Origin parent: server/src/state/modules/upkeep-triggers.ts
// Cluster moved: detectUpkeepTriggers (oracle-text upkeep trigger detection).
// Public entry symbols: detectUpkeepTriggers.

import { timingTriggerEffect } from "../triggers/timing-effect-extraction.js";
import { isControllerOptionalTriggeredAbilityEffect } from "../trigger-runtime-wiring.js";
import { getActivePermanentCardFace } from "../cardFaceOracle.js";
import type { UpkeepTrigger } from "./upkeepTriggerDetectHelpers.js";
import {
  normalizeUpkeepEffectText,
  hasMatchingUpkeepEffect,
  isSacrificeCreatureOrSelfOracle,
} from "./upkeepTriggerDetectHelpers.js";
import { shouldTriggerEcho } from "./upkeepEchoHelpers.js";
import { resolveDetectorOracleForPermanent } from "../triggers/detectorGrantedOracle.js";
import { permanentHasTriggeredAbilities } from '../triggers/triggeredAbilitySuppression.js';

/**
 * Detect upkeep triggers from a card's oracle text
 */
export function detectUpkeepTriggers(card: any, permanent: any, state?: any): UpkeepTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, state, { event: 'step' })) return []; // Humility / Torpor Orb gate
  const triggers: UpkeepTrigger[] = [];
  const activeFace = getActivePermanentCardFace(card, permanent, state);
  const annotated = resolveDetectorOracleForPermanent(permanent, activeFace.oracleText, state);
  const oracleText = annotated.oracleText;
  const lowerOracle = oracleText.toLowerCase();
  const cardName = activeFace.cardName;
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  const sacrificeCreatureOrSelf = isSacrificeCreatureOrSelfOracle(oracleText);
  
  // Cumulative upkeep - adds age counter, pay cost for each
  const cumulativeMatch = oracleText.match(/cumulative upkeep[—\-\s]*(\{[^}]+\}(?:\s*\{[^}]+\})*|[^(.\n]+)/i);
  if (cumulativeMatch) {
    const ageCounters = (counters["age"] || 0) + 1;
    const cost = cumulativeMatch[1].trim().replace(/^pay\s+/i, '');
    
    // Special case: Braid of Fire has "Cumulative upkeep—Add {R}" or similar
    // This ADDS mana instead of requiring payment
    // Match patterns like "Add {R}", "Add {R}{R}", "Add {R}{G}", "Add {C}", etc.
    // Supports {W}{U}{B}{R}{G}{C} for all mana types
    const isAddingMana = /^add\s+(?:\{[WUBRGC]\})+$/i.test(cost);
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'cumulative_upkeep',
      cost: cost,
      description: isAddingMana 
        ? `${cost} for each age counter (will be ${ageCounters})`
        : `Pay ${cost} for each age counter (will be ${ageCounters})`,
      counters: ageCounters,
      mandatory: true, // pay-or-sacrifice choice is made on resolution (cumulativeUpkeepPayment)
      consequence: `Sacrifice ${cardName}`,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Echo - pay echo cost on first upkeep after entering
  if (lowerOracle.includes("echo") && !permanent?.echoPaid && shouldTriggerEcho(state, permanent)) {
    const echoMatch = oracleText.match(/echo\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (echoMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'echo',
        cost: echoMatch[1],
        description: `Pay ${echoMatch[1]} or sacrifice`,
        mandatory: false,
        consequence: `Sacrifice ${cardName}`,
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  // Fading - remove fade counter, sacrifice when none left
  if (lowerOracle.includes("fading")) {
    const fadeCounters = counters["fade"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'fading',
      description: fadeCounters > 0 
        ? `Remove fade counter (${fadeCounters - 1} will remain)`
        : `No fade counters - sacrifice`,
      counters: fadeCounters,
      mandatory: true,
      consequence: fadeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Vanishing - remove time counter, sacrifice when none left
  if (lowerOracle.includes("vanishing")) {
    const timeCounters = counters["time"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vanishing',
      description: timeCounters > 0
        ? `Remove time counter (${timeCounters - 1} will remain)`
        : `No time counters - sacrifice`,
      counters: timeCounters,
      mandatory: true,
      consequence: timeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Pacts - pay or lose the game
  if (lowerOracle.includes("pact") && lowerOracle.includes("lose the game")) {
    const pactMatch = oracleText.match(/pay\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (pactMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'pact',
        cost: pactMatch[1],
        description: `Pay ${pactMatch[1]} or lose the game`,
        mandatory: true,
        consequence: 'You lose the game',
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  const nextTurnUpkeepMatch = oracleText.match(
    /at the beginning of the next turn's upkeep,?\s*([^.]+)/i,
  );
  if (nextTurnUpkeepMatch && !triggers.some((t) => t.triggerType === 'next_turn_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, nextTurnUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'next_turn_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  const embeddedNextTurnUpkeepMatch = oracleText.match(
    /([^.]+) at the beginning of the next turn's upkeep/i,
  );
  if (
    embeddedNextTurnUpkeepMatch &&
    !triggers.some((t) => t.triggerType === 'next_turn_upkeep')
  ) {
    const effectText = timingTriggerEffect(oracleText, embeddedNextTurnUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'next_turn_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  const planeswalkAndUpkeepMatch = oracleText.match(
    /when you planeswalk here and at the beginning (?:of )?your upkeep,?\s*([^.]+)/i,
  );
  if (planeswalkAndUpkeepMatch && !triggers.some((t) => t.triggerType === 'planeswalk_and_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkAndUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalk_and_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const reboundUpkeepMatch = oracleText.match(
    /at the beginning of your next upkeep,?\s*you may cast this card from exile[^.]*\.?/i,
  );
  if (reboundUpkeepMatch && !triggers.some((trigger) => trigger.triggerType === 'rebound')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rebound',
      description: 'You may cast this card from exile without paying its mana cost',
      effect: 'You may cast this card from exile without paying its mana cost',
      mandatory: false,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  if (
    /\brebound\b/i.test(oracleText) &&
    !triggers.some((trigger) => trigger.triggerType === 'rebound' || trigger.triggerType === 'your_next_upkeep')
  ) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rebound',
      description: 'You may cast this card from exile without paying its mana cost at the beginning of your next upkeep',
      effect: 'You may cast this card from exile without paying its mana cost at the beginning of your next upkeep',
      mandatory: false,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const enchantedControllerUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller,?\s*([^.]+)/i,
  );
  if (enchantedControllerUpkeepMatch && !triggers.some((trigger) => trigger.triggerType === 'enchanted_controller_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, enchantedControllerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_controller_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const yourUpkeepPatterns = [
    /at the beginning of each of your upkeeps?,?\s*([^.]+)/i,
    /at the beginning of your next upkeep,?\s*([^.]+)/i,
    /at the beginning of your upkeep,?\s*([^.]+)/i,
  ];
  let yourUpkeepMatch: RegExpMatchArray | null = null;
  for (const pattern of yourUpkeepPatterns) {
    yourUpkeepMatch = oracleText.match(pattern);
    if (yourUpkeepMatch) break;
  }
  // Sacrifice-or-self is typed separately; avoid truncated/paraphrase duplicates.
  if (yourUpkeepMatch && !sacrificeCreatureOrSelf) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, yourUpkeepMatch));
    // Fading/vanishing keyword paths already own the remove-counter/sacrifice reminder.
    const isFadingOrVanishingReminder =
      /^(?:remove a (?:fade|time) counter from (?:it|this(?:\s+\w+)?)\.?\s*)(?:if you can'?t,?\s*sacrifice (?:it|this(?:\s+\w+)?)(?:\.|$))?/i.test(
        effectText,
      );
    const hasKeywordCounterUpkeep = triggers.some((t) =>
      t.triggerType === 'fading' || t.triggerType === 'vanishing',
    );
    if (!(isFadingOrVanishingReminder && hasKeywordCounterUpkeep)) {
      const hasCost = effectText.toLowerCase().includes("pay") || effectText.toLowerCase().includes("sacrifice");
      const isOptional = isControllerOptionalTriggeredAbilityEffect(effectText);
      if (!hasMatchingUpkeepEffect(triggers, effectText, ['upkeep_effect'])) {
        triggers.push({
          permanentId,
          cardName,
          triggerType: 'upkeep_effect',
          description: effectText,
          effect: effectText,
          mandatory: !isOptional,
          requiresChoice: isOptional || hasCost || /\beach player may\b/i.test(effectText),
          controllerTrigger: true,
          anyPlayerTrigger: false,
        });
      }
    }
  }
  
  const enchantedPlayerFirstUpkeepMatch = oracleText.match(
    /at the beginning of enchanted player's first upkeep each turn,?\s*([^.]+)/i,
  );
  if (
    enchantedPlayerFirstUpkeepMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_player_first_upkeep')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerFirstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const enchantedPlayerUpkeepMatch = oracleText.match(/at the beginning of enchanted player's upkeep,?\s*([^.]+)/i);
  if (enchantedPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'enchanted_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const firstUpkeepMatch = oracleText.match(/at the beginning of the first upkeep,?\s*([^.]+)/i);
  if (firstUpkeepMatch && !triggers.some((t) => t.triggerType === 'first_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, firstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const yourFirstUpkeepMatch = oracleText.match(/at the beginning of your first upkeep,?\s*([^.]+)/i);
  if (yourFirstUpkeepMatch && !triggers.some((t) => t.triggerType === 'your_first_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, yourFirstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'your_first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const chosenPlayerUpkeepMatch = oracleText.match(/at the beginning of the chosen player's upkeep,?\s*([^.]+)/i);
  if (chosenPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'chosen_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, chosenPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  // "At the beginning of each player's upkeep"
  const eachPlayerUpkeepMatch = oracleText.match(/at the beginning of each player's upkeep,?\s*([^.]+)/i);
  if (eachPlayerUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, eachPlayerUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['each_player_upkeep', 'upkeep_effect'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'each_player_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: true,
        anyPlayerTrigger: true,
      });
    }
  }
  
  // "At the beginning of each upkeep"
  const eachUpkeepMatch = oracleText.match(/at the beginning of each upkeep,?\s*([^.]+)/i);
  if (eachUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, eachUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['each_upkeep', 'upkeep_effect', 'each_player_upkeep'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'each_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: true,
        anyPlayerTrigger: true,
      });
    }
  }
  
  const eachParticipantUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of each participant in this game[^,]*,?\s*([^.]+)/i,
  );
  if (eachParticipantUpkeepMatch && !triggers.some((t) => t.triggerType === 'each_participant_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachParticipantUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_participant_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const eachOtherPlayerUpkeepMatch = oracleText.match(
    /at the beginning of each other player's upkeep,?\s*([^.]+)/i,
  );
  if (eachOtherPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'each_other_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachOtherPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_other_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const exiledCardOwnerUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of the exiled card's owner,?\s*([^.]+)/i,
  );
  if (exiledCardOwnerUpkeepMatch && !triggers.some((t) => t.triggerType === 'exiled_card_owner_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, exiledCardOwnerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exiled_card_owner_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const eachOfThatPlayerUpkeepsMatch = oracleText.match(
    /at the beginning of each of that player's upkeeps,?\s*([^.]+)/i,
  );
  if (eachOfThatPlayerUpkeepsMatch && !triggers.some((t) => t.triggerType === 'each_of_that_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachOfThatPlayerUpkeepsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_of_that_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  // "At the beginning of each opponent's upkeep"
  const opponentUpkeepMatch = oracleText.match(/at the beginning of each opponent's upkeep,?\s*([^.]+)/i);
  if (opponentUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, opponentUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['opponent_upkeep', 'upkeep_effect'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'opponent_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: false,
        anyPlayerTrigger: false, // Only on opponent's turns
      });
    }
  }
  
  // ============================================================================
  // SACRIFICE CREATURE OR SELF PATTERN (Dynamic Detection)
  // ============================================================================
  // Pattern: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice ~"
  // or: "sacrifice a creature or sacrifice ~"
  // Examples: Eldrazi Monument, Demonic Appetite, Jinxed Idol
  // 
  // Use module-level constants for these patterns (defined at top of file)
  if (
    sacrificeCreatureOrSelf
    && !triggers.some((trigger) => trigger.triggerType === 'sacrifice_creature_or_self')
  ) {
    // Determine what type of permanent this is for the alternative sacrifice
    const permTypeLine = (activeFace.typeLine || card?.type_line || '').toLowerCase();
    let sacrificeAlternativeType = 'this permanent';
    if (permTypeLine.includes('artifact')) {
      sacrificeAlternativeType = 'this artifact';
    } else if (permTypeLine.includes('enchantment')) {
      sacrificeAlternativeType = 'this enchantment';
    } else if (permTypeLine.includes('creature')) {
      sacrificeAlternativeType = 'this creature';
    }
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'sacrifice_creature_or_self',
      description: `Sacrifice a creature. If you can't, sacrifice ${cardName}.`,
      effect: 'sacrifice_creature_or_self',
      mandatory: true,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
      consequence: `Sacrifice ${cardName}`,
      sacrificeAlternativeType,
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    });
  }
  
  return triggers;
}
