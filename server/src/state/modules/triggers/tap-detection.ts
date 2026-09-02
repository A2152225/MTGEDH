/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectTapTriggers + TapTrigger (merged into triggers/; leftover re-exports)
 * Public: detectTapTriggers, TapTrigger
 */

import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { ENTERS_OR_OTHER_EVENT_PREFIX } from "./enters-or-other-event-prefix.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import {
  applyFirstTimeEachTurnFlags,
  resolveDetectorOracleForPermanent,
} from "./detectorGrantedOracle.js";

function isOptionalTapTriggerEffect(effectText: string): boolean {
  const normalized = String(effectText || '').trim();
  if (!/\byou may\b/i.test(normalized)) {
    return false;
  }
  // "you may pay {cost}. If you do, ..." is still a mandatory trigger; only the cost/effect is optional.
  if (/^\s*you may pay\b/i.test(normalized)) {
    return false;
  }
  return true;
}
// ============================================================================
// Tap/Untap Triggered Abilities
// (Judge of Currents, Emmara Soul of the Accord, Glare of Subdual, etc.)
// ============================================================================

export interface TapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  triggerCondition: string;
  affectedType: string;
  tribalType?: string; // For "Whenever a Merfolk becomes tapped"
  nontokenOnly?: boolean;
  /** "Whenever one or more … become tapped" fires once per tap event, not per permanent. */
  oneOrMoreBatch?: boolean;
  /** "Whenever this creature becomes tapped for the first time each turn". */
  oncePerTurn?: boolean;
  /** "for the first time during each of your turns". */
  onlyOnControllerTurn?: boolean;
  mandatory: boolean;
  lifeGain?: number;
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
  };
}

/**
 * Detect tap/untap triggered abilities from a card's oracle text
 * Handles cards like:
 * - Judge of Currents: "Whenever a Merfolk you control becomes tapped, you may gain 1 life"
 * - Emmara, Soul of the Accord: "Whenever Emmara, Soul of the Accord becomes tapped, create a 1/1 white Soldier creature token with lifelink"
 * - Fallowsage: "Whenever Fallowsage becomes tapped, you may draw a card"
 * - Opposition: Tap creatures to tap opponent's permanents
 */
export function detectTapTriggers(card: any, permanent: any, gameState?: any): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const printedOracle = (card?.oracle_text || "");
  const annotated = resolveDetectorOracleForPermanent(permanent, printedOracle, gameState);
  const oracleText = annotated.oracleText;
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a [TYPE] you control becomes tapped" pattern
  const tribalMultiTapMatch = oracleText.match(
    /whenever (?:one or more )?nontoken (\w+) you control become tapped,?\s*([^.]+)/i,
  );
  if (tribalMultiTapMatch) {
    const tribalType = tribalMultiTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tribalMultiTapMatch, 2);
    const isOptional = isOptionalTapTriggerEffect(effectText);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever one or more nontoken ${tribalType} you control become tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      nontokenOnly: true,
      oneOrMoreBatch: /one or more/i.test(tribalMultiTapMatch[0]),
      mandatory: !isOptional,
    });
  }

  const youTapOpponentCreatureMatch = oracleText.match(
    /(?:when you (?:do, )?tap|you tap) (?:target |an )?(?:untapped )?creature an opponent controls/i,
  );
  if (youTapOpponentCreatureMatch && !triggers.some((t) => (t as any).affectedType === 'you_tap_opponent_creature')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: 'When you tap an untapped creature an opponent controls',
      effect: 'tap target creature an opponent controls',
      triggerCondition: 'you_tap_opponent_creature',
      affectedType: 'you_tap_opponent_creature',
      mandatory: false,
    });
  }

  const opponentCreatureTapMatch = oracleText.match(
    /whenever a creature an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentCreatureTapMatch) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'opponent_creature_becomes_tapped',
      affectedType: 'opponent_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTribalTapMatch = oracleText.match(
    /whenever one or more nontoken (\w+) you control become tapped,?\s*([^.]+)/i,
  );
  if (nontokenTribalTapMatch && !triggers.some((t) => t.nontokenOnly && t.tribalType === String(nontokenTribalTapMatch[1] || '').toLowerCase())) {
    const tribalType = nontokenTribalTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, nontokenTribalTapMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever one or more nontoken ${tribalType} you control become tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      nontokenOnly: true,
      oneOrMoreBatch: true,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureBecomesTappedMatch = oracleText.match(
    /whenever equipped creature becomes tapped,?\s*([^.]+)/i,
  );
  if (
    equippedCreatureBecomesTappedMatch
    && !triggers.some((t) => String((t as any).affectedType || '') === 'equipped_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever equipped creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'equipped_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureBecomesTappedMatch = oracleText.match(
    /whenever enchanted creature becomes tapped,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureBecomesTappedMatch
    && !triggers.some((t) => String((t as any).affectedType || '') === 'enchanted_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const tribalTapMatch = oracleText.match(/whenever (?:a |an )?(\w+) you control becomes tapped,?\s*([^.]+)/i);
  if (tribalTapMatch) {
    const tribalType = tribalTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tribalTapMatch, 2);
    const isOptional = isOptionalTapTriggerEffect(effectText);
    
    // Check for life gain
    const lifeGainMatch = effectText.match(/gain (\d+) life/i);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a ${tribalType} you control becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: !isOptional,
      lifeGain: lifeGainMatch ? parseInt(lifeGainMatch[1]) : undefined,
    });
  }
  
  const selfTapNameRefs = [
    '~',
    'this creature',
    'this artifact',
    'this land',
    'this permanent',
    ...buildCardNameRegexAlternatives(cardName),
  ];
  const selfTapPattern = new RegExp(
    `when(?:ever)? (?:${selfTapNameRefs.join('|')}) ${ENTERS_OR_OTHER_EVENT_PREFIX}become(?:s)? tapped,?\\s*([^.]+)`,
    'i',
  );
  const selfTapMatch = oracleText.match(selfTapPattern);
  if (selfTapMatch) {
    const effectText = timingTriggerEffect(oracleText, selfTapMatch);
    const isOptional = isOptionalTapTriggerEffect(effectText);
    
    // Check for token creation
    const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)/i);
    let createsToken = false;
    let tokenDetails: TapTrigger['tokenDetails'];
    
    if (tokenMatch || lowerOracle.includes('create') && lowerOracle.includes('token')) {
      createsToken = true;
      const powerMatch = effectText.match(/(\d+)\/(\d+)/);
      if (powerMatch) {
        tokenDetails = {
          name: 'Token',
          power: parseInt(powerMatch[1]),
          toughness: parseInt(powerMatch[2]),
          types: 'Creature',
        };
      }
    }
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever ${cardName} becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'self',
      mandatory: !isOptional,
      createsToken,
      tokenDetails,
    });
  }
  
  const thatLandTapMatch = oracleText.match(/whenever that land becomes tapped,?\s*([^.]+)/i);
  if (thatLandTapMatch && !triggers.some((t) => t.affectedType === 'that_land')) {
    const effectText = timingTriggerEffect(oracleText, thatLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever that land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'that_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactTapForManaMatch = oracleText.match(
    /whenever an opponent taps an artifact for mana,?\s*([^.]+)/i,
  );
  if (opponentArtifactTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_artifact_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_artifact_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMountainTapForManaMatch = oracleText.match(
    /whenever an opponent taps a mountain for mana,?\s*([^.]+)/i,
  );
  if (opponentMountainTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_mountain_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentMountainTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_mountain_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentTapsLandForManaMatch = oracleText.match(
    /whenever an opponent taps a land for mana,?\s*([^.]+)/i,
  );
  if (opponentTapsLandForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_taps_land_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentTapsLandForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_taps_land_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerBasicLandTapMatch = oracleText.match(
    /whenever a player taps a basic land for mana,?\s*([^.]+)/i,
  );
  if (playerBasicLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_basic_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerBasicLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_basic_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentIslandBecomesTappedMatch = oracleText.match(
    /whenever an island an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentIslandBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_island_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, opponentIslandBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_island_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactBecomesTappedOrActivatedMatch = oracleText.match(
    /whenever an artifact becomes tapped or a player activates an artifact's ability without \{T\} in its activation cost,?\s*([^.]+)/i,
  );
  if (
    artifactBecomesTappedOrActivatedMatch &&
    !triggers.some((t) => (t as any).affectedType === 'artifact_becomes_tapped_or_activated')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactBecomesTappedOrActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'artifact_becomes_tapped_or_activated',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itNextBecomesTappedMatch = oracleText.match(/whenever it next becomes tapped this turn,?\s*([^.]+)/i);
  if (itNextBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'it_next_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, itNextBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'it_next_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMountainBecomesTappedMatch = oracleText.match(
    /whenever a mountain an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentMountainBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_mountain_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, opponentMountainBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_mountain_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerLandTypesTapMatch = oracleText.match(
    /whenever a player taps a (?:Mountain|Forest|Plains)(?:, (?:a )?(?:Mountain|Forest|Plains))*(?:, or (?:a )?(?:Mountain|Forest|Plains))? for mana,?\s*([^.]+)/i,
  );
  if (playerLandTypesTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_land_types_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerLandTypesTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_land_types_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerNonbasicLandTapMatch = oracleText.match(
    /whenever a player taps a nonbasic land for mana,?\s*([^.]+)/i,
  );
  if (playerNonbasicLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_nonbasic_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerNonbasicLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_nonbasic_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerPermanentTapForManaMatch = oracleText.match(
    /whenever a player taps a permanent for mana,?\s*([^.]+)/i,
  );
  if (playerPermanentTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'player_permanent_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, playerPermanentTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_permanent_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentChosenLandTypeTapMatch = oracleText.match(
    /whenever a land of the chosen type an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentChosenLandTypeTapMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_chosen_land_type_tap')) {
    const effectText = timingTriggerEffect(oracleText, opponentChosenLandTypeTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_chosen_land_type_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactTappedOrAbilityMatch = oracleText.match(
    /whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without \{T\} in its activation cost,?\s*([^.]+)/i,
  );
  if (
    artifactTappedOrAbilityMatch &&
    !triggers.some((t) => (t as any).affectedType === 'opponent_artifact_tapped_or_ability')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactTappedOrAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_artifact_tapped_or_ability',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentForestTapMatch = oracleText.match(
    /whenever a forest an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentForestTapMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_forest_tap')) {
    const effectText = timingTriggerEffect(oracleText, opponentForestTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_forest_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerSwampTapMatch = oracleText.match(/whenever a player taps a swamp for mana,?\s*([^.]+)/i);
  if (playerSwampTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_swamp_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerSwampTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_swamp_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerIslandTapMatch = oracleText.match(/whenever a player taps an island for mana,?\s*([^.]+)/i);
  if (playerIslandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_island_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerIslandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player taps an Island for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_island_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerSnowLandTapMatch = oracleText.match(/whenever a player taps a snow land for mana,?\s*([^.]+)/i);
  if (playerSnowLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_snow_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerSnowLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_snow_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerLandTapMatch = oracleText.match(/whenever a player taps a land for mana,?\s*([^.]+)/i);
  if (playerLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player taps a land for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedLandManaTapMatch = oracleText.match(/whenever enchanted land is tapped for mana,?\s*([^.]+)/i);
  if (enchantedLandManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'enchanted_land_mana')) {
    const effectText = timingTriggerEffect(oracleText, enchantedLandManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted land is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_land_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedLandTapMatch = oracleText.match(/when(?:ever)? enchanted land becomes tapped,?\s*([^.]+)/i);
  if (enchantedLandTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_land')) {
    const effectText = timingTriggerEffect(oracleText, enchantedLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureTapMatch = oracleText.match(/whenever (?:a|another) creature becomes tapped,?\s*([^.]+)/i);
  if (
    anyCreatureTapMatch &&
    !lowerOracle.includes('creature you control becomes tapped') &&
    !triggers.some((t) => t.affectedType === 'any_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'any_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const forestManaTapMatch = oracleText.match(/whenever a forest is tapped for mana,?\s*([^.]+)/i);
  if (forestManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'forest_mana')) {
    const effectText = timingTriggerEffect(oracleText, forestManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a Forest is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'forest_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedForestManaTapMatch = oracleText.match(/whenever enchanted forest is tapped for mana,?\s*([^.]+)/i);
  if (enchantedForestManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'enchanted_forest_mana')) {
    const effectText = timingTriggerEffect(oracleText, enchantedForestManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted Forest is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_forest_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exiledNameLandTappedForManaMatch = oracleText.match(
    /whenever a land with the same name as the exiled card is tapped for mana,?\s*([^.]+)/i,
  );
  if (exiledNameLandTappedForManaMatch && !triggers.some((t) => (t as any).affectedType === 'exiled_name_land_tapped_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, exiledNameLandTappedForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'exiled_name_land_tapped_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const basicLandTappedForManaMatch = oracleText.match(
    /whenever (?:a|an) basic land is tapped for mana(?: of the chosen color)?,?\s*([^.]+)/i,
  );
  if (basicLandTappedForManaMatch && !triggers.some((t) => (t as any).affectedType === 'basic_land_tapped_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, basicLandTappedForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'basic_land_tapped_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landManaAbilityTapMatch = oracleText.match(
    /whenever (?:a|an) (?:basic )?land(?:'s)? ability causes you to add(?: one or more)? mana(?: of the chosen color)?,?\s*([^.]+)/i,
  );
  if (landManaAbilityTapMatch && !triggers.some((t) => (t as any).affectedType === 'land_mana_ability')) {
    const effectText = timingTriggerEffect(oracleText, landManaAbilityTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'land_mana_ability',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const fortifiedLandTapMatch = oracleText.match(/whenever fortified land becomes tapped,?\s*([^.]+)/i);
  if (fortifiedLandTapMatch && !triggers.some((t) => t.affectedType === 'fortified_land')) {
    const effectText = timingTriggerEffect(oracleText, fortifiedLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever fortified land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'fortified_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentTapMatch = oracleText.match(/whenever a permanent becomes tapped,?\s*([^.]+)/i);
  if (anyPermanentTapMatch && !triggers.some((t) => (t as any).affectedType === 'any_permanent_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'any_permanent_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedPermanentTapMatch = oracleText.match(/when(?:ever)? enchanted permanent becomes tapped,?\s*([^.]+)/i);
  if (enchantedPermanentTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_permanent')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPermanentTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted permanent becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_permanent',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedArtifactTapMatch = oracleText.match(/when(?:ever)? enchanted artifact becomes tapped,?\s*([^.]+)/i);
  if (enchantedArtifactTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_artifact')) {
    const effectText = timingTriggerEffect(oracleText, enchantedArtifactTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted artifact becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_artifact',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedTapMatch = oracleText.match(/whenever enchanted creature becomes tapped,?\s*([^.]+)/i);
  if (enchantedTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_creature')) {
    const effectText = timingTriggerEffect(oracleText, enchantedTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "Whenever a creature you control becomes tapped" (generic creature tap)
  if (lowerOracle.includes('whenever a creature you control becomes tapped') && 
      !triggers.some(t => t.affectedType === 'creature')) {
    const effectMatch = oracleText.match(/whenever a creature you control becomes tapped,?\s*([^.]+)/i);
    if (effectMatch) {
      const effectText = timingTriggerEffect(oracleText, effectMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever a creature you control becomes tapped, ${effectText}`,
        effect: effectText,
        triggerCondition: 'becomes_tapped',
        affectedType: 'creature',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }
  
  // "Whenever you tap a [TYPE] for mana" pattern (like Elvish Archdruid's friends)
  const tapForManaMatch = oracleText.match(/whenever you tap (?:a |an )?(\w+) for mana,?\s*([^.]+)/i);
  if (tapForManaMatch) {
    const tribalType = tapForManaMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tapForManaMatch, 2);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you tap a ${tribalType} for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'taps_for_mana',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: true,
    });
  }

  const permanentUntapMatch = oracleText.match(/whenever a permanent becomes untapped,?\s*([^.]+)/i);
  if (permanentUntapMatch && !triggers.some((t) => t.triggerCondition === 'becomes_untapped' && t.affectedType === 'any')) {
    const effectText = timingTriggerEffect(oracleText, permanentUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a permanent becomes untapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_untapped',
      affectedType: 'any',
      mandatory: !isOptionalTapTriggerEffect(effectText),
    });
  }

  const selfUntapMatch = oracleText.match(/whenever (?:~|this permanent|this creature|this artifact) becomes untapped,?\s*([^.]+)/i);
  if (selfUntapMatch && !triggers.some((t) => t.triggerCondition === 'becomes_untapped' && t.affectedType === 'self')) {
    const effectText = timingTriggerEffect(oracleText, selfUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever ${cardName} becomes untapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_untapped',
      affectedType: 'self',
      mandatory: !isOptionalTapTriggerEffect(effectText),
    });
  }

  return applyFirstTimeEachTurnFlags(triggers, annotated);
}
