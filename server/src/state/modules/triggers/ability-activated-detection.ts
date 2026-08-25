/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectAbilityActivatedTriggers
 * Public: detectAbilityActivatedTriggers
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";

export function detectAbilityActivatedTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  // Planechase phenomena/planes: "Whenever you planeswalk here, ..."
  const planeswalkHereMatch = oracleText.match(
    /whenever you planeswalk here,?\s*([^.]+)/i,
  );
  if (planeswalkHereMatch && !triggers.some((t) => t.triggerType === 'planeswalk_here')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkHereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalk_here',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exhaustNextMatch = oracleText.match(
    /when you next activate an exhaust ability(?: that isn't a mana ability)?(?: this turn)?,?\s*([^.]+)/i,
  );
  if (exhaustNextMatch) {
    const effectText = timingTriggerEffect(oracleText, exhaustNextMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exhaust_ability_next',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedExploitMatch = oracleText.match(
    new RegExp(
      `when (?:${buildCardNameRegexAlternatives(cardName).join('|')}) exploits a creature,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (namedExploitMatch && !triggers.some((t) => t.triggerType === 'named_exploit')) {
    const effectText = timingTriggerEffect(oracleText, namedExploitMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_exploit',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exploitMatch = oracleText.match(/when this creature exploits a creature,?\s*([^.]+)/i);
  if (exploitMatch) {
    const effectText = timingTriggerEffect(oracleText, exploitMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exploit',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactAbilityMatch = oracleText.match(
    /whenever an opponent activates an ability of an artifact they control,?\s*([^.]+)/i,
  );
  if (
    opponentArtifactAbilityMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_artifact_ability_activated')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_artifact_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAbilityMatch = oracleText.match(
    /whenever an opponent activates an ability(?: of [^.]+?)?(?:,?\s*(?:if )?(?:it|that) isn'?t a mana ability),?\s*([^.]+)/i,
  );
  if (opponentAbilityMatch && !triggers.some((t) => t.triggerType === 'opponent_artifact_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, opponentAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const winCoinFlipMatch = oracleText.match(/whenever you win a coin flip,?\s*([^.]+)/i);
  if (winCoinFlipMatch && !triggers.some((t) => t.triggerType === 'win_coin_flip')) {
    const effectText = timingTriggerEffect(oracleText, winCoinFlipMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'win_coin_flip',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollThresholdMatch = oracleText.match(/whenever you roll a (\d+) or higher on a die,?\s*([^.]+)/i);
  if (dieRollThresholdMatch && !triggers.some((t) => t.triggerType === 'die_roll_threshold')) {
    const effectText = timingTriggerEffect(oracleText, dieRollThresholdMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_threshold',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const beginningOfGameMatch = oracleText.match(/at the beginning of the game,?\s*([^.]+)/i);
  if (beginningOfGameMatch && !triggers.some((t) => t.triggerType === 'beginning_of_game')) {
    const effectText = timingTriggerEffect(oracleText, beginningOfGameMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'beginning_of_game',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const planarDieMatch = oracleText.match(/whenever you roll the planar die,?\s*([^.]+)/i);
  if (planarDieMatch && !triggers.some((t) => t.triggerType === 'planar_die_roll')) {
    const effectText = timingTriggerEffect(oracleText, planarDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planar_die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exhaustActivatedMatch = oracleText.match(/whenever you activate an exhaust ability,?\s*([^.]+)/i);
  if (exhaustActivatedMatch && !triggers.some((t) => t.triggerType === 'exhaust_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, exhaustActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exhaust_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonManaAbilityActivatedMatch = oracleText.match(
    /whenever you activate an ability that isn't a mana ability,?\s*([^.]+)/i,
  );
  if (nonManaAbilityActivatedMatch && !triggers.some((t) => t.triggerType === 'non_mana_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, nonManaAbilityActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'non_mana_ability_activated',
      description: effectText,
      effect: effectText,
      // Optional pay-again / copy templates are always may-abilities.
      mandatory: false,
    });
  }

  const namedEncounterMatch = oracleText.match(/when you encounter ([^,]+),?\s*([^.]+)/i);
  if (namedEncounterMatch && !triggers.some((t) => t.triggerType === 'named_encounter')) {
    const effectText = timingTriggerEffect(oracleText, namedEncounterMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_encounter',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollSingleResultMatch = oracleText.match(/whenever you roll a (\d+)(?! or \d),?\s*([^.]+)/i);
  if (
    dieRollSingleResultMatch &&
    !triggers.some((t) => t.triggerType === 'die_roll_single_result')
  ) {
    const effectText = timingTriggerEffect(oracleText, dieRollSingleResultMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_single_result',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sixSidedDieRollMatch = oracleText.match(
    /whenever a (\d+) is rolled on a six-sided die,?\s*([^.]+)/i,
  );
  if (sixSidedDieRollMatch && !triggers.some((t) => t.triggerType === 'six_sided_die_roll')) {
    const effectText = timingTriggerEffect(oracleText, sixSidedDieRollMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'six_sided_die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noCreaturesOnBattlefieldMatch = oracleText.match(
    /when there are no creatures on the battlefield,?\s*([^.]+)/i,
  );
  if (
    noCreaturesOnBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'no_creatures_on_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, noCreaturesOnBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'no_creatures_on_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollResultMatch = oracleText.match(/whenever you roll a (\d+) or (\d+),?\s*([^.]+)/i);
  if (dieRollResultMatch) {
    const effectText = timingTriggerEffect(oracleText, dieRollResultMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_result',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const foretellMatch = oracleText.match(/whenever you foretell a card,?\s*([^.]+)/i);
  if (foretellMatch) {
    const effectText = timingTriggerEffect(oracleText, foretellMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'foretell',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const boastMatch = oracleText.match(/whenever you activate a boast ability,?\s*([^.]+)/i);
  if (boastMatch) {
    const effectText = timingTriggerEffect(oracleText, boastMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'boast_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crankMatch = oracleText.match(/whenever you crank(?: this contraption)?,?\s*([^.]+)/i);
  if (crankMatch && !triggers.some((t) => t.triggerType === 'crank_contraption')) {
    const effectText = timingTriggerEffect(oracleText, crankMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'crank_contraption',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crewedMatch = oracleText.match(/whenever this vehicle becomes crewed(?: for the first time each turn)?,?\s*([^.]+)/i);
  if (crewedMatch) {
    const effectText = timingTriggerEffect(oracleText, crewedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vehicle_crewed',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const saddledMatch = oracleText.match(/whenever this creature becomes saddled(?: for the first time each turn)?,?\s*([^.]+)/i);
  if (saddledMatch && !triggers.some((t) => t.triggerType === 'creature_saddled')) {
    const effectText = timingTriggerEffect(oracleText, saddledMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_saddled',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollMatch = oracleText.match(/whenever you roll a die,?\s*([^.]+)/i);
  if (dieRollMatch) {
    const effectText = timingTriggerEffect(oracleText, dieRollMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rollDiceMatch = oracleText.match(/whenever you roll one or more (?:dice|die),?\s*([^.]+)/i);
  if (rollDiceMatch && !triggers.some((t) => t.triggerType === 'roll_one_or_more_dice')) {
    const effectText = timingTriggerEffect(oracleText, rollDiceMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'roll_one_or_more_dice',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exertCreatureMatch = oracleText.match(/whenever you exert a creature,?\s*([^.]+)/i);
  if (exertCreatureMatch && !triggers.some((t) => t.triggerType === 'exert_creature')) {
    const effectText = timingTriggerEffect(oracleText, exertCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exert_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const payCostMatch = oracleText.match(/when you pay this cost one or more times,?\s*([^.]+)/i);
  if (payCostMatch && !triggers.some((t) => t.triggerType === 'pay_cost_one_or_more_times')) {
    const effectText = timingTriggerEffect(oracleText, payCostMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'pay_cost_one_or_more_times',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringTemptsMatch = oracleText.match(/whenever the ring tempts you,?\s*([^.]+)/i);
  if (ringTemptsMatch && !triggers.some((t) => t.triggerType === 'ring_tempts_you')) {
    const effectText = timingTriggerEffect(oracleText, ringTemptsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ring_tempts_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const encounterPhenomenonMatch = oracleText.match(/when(?:ever) you encounter this phenomenon,?\s*([^.]+)/i);
  if (encounterPhenomenonMatch && !triggers.some((t) => t.triggerType === 'encounter_phenomenon')) {
    const effectText = timingTriggerEffect(oracleText, encounterPhenomenonMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'encounter_phenomenon',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exploresMatch = oracleText.match(/whenever a creature you control explores,?\s*([^.]+)/i);
  if (exploresMatch && !triggers.some((t) => t.triggerType === 'creature_explores')) {
    const effectText = timingTriggerEffect(oracleText, exploresMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_explores',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const expendMatch = oracleText.match(/whenever you expend(?: \d+)?,?\s*([^.]+)/i);
  if (expendMatch && !triggers.some((t) => t.triggerType === 'expend')) {
    const effectText = timingTriggerEffect(oracleText, expendMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'expend',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const shuffleLibraryMatch = oracleText.match(
    /whenever a spell or ability causes (?:its controller|you|a player) to shuffle (?:their|your) library,?\s*([^.]+)/i,
  );
  if (shuffleLibraryMatch) {
    const effectText = timingTriggerEffect(oracleText, shuffleLibraryMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'library_shuffled',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rateArtMatch = oracleText.match(/when they rate the art,?\s*([^.]+)/i);
  if (rateArtMatch) {
    const effectText = timingTriggerEffect(oracleText, rateArtMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rate_art',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dayNightMatch = oracleText.match(/whenever day becomes night or night becomes day,?\s*([^.]+)/i);
  if (dayNightMatch && !triggers.some((t) => t.triggerType === 'day_night')) {
    const effectText = timingTriggerEffect(oracleText, dayNightMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'day_night',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chaosEnsuesMatch = oracleText.match(/whenever chaos ensues,?\s*([^.]+)/i);
  if (chaosEnsuesMatch && !triggers.some((t) => t.triggerType === 'chaos_ensues')) {
    const effectText = timingTriggerEffect(oracleText, chaosEnsuesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chaos_ensues',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedAbilityActivatedMatch = oracleText.match(
    /whenever an ability of equipped creature is activated,?\s*(?:if it isn't a mana ability,?\s*)?([^.]+)/i,
  );
  if (equippedAbilityActivatedMatch && !triggers.some((t) => t.triggerType === 'equipped_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, equippedAbilityActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const becomeMonarchMatch = oracleText.match(/whenever you become the monarch,?\s*([^.]+)/i);
  if (becomeMonarchMatch && !triggers.some((t) => t.triggerType === 'become_monarch')) {
    const effectText = timingTriggerEffect(oracleText, becomeMonarchMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'become_monarch',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const emptyHandMatch = oracleText.match(/whenever you have no cards in hand,?\s*([^.]+)/i);
  if (emptyHandMatch && !triggers.some((t) => t.triggerType === 'empty_hand')) {
    const effectText = timingTriggerEffect(oracleText, emptyHandMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'empty_hand',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const schemeInMotionMatch = oracleText.match(/when you set this scheme in motion,?\s*([^.]+)/i);
  if (schemeInMotionMatch && !triggers.some((t) => t.triggerType === 'scheme_in_motion')) {
    const effectText = timingTriggerEffect(oracleText, schemeInMotionMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'scheme_in_motion',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPayManaMatch = oracleText.match(/whenever you pay (\{[^}]+\}(?:\{[^}]+\})*),?\s*([^.]+)/i);
  if (youPayManaMatch && !triggers.some((t) => t.triggerType === 'you_pay_mana')) {
    const effectText = timingTriggerEffect(oracleText, youPayManaMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_pay_mana',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const saddleOrCrewMatch = oracleText.match(
    /whenever (?:~|this creature) saddles a mount or crews a vehicle during your main phase,?\s*([^.]+)/i,
  );
  if (saddleOrCrewMatch && !triggers.some((t) => t.triggerType === 'saddle_or_crew')) {
    const effectText = timingTriggerEffect(oracleText, saddleOrCrewMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'saddle_or_crew',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crewVehicleMatch = oracleText.match(/when(?:ever)? (?:~|this creature) crews a vehicle,?\s*([^.]+)/i);
  if (crewVehicleMatch && !triggers.some((t) => t.triggerType === 'crew_vehicle')) {
    const effectText = timingTriggerEffect(oracleText, crewVehicleMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'crew_vehicle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const finishVotingMatch = oracleText.match(/whenever players finish voting,?\s*([^.]+)/i);
  if (finishVotingMatch && !triggers.some((t) => t.triggerType === 'finish_voting')) {
    const effectText = timingTriggerEffect(oracleText, finishVotingMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'finish_voting',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loyaltyAbilityPatterns = [
    /whenever you activate a loyalty ability of (?:a |an )?([\w]+) planeswalker,?\s*([^.]+)/gi,
    /whenever you activate a loyalty ability of enchanted planeswalker,?\s*([^.]+)/gi,
  ];
  for (const pattern of loyaltyAbilityPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText || triggers.some((t) => t.triggerType === 'loyalty_ability_activated' && t.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'loyalty_ability_activated',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const clashMatch = oracleText.match(/whenever you clash,?\s*([^.]+)/i);
  if (clashMatch && !triggers.some((t) => t.triggerType === 'clash')) {
    const effectText = timingTriggerEffect(oracleText, clashMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'clash',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const discoverMatch = oracleText.match(/whenever you discover,?\s*([^.]+)/i);
  if (discoverMatch && !triggers.some((t) => t.triggerType === 'discover')) {
    const effectText = timingTriggerEffect(oracleText, discoverMatch)
      .replace(/\s*This ability triggers only once each turn\.?/gi, '')
      .trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'discover',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      oncePerTurn: /this ability triggers only once each turn/i.test(oracleText),
    });
  }

  const equipmentUnattachedMatch = oracleText.match(
    /whenever this equipment becomes unattached from a permanent,?\s*([^.]+)/i,
  );
  if (equipmentUnattachedMatch && !triggers.some((t) => t.triggerType === 'equipment_unattached')) {
    const effectText = timingTriggerEffect(oracleText, equipmentUnattachedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_unattached',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const keywordActionPatterns: Array<{ pattern: RegExp; triggerType: string }> = [
    { pattern: /whenever you surveil,?\s*([^.]+)/gi, triggerType: 'surveil' },
    { pattern: /whenever you scry(?: \d+)?,?\s*([^.]+)/gi, triggerType: 'scry' },
    { pattern: /whenever you explore,?\s*([^.]+)/gi, triggerType: 'explore' },
    { pattern: /whenever you connive,?\s*([^.]+)/gi, triggerType: 'connive' },
    { pattern: /when(?:ever)? you proliferate,?\s*([^.]+)/gi, triggerType: 'proliferate' },
    { pattern: /when(?:ever)? you complete a dungeon,?\s*([^.]+)/gi, triggerType: 'complete_dungeon' },
    { pattern: /when(?:ever)? a player loses the game,?\s*([^.]+)/gi, triggerType: 'player_loses_game' },
    { pattern: /whenever you search your library,?\s*([^.]+)/gi, triggerType: 'search_library' },
    { pattern: /whenever an opponent searches their library,?\s*([^.]+)/gi, triggerType: 'opponent_search_library' },
    { pattern: /whenever an opponent shuffles their library,?\s*([^.]+)/gi, triggerType: 'opponent_shuffle_library' },
    { pattern: /whenever you shuffle your library,?\s*([^.]+)/gi, triggerType: 'shuffle_library' },
  ];
  for (const { pattern, triggerType } of keywordActionPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((t) => t.triggerType === triggerType && t.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

