/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers early pattern run
 * Public: appendEtbDetectionEarly
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { oracleTextHasDoThisOnlyOnceEachTurn, oracleTextHasTriggersOnlyOnceEachTurn } from "../triggerDoThisOnlyOnceEachTurn.js";
import { isSwallowedCompoundEnterEffect } from "./etb-detection-helpers.js";
import type { EtbDetectionState } from "./etb-detection-state.js";

export function appendEtbDetectionEarly(state: EtbDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    etbNameVariants,
    etbAlternatives,
  } = state;

  const putOntoBattlefieldThisWayMatch = oracleText.match(
    /when a creature is put onto the battlefield this way,?\s*([^.]+)/i,
  );
  if (putOntoBattlefieldThisWayMatch && !triggers.some((t) => t.triggerType === 'put_onto_battlefield_this_way')) {
    const effectText = timingTriggerEffect(oracleText, putOntoBattlefieldThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_onto_battlefield_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Nested delayed ETB from "put onto battlefield this way" (Masterpiece Vault):
  // "When an Equipment enters this way, attach it to ..."
  const equipmentEntersThisWayMatch = oracleText.match(
    /when(?:ever)? an? equipments? enters this way,?\s*([^.]+)/i,
  );
  if (equipmentEntersThisWayMatch && !triggers.some((t) => t.triggerType === 'equipment_etb' || t.triggerType === 'equipment_enters_this_way')) {
    const effectText = timingTriggerEffect(oracleText, equipmentEntersThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_enters_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: false,
    } as any);
  }

  const selfEntersOrLeavesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+enters or leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfEntersOrLeavesEtbMatch = oracleText.match(selfEntersOrLeavesPattern);
  if (selfEntersOrLeavesEtbMatch && !triggers.some((t) => t.triggerType === 'self_enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrLeavesEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrLeavesEtbMatch = oracleText.match(
    /whenever (?:a |an )?permanent enters or leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (entersOrLeavesEtbMatch && !triggers.some((t) => t.triggerType === 'enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, entersOrLeavesEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndOrOtherTypedEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+and\\/or\\s+one\\s+or\\s+more\\s+other\\s+([\\w]+(?:\\s+or\\s+[\\w]+)*)\\s+you\\s+control\\s+enter,?\\s*([^.]+)`,
    'i',
  );
  const namedAndOrOtherTypedEtbMatch = oracleText.match(namedAndOrOtherTypedEtbPattern);
  if (
    namedAndOrOtherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_or_other_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOrOtherTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_and_or_other_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherTypedEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+or\\s+another\\s+([\\w]+(?:\\s+or\\s+[\\w]+)*)(?:\\s+you\\s+control)?\\s+enters?(?: the battlefield)?(?:\\s+under your control)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherTypedEtbMatch = oracleText.match(namedOrAnotherTypedEtbPattern);
  if (
    namedOrAnotherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      requiredTypePhrase: String(namedOrAnotherTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const namedOrCreaturePowerOrLessEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another creature you control with power (\\d+) or less enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrCreaturePowerOrLessEtbMatch &&
    !lowerOracle.includes('nontoken creature you control with power') &&
    !triggers.some((t) => t.triggerType === 'named_or_creature_power_or_less_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrCreaturePowerOrLessEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_creature_power_or_less_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrNontokenCreaturePowerOrLessEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken creature you control with power (\\d+) or less enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenCreaturePowerOrLessEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_creature_power_or_less_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenCreaturePowerOrLessEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_creature_power_or_less_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const multiTypedCreatureEtbMatch = oracleText.match(
    /whenever a ([\w]+(?:, [\w]+)+, or [\w]+) you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (multiTypedCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'multi_typed_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, multiTypedCreatureEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisAttractionEtbMatch = oracleText.match(/when this attraction enters,?\s*([^.]+)/i);
  if (thisAttractionEtbMatch && !triggers.some((t) => t.triggerType === 'this_attraction_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisAttractionEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_attraction_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherSameNamedPermanentEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another permanent you control named (?:${etbNameVariants.join('|')}) enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherSameNamedPermanentEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_same_named_permanent_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherSameNamedPermanentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_same_named_permanent_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherNonTypeEtbMatch = oracleText.match(
    /whenever this creature or another non-([\w]+) creature you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNonTypeEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_non_type_creature_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNonTypeEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_non_type_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const toughnessGreaterThanPowerEtbMatch = oracleText.match(
    /whenever this creature or another creature you control with toughness greater than its power enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    toughnessGreaterThanPowerEtbMatch &&
    !triggers.some((t) => t.triggerType === 'toughness_greater_than_power_creature_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, toughnessGreaterThanPowerEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toughness_greater_than_power_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrNontokenHistoricEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken historic permanent you control enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenHistoricEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_historic_permanent_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenHistoricEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_historic_permanent_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const entersFromGraveyardMatch = oracleText.match(
    /whenever this creature or another creature enters from your graveyard,?\s*([^.]+)/i,
  );
  if (
    entersFromGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'creature_enters_from_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, entersFromGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_enters_from_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const permanentEntersFromGraveyardMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}|this creature|this permanent) or another permanent enters from a graveyard,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    permanentEntersFromGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_enters_from_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentEntersFromGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_enters_from_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactCreatureEnchantmentEntersMatch = oracleText.match(
    /whenever an artifact, creature, or enchantment enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    artifactCreatureEnchantmentEntersMatch &&
    !triggers.some((t) => t.triggerType === 'artifact_creature_or_enchantment_enters')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactCreatureEnchantmentEntersMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'artifact_creature_or_enchantment_enters',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cleanupStepSacrificeMatch = oracleText.match(
    /sacrifices? it at the beginning of the next cleanup step/i,
  );
  if (cleanupStepSacrificeMatch && !triggers.some((t) => t.triggerType === 'cleanup_step_sacrifice')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'cleanup_step_sacrifice',
      description: 'Sacrifice at the beginning of the next cleanup step',
      effect: 'Sacrifice at the beginning of the next cleanup step',
      mandatory: true,
    });
  }

  const thisPermanentEtbMatch = oracleText.match(/when(?:ever)? this permanent enters(?: the battlefield)?(?!\s+or\s+),?\s*([^.]+)/i);
  if (thisPermanentEtbMatch && !triggers.some((t) => t.triggerType === 'this_permanent_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisPermanentEtbMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_permanent_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const entersThisWayMatch = oracleText.match(/when it enters this way,?\s*([^.]+)/i);
  if (entersThisWayMatch && !triggers.some((t) => t.triggerType === 'enters_this_way')) {
    const effectText = timingTriggerEffect(oracleText, entersThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrCreaturePowerOrGreaterEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:~|this creature|(?:${etbNameVariants.join('|')})) or another creature(?: you control)? with power (\\d+) or greater enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrCreaturePowerOrGreaterEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_creature_power_or_greater_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrCreaturePowerOrGreaterEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_creature_power_or_greater_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const teamTypedEtbMatch = oracleText.match(
    /whenever this creature or another ([\w]+) your team controls enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (teamTypedEtbMatch && !triggers.some((t) => t.triggerType === 'team_typed_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, teamTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'team_typed_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedAndOrNontokenCreaturesEnterMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) and\\/or one or more other nontoken creatures you control enter,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndOrNontokenCreaturesEnterMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_or_nontoken_creatures_enter')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOrNontokenCreaturesEnterMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_and_or_nontoken_creatures_enter',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherNontokenTypedEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken ([\\w]+) you control enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherNontokenTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_nontoken_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherNontokenTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_nontoken_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: true,
      requiredTypePhrase: String(namedOrAnotherNontokenTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const thisOrAnotherTypedEtbAnyMatch = oracleText.match(
    /whenever this creature or another ([\w]+) enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedEtbAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_etb_any')
  ) {
    const tribalType = String(thisOrAnotherTypedEtbAnyMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedEtbAnyMatch, 2);
    if (effectText && !['creature', 'artifact', 'enchantment', 'permanent'].includes(tribalType)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_or_another_typed_etb_any',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiredTypePhrase: tribalType,
        doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
        oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
      } as any);
    }
  }

  const thisOrAnotherNontokenTypedEtbMatch = oracleText.match(
    /whenever this creature or another nontoken ([\w]+) you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: true,
      requiredTypePhrase: String(thisOrAnotherNontokenTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const thisOrAnotherArtifactEtbAnyMatch = oracleText.match(
    /whenever this artifact or another artifact enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherArtifactEtbAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_artifact_etb_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactEtbAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_etb_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisBossEtbMatch = oracleText.match(/when this boss enters,?\s*([^.]+)/i);
  if (thisBossEtbMatch && !triggers.some((t) => t.triggerType === 'this_boss_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisBossEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_boss_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const multiTypedControlledEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another ([\\w]+, [\\w]+, [\\w]+, or [\\w]+) enters the battlefield under your control,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    multiTypedControlledEtbMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_controlled_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedControlledEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_controlled_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const counterSpellPlayedMatch = oracleText.match(
    /whenever a player plays a spell that counters a spell that has been played or a player plays a spell that comes into play with counters,?\s*([^.]+)/i,
  );
  if (
    counterSpellPlayedMatch &&
    !triggers.some((t) => t.triggerType === 'counter_spell_played')
  ) {
    const effectText = timingTriggerEffect(oracleText, counterSpellPlayedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_spell_played',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "When this Equipment enters…" is already covered by ETB_STATIC_ALTERNATIVES
  // ("this equipment") → triggerType 'etb'. Do NOT also emit this_equipment_etb
  // or Living Weapon / Job Select / Midnight Angel Armor-style clauses double-fire
  // (G1: etb + this_equipment_etb both ran Oracle IR create+attach).
  // Keep detection commented for grep/historical reference only.
  // const thisEquipmentEtbMatch = oracleText.match(/when(?:ever)? this equipment enters(?: the battlefield)?,?\s*([^.]+)/i);

  const thisOrAnotherTypedEtbMatch = oracleText.match(
    /whenever this creature or another ([\w]+) you control(?: with (flying|reach|trample|haste|vigilance|deathtouch|lifelink|menace|hexproof|indestructible|defender))?\s+enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_etb')
  ) {
    const tribalType = String(thisOrAnotherTypedEtbMatch[1] || '').trim().toLowerCase();
    const requiredKeyword = String(thisOrAnotherTypedEtbMatch[2] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedEtbMatch, 3);
    if (
      effectText &&
      !['creature', 'artifact', 'enchantment', 'ally', 'permanent'].includes(tribalType)
    ) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_or_another_typed_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        controlledOnly: true,
        requiredTypePhrase: tribalType,
        ...(requiredKeyword ? { requiredKeyword } : {}),
        doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
        oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
      } as any);
    }
  }

  const thisOrAnotherAllyEtbMatch = oracleText.match(
    /whenever this creature or another ally you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherAllyEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_ally_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherAllyEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_ally_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisCreatureOrAnotherArtifactEtbMatch = oracleText.match(
    /whenever this (?:creature|permanent) or another artifact you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisCreatureOrAnotherArtifactEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_creature_or_another_artifact_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisCreatureOrAnotherArtifactEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_creature_or_another_artifact_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisEnchantmentOrAnotherNontokenEtbMatch = oracleText.match(
    /whenever this enchantment or another nontoken enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisEnchantmentOrAnotherNontokenEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_enchantment_or_another_nontoken_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisEnchantmentOrAnotherNontokenEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_enchantment_or_another_nontoken_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherArtifactEtbMatch = oracleText.match(
    /whenever this artifact or another artifact you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherArtifactEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_artifact_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherEnchantmentEtbMatch = oracleText.match(
    /whenever this enchantment or another enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherEnchantmentEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisCreatureOrAnotherEnchantmentEtbMatch = oracleText.match(
    /whenever this creature or another enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisCreatureOrAnotherEnchantmentEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_creature_or_another_enchantment_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisCreatureOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_creature_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const counterThresholdMatch = oracleText.match(
    /when there are (?:\w+|\d+) or more (\w+) counters on (?:this \w+),?\s*([^.]+)/i,
  );
  if (counterThresholdMatch && !triggers.some((t) => t.triggerType === 'counter_threshold')) {
    const effectText = timingTriggerEffect(oracleText, counterThresholdMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_threshold',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureEtbMatch = oracleText.match(
    /whenever this creature or another creature you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherCreatureEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+(?:[\\w\\s]+?\\s+)?creature(?:s)?\\s+you\\s+control\\s+enters?(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherCreatureEtbMatch = oracleText.match(namedOrAnotherCreatureEtbPattern);
  if (namedOrAnotherCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'named_or_another_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherCreatureEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherEnchantmentEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+or\\s+another\\s+enchantment(?:s)?\\s+you\\s+control\\s+enters?(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherEnchantmentEtbMatch = oracleText.match(namedOrAnotherEnchantmentEtbPattern);
  if (namedOrAnotherEnchantmentEtbMatch && !triggers.some((t) => t.triggerType === 'named_or_another_enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }
}
