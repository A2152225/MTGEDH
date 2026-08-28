/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectCombatDamageTriggers mid watcher patterns
 * Public: appendCombatDamageDetectionMid
 */

import { normalizeCreatureTypeWord } from "../../../../../shared/src/creatureTypes.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { CombatDamageDetectionState } from "./combat-damage-detection-state.js";

export function appendCombatDamageDetectionMid(state: CombatDamageDetectionState): void {
  const {
    triggers,
    oracleText,
    cardName,
    permanentId,
    combatNameVariants,
  } = state;

  const namedOrInstantSorceryDealsDamageMatch = oracleText.match(
    new RegExp(
      `whenever (?:${combatNameVariants.join('|')}) or an instant or sorcery spell you control deals damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrInstantSorceryDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_instant_sorcery_deals_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrInstantSorceryDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_instant_sorcery_deals_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonTypeCreaturesCombatDamageMatch = oracleText.match(
    /when(?:ever)? one or more non-([A-Za-z]+) creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  const nonTypePhrase = nonTypeCreaturesCombatDamageMatch
    ? normalizeCreatureTypeWord(String(nonTypeCreaturesCombatDamageMatch[1] || ''))
    : null;
  if (
    nonTypeCreaturesCombatDamageMatch &&
    nonTypePhrase &&
    !triggers.some((t) =>
      t.triggerType === 'non_human_creatures_combat_damage_to_player'
      || t.triggerType === 'non_type_creatures_combat_damage_to_player'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, nonTypeCreaturesCombatDamageMatch, 2);
    const trigger = {
      permanentId,
      cardName,
      triggerType: nonTypePhrase === 'human'
        ? 'non_human_creatures_combat_damage_to_player'
        : 'non_type_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    };
    (trigger as { requiredTypePhrase?: string }).requiredTypePhrase =
      String(nonTypeCreaturesCombatDamageMatch[1] || '').trim();
    triggers.push(trigger);
  }

  const creatureTokensCombatDamageMatch = oracleText.match(
    /when(?:ever)? one or more creature tokens you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    creatureTokensCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'creature_tokens_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureTokensCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_tokens_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const namedSelfCombatDamagePlayerOrBattleMatch = oracleText.match(
    new RegExp(
      `when (?:${combatNameVariants.join('|')}) deal(?:s)? combat damage to a player or battle,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedSelfCombatDamagePlayerOrBattleMatch &&
    !triggers.some((t) => t.triggerType === 'named_self_combat_damage_to_player_or_battle')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedSelfCombatDamagePlayerOrBattleMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_self_combat_damage_to_player_or_battle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchDealsDamageToPlayerOrPlaneswalkerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals damage to (?:a player|an opponent) or (?:a )?planeswalker,?\s*([^.]+)/i,
  );
  if (
    deathtouchDealsDamageToPlayerOrPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_player_or_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchDealsDamageToPlayerOrPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_deals_damage_to_player_or_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchDealsDamageToPlaneswalkerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals damage to a planeswalker,?\s*([^.]+)/i,
  );
  if (
    deathtouchDealsDamageToPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchDealsDamageToPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_deals_damage_to_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureDealsDamageFirstTimeEachTurnMatch = oracleText.match(
    /whenever a creature deals damage to one or more players for the first time each turn,?\s*([^.]+)/i,
  );
  if (
    creatureDealsDamageFirstTimeEachTurnMatch &&
    !triggers.some((t) => t.triggerType === 'creature_deals_damage_first_time_each_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureDealsDamageFirstTimeEachTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_deals_damage_first_time_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToCreatureMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals combat damage to a creature,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToCreatureMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_creature')
  ) {
    const typedSubject = String(typedCreatureCombatDamageToCreatureMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToCreatureMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'typed_creature_combat_damage_to_creature',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const redSourceDealsDamageMatch = oracleText.match(
    /whenever a red source you control deals damage to one or more permanents and\/or players,?\s*([^.]+)/i,
  );
  if (redSourceDealsDamageMatch && !triggers.some((t) => t.triggerType === 'red_source_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, redSourceDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'red_source_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfCombatDamageToDefendingPlayerMatch = oracleText.match(
    new RegExp(
      `whenever (?:~|this creature|(?:${combatNameVariants.join('|')})) deals combat damage to defending player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    selfCombatDamageToDefendingPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_combat_damage_to_defending_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageToDefendingPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_combat_damage_to_defending_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenSelfDealsDamageMatch = oracleText.match(
    new RegExp(`when (?:~|this creature|(?:${combatNameVariants.join('|')})) deals damage,?\\s*([^.]+)`, 'i'),
  );
  if (whenSelfDealsDamageMatch && !triggers.some((t) => t.triggerType === 'when_self_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, whenSelfDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'when_self_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const basePowerCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with base power (\d+) deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    basePowerCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'base_power_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, basePowerCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'base_power_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryEquipmentCombatDamageMatch = oracleText.match(
    /whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    legendaryEquipmentCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'legendary_equipment_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, legendaryEquipmentCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_equipment_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ninjasBossesCombatDamageMatch = oracleText.match(
    /whenever one or more Ninjas the bosses control deal combat damage to the heroes,?\s*([^.]+)/i,
  );
  if (
    ninjasBossesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'ninjas_bosses_combat_damage_to_heroes')
  ) {
    const effectText = timingTriggerEffect(oracleText, ninjasBossesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ninjas_bosses_combat_damage_to_heroes',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfCombatDamageToBlockingMatch = oracleText.match(
    /whenever this creature deals combat damage to one or more blocking creatures,?\s*([^.]+)/i,
  );
  if (
    selfCombatDamageToBlockingMatch &&
    !triggers.some((t) => t.triggerType === 'self_combat_damage_to_blocking_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageToBlockingMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_combat_damage_to_blocking_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toxicCreatureCombatDamageMatch = oracleText.match(
    /whenever a creature you control with toxic deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    toxicCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'toxic_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, toxicCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toxic_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enteredThisTurnCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control that entered this turn deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    enteredThisTurnCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'entered_this_turn_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, enteredThisTurnCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'entered_this_turn_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentControlsCombatDamageToYouMatch = oracleText.match(
    /whenever one or more creatures an opponent controls deal combat damage to you,?\s*([^.]+)/i,
  );
  if (
    opponentControlsCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_controls_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentControlsCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_controls_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCombatDamageToOpponentMatch = oracleText.match(
    /whenever an? ([A-Za-z]+) you control deals combat damage to an opponent,?\s*([^.]+)/i,
  );
  const typedOpponentPhrase = typedCombatDamageToOpponentMatch
    ? normalizeCreatureTypeWord(String(typedCombatDamageToOpponentMatch[1] || ''))
    : null;
  if (
    typedCombatDamageToOpponentMatch &&
    typedOpponentPhrase &&
    !triggers.some((t) =>
      t.triggerType === 'assassin_combat_damage_to_opponent'
      || t.triggerType === 'typed_creature_combat_damage_to_opponent'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCombatDamageToOpponentMatch, 2);
    const trigger = {
      permanentId,
      cardName,
      triggerType: typedOpponentPhrase === 'assassin'
        ? 'assassin_combat_damage_to_opponent'
        : 'typed_creature_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    };
    (trigger as { requiredTypePhrase?: string }).requiredTypePhrase =
      String(typedCombatDamageToOpponentMatch[1] || '').trim();
    triggers.push(trigger);
  }

  const selfOrEnchantedCombatDamageToPlayerMatch = oracleText.match(
    /whenever this creature or enchanted creature deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    selfOrEnchantedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_enchanted_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEnchantedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_enchanted_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingCreatureDealsDamageToYouMatch = oracleText.match(
    /whenever an attacking creature deals combat damage to you,?\s*([^.]+)/i,
  );
  if (
    attackingCreatureDealsDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'attacking_creature_deals_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackingCreatureDealsDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_creature_deals_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const instantSorceryTargetsSingleCreatureDealsDamageMatch = oracleText.match(
    /whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature,?\s*([^.]+)/i,
  );
  if (
    instantSorceryTargetsSingleCreatureDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'instant_sorcery_targets_single_creature_deals_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, instantSorceryTargetsSingleCreatureDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'instant_sorcery_targets_single_creature_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDealsCombatDamageToPlayerThisTurnMatch = oracleText.match(
    /whenever it deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    itDealsCombatDamageToPlayerThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'it_deals_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, itDealsCombatDamageToPlayerThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_deals_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const seaCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a Kraken, Leviathan, Octopus, or Serpent you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    seaCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'sea_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, seaCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'sea_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const instantSorcerySpellDealsDamageMatch = oracleText.match(
    /whenever an instant or sorcery spell you control deals damage,?\s*([^.]+)/i,
  );
  if (
    instantSorcerySpellDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'instant_sorcery_spell_deals_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, instantSorcerySpellDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'instant_sorcery_spell_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCombatDamageToCreatureMatch = oracleText.match(
    /whenever an? ([A-Za-z]+) deals combat damage to a creature,?\s*([^.]+)/i,
  );
  const typedCreaturePhrase = typedCombatDamageToCreatureMatch
    ? normalizeCreatureTypeWord(String(typedCombatDamageToCreatureMatch[1] || ''))
    : null;
  if (
    typedCombatDamageToCreatureMatch &&
    typedCreaturePhrase &&
    !triggers.some((t) =>
      t.triggerType === 'sliver_combat_damage_to_creature'
      || t.triggerType === 'typed_creature_combat_damage_to_creature'
    )
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCombatDamageToCreatureMatch, 2);
    const trigger = {
      permanentId,
      cardName,
      triggerType: typedCreaturePhrase === 'sliver'
        ? 'sliver_combat_damage_to_creature'
        : 'typed_creature_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    };
    (trigger as { requiredTypePhrase?: string }).requiredTypePhrase =
      String(typedCombatDamageToCreatureMatch[1] || '').trim();
    triggers.push(trigger);
  }

  const opponentCreaturesCombatDamageToOpponentsMatch = oracleText.match(
    /whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents,?\s*([^.]+)/i,
  );
  if (
    opponentCreaturesCombatDamageToOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_creatures_combat_damage_to_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreaturesCombatDamageToOpponentsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creatures_combat_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noncombatDamageToCreatureMatch = oracleText.match(
    /whenever a source you control deals noncombat damage to a creature,?\s*([^.]+)/i,
  );
  if (noncombatDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'noncombat_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, noncombatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noncombat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const powerAboveBaseCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control each with power greater than its base power deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    powerAboveBaseCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'power_above_base_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, powerAboveBaseCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'power_above_base_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
}
