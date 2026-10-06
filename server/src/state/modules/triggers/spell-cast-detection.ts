/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectSpellCastTriggers (merged into triggers/; leftover re-exports)
 * Public: detectSpellCastTriggers
 */

import { getActivePermanentCardFace } from "../cardFaceOracle.js";
import {
  getSpellCastConditionData as parseSpellCastConditionData,
  getSpellCastEffectMetadata as parseSpellCastEffectMetadata,
} from "./spell-cast-condition-helpers.js";
import {
  applyFirstTimeEachTurnFlags,
  resolveDetectorOracleForPermanent,
} from "./detectorGrantedOracle.js";
import { appendSpellCastDetectionLate } from "./spell-cast-detection-late.js";
import { appendSpellCastDetectionMid } from "./spell-cast-detection-mid.js";
import type { SpellCastDetectionState } from "./spell-cast-detection-state.js";
import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
/**
 * Detect spell-cast triggered abilities from a card's oracle text
 * Handles cards like:
 * - Merrow Reejerey: "Whenever you cast a Merfolk spell, you may tap or untap target permanent"
 * - Deeproot Waters: "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof"
 * - Beast Whisperer: "Whenever you cast a creature spell, draw a card"
 * - Archmage Emeritus: "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card"
 * - Harmonic Prodigy: "If an ability of a Shaman or Wizard you control triggers, that ability triggers an additional time"
 */
export function detectSpellCastTriggers(card: any, permanent: any, state?: unknown): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const face = getActivePermanentCardFace(card, permanent, state);
  const annotated = resolveDetectorOracleForPermanent(permanent, face.oracleText, state);
  const cardName = face.cardName;
  const oracleText = annotated.oracleText;
  const lowerOracle = oracleText.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  // Increment: retain the full trigger condition so the common
  // spell-cast emitter can evaluate it both when triggering and resolving.
  if (/(?:^|\n)\s*increment\s*(?:\([^)]*\))?\s*(?:\n|$)/i.test(oracleText)) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, if this permanent is a creature and the amount of mana spent to cast that spell is greater than this creature's power or this creature's toughness, put a +1/+1 counter on this creature.",
      effect: 'Put a +1/+1 counter on this creature.',
      spellCondition: 'any',
      mandatory: true,
    });
  }

  const playerCastsCommanderOrAttacksMatch = oracleText.match(
    /whenever a player casts their commander or attacks with their commander,?\s*([^.]+)/i,
  );
  if (
    playerCastsCommanderOrAttacksMatch &&
    !triggers.some((t) => String(t.description || '').toLowerCase().includes('casts their commander or attacks'))
  ) {
    const effectText = timingTriggerEffect(oracleText, playerCastsCommanderOrAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player casts their commander or attacks with their commander, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commander',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPlayerCrimeMatch = oracleText.match(/whenever a player commits a crime,?\s*([^.]+)/i);
  if (anyPlayerCrimeMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('commits a crime'))) {
    const effectText = timingTriggerEffect(oracleText, anyPlayerCrimeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player commits a crime, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commit_a_crime',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commitCrimeMatch = oracleText.match(/whenever you commit a crime,?\s*([^.]+)/i);
  if (commitCrimeMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('commit a crime'))) {
    const effectText = timingTriggerEffect(oracleText, commitCrimeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you commit a crime, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commit_a_crime',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonSliverCreatureSpellCastMatch = oracleText.match(
    /whenever you cast a non-Sliver creature spell,?\s*([^.]+)/i,
  );
  if (
    nonSliverCreatureSpellCastMatch &&
    !triggers.some((t) => String(t.description || '').toLowerCase().includes('non-sliver creature spell'))
  ) {
    const effectText = timingTriggerEffect(oracleText, nonSliverCreatureSpellCastMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a non-Sliver creature spell, ${effectText}`,
      effect: effectText,
      spellCondition: 'creature',
      tribalType: 'non-sliver',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youCopySpellMatch = oracleText.match(/whenever you copy a spell,?\s*([^.]+)/i);
  if (youCopySpellMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('copy a spell'))) {
    const effectText = timingTriggerEffect(oracleText, youCopySpellMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you copy a spell, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleACardMatch = oracleText.match(/whenever you cycle a card,?\s*([^.]+)/i);
  if (cycleACardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle a card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleACardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cycle a card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      triggerEvent: 'cycle',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleAnotherCardMatch = oracleText.match(/whenever you cycle another card,?\s*([^.]+)/i);
  if (cycleAnotherCardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle another card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleAnotherCardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cycle another card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      triggerEvent: 'cycle',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleThisCardMatch = oracleText.match(/when(?:ever)? you cycle this card,?\s*([^.]+)/i);
  if (cycleThisCardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle this card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleThisCardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `When you cycle this card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      triggerEvent: 'cycle',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPlayACardMatch = oracleText.match(/whenever you play a card(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/i);
  if (youPlayACardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('you play a card'))) {
    const effectText = timingTriggerEffect(oracleText, youPlayACardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you play a card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPlayACardThisWayMatch = oracleText.match(/when you play a card this way,?\s*([^.]+)/i);
  if (youPlayACardThisWayMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('play a card this way'))) {
    const effectText = timingTriggerEffect(oracleText, youPlayACardThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `When you play a card this way, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Self-cast / Storm / Cascade ("When you cast this spell") are NOT permanent
  // spell-cast watchers. They fire only via resolveOnCastSpellTriggerDescriptions
  // when that card is cast as a spell. Registering them here with spellCondition
  // 'any' incorrectly re-fires Hatut/Storm/Cascade from battlefield permanents
  // whenever you cast any later spell (G1: Beast Within after Hatut copies).


  const getSpellCastConditionData = parseSpellCastConditionData;
  const getSpellCastEffectMetadata = (effectText: string, tribalType?: string) =>
    parseSpellCastEffectMetadata(lowerOracle, effectText, tribalType);

  const castUsingProducedManaMatch = oracleText.match(
    /whenever you cast an (?:artifact or creature|creature or artifact) spell using mana produced by ([^,]+),?\s*([^.]+)/i,
  );
  if (
    castUsingProducedManaMatch &&
    !triggers.some((trigger) => trigger.spellCondition === 'artifact_or_creature' && trigger.requiresManaFromPermanentId === permanentId)
  ) {
    const effectText = timingTriggerEffect(oracleText, castUsingProducedManaMatch, 2).trim();
    const { createsToken } = getSpellCastEffectMetadata(effectText);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast an artifact or creature spell using mana produced by ${String(castUsingProducedManaMatch[1] || cardName).trim()}, ${effectText}`,
      effect: effectText,
      spellCondition: 'artifact_or_creature',
      requiresManaFromPermanentId: permanentId,
      createsToken,
      mandatory: true,
    });
  }
  
  const creatureSpellMinPowerMatch = oracleText.match(
    /(?:when|whenever) you cast a creature spell with power (\d+) or greater,?\s*([^.]+)/i,
  );
  if (
    creatureSpellMinPowerMatch &&
    !triggers.some((t) => t.minSpellPower != null && t.spellCondition === 'creature')
  ) {
    const minSpellPower = parseInt(creatureSpellMinPowerMatch[1], 10);
    const effectText = timingTriggerEffect(oracleText, creatureSpellMinPowerMatch, 2).trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a creature spell with power ${minSpellPower} or greater, ${effectText}`,
      effect: effectText,
      spellCondition: 'creature',
      minSpellPower: Number.isFinite(minSpellPower) ? minSpellPower : undefined,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sharesCreatureTypeMatch = oracleText.match(
    /whenever you cast a spell that shares a creature type with this creature,?\s*([^.]+)/i,
  );
  if (sharesCreatureTypeMatch) {
    const effectText = timingTriggerEffect(oracleText, sharesCreatureTypeMatch);
    if (effectText && !triggers.some((trigger) => trigger.effect === effectText && trigger.requiresSharedCreatureTypeWithSource)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast a spell that shares a creature type with this creature, ${effectText}`,
        effect: effectText,
        spellCondition: 'any',
        requiresSharedCreatureTypeWithSource: true,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const detectionState: SpellCastDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    controllerId,
    card,
    permanent,
    state,
    getSpellCastConditionData,
    getSpellCastEffectMetadata,
  };
  appendSpellCastDetectionMid(detectionState);
  appendSpellCastDetectionLate(detectionState);

  return applyFirstTimeEachTurnFlags(triggers, annotated);
}
