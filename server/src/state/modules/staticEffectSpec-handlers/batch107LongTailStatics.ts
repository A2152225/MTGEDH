// server/src/state/modules/staticEffectSpec-handlers/batch107LongTailStatics.ts
// B107 long-tail static specs. Public: parseBatch107LongTailStaticKind, pushBatch107LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseMagnetCounterAlsoAttackIfAble,
  parseEquipmentYouControlHaveEquipTypalCost,
  parseVehicleCreaturesYouControlAreChosenType,
  parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT,
  parsePowerEqualToTappedLandsChosenPlayerControls,
  parseEnchantedCantBeBlockedExceptByArtifactAndOrColor,
  parseDuringTurnsOtherThanYoursThisIsArtifactCreature,
  parseRenownedHasMenace,
  parseSlumberCounterIsLandNotCreature,
  parseEnchantedAttackingAloneCantBeBlocked,
  parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed,
  parseAllTypalAreColorless,
  parseGetsPTAsLongAsItIsntAttackingOrBlocking,
  parseCounterGateUntapCreaturesDuringOthersUntap,
  parseHasBushidoXEqualToAttackingCreatures,
  parseOpponentsCreaturesAttackEachCombatIfAble,
  parseGetsPTIfLessonInGraveyard,
  parseExiledWithThisCountGetsPTAndHexproof,
  parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble,
  parseVehiclesYouControlGetPTAsLongAsCreature,
  parseYourMaximumHandSizeIsTwenty,
  parseLandsYouControlAreNNCreaturesWithKeywordStillLands,
  parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy,
} from '../batch107Parsers.js';

export function parseBatch107LongTailStaticKind(oracle: string): string | null {
  if (parseMagnetCounterAlsoAttackIfAble(oracle)) return 'magnet_also_attack';
  if (parseEquipmentYouControlHaveEquipTypalCost(oracle)) return 'equip_typal_grant';
  if (parseVehicleCreaturesYouControlAreChosenType(oracle)) return 'vehicle_chosen_type';
  if (parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT(oracle)) return 'chosen_type_lord';
  if (parsePowerEqualToTappedLandsChosenPlayerControls(oracle)) return 'cda_tapped_lands_chosen';
  if (parseEnchantedCantBeBlockedExceptByArtifactAndOrColor(oracle)) return 'enchanted_block_except_artifact_or_color';
  if (parseDuringTurnsOtherThanYoursThisIsArtifactCreature(oracle)) return 'off_turn_artifact_creature';
  if (parseRenownedHasMenace(oracle)) return 'renowned_menace';
  if (parseSlumberCounterIsLandNotCreature(oracle)) return 'slumber_is_land';
  if (parseEnchantedAttackingAloneCantBeBlocked(oracle)) return 'enchanted_alone_unblockable';
  if (parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed(oracle)) return 'chosen_names_cant_cast_or_play';
  if (parseAllTypalAreColorless(oracle)) return 'typal_colorless';
  if (parseGetsPTAsLongAsItIsntAttackingOrBlocking(oracle)) return 'pt_if_not_attacking_or_blocking';
  if (parseCounterGateUntapCreaturesDuringOthersUntap(oracle)) return 'counter_gate_other_untap';
  if (parseHasBushidoXEqualToAttackingCreatures(oracle)) return 'bushido_x_attackers';
  if (parseOpponentsCreaturesAttackEachCombatIfAble(oracle)) return 'opponents_must_attack';
  if (parseGetsPTIfLessonInGraveyard(oracle)) return 'pt_if_lesson_in_gy';
  if (parseExiledWithThisCountGetsPTAndHexproof(oracle)) return 'exiled_with_pt_hexproof';
  if (parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble(oracle)) return 'enchanted_player_must_attack';
  if (parseVehiclesYouControlGetPTAsLongAsCreature(oracle)) return 'vehicle_creature_pt';
  if (parseYourMaximumHandSizeIsTwenty(oracle)) return 'hand_size_twenty';
  if (parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracle)) return 'lands_you_control_nn_keyword';
  if (parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy(oracle)) return 'cda_plus_color_creatures_chosen_gy';
  return null;
}

export function pushBatch107LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;
  const kind = parseBatch107LongTailStaticKind(text);
  if (!kind) return;

  if (parsePowerEqualToTappedLandsChosenPlayerControls(text)
    || parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy(text)) {
    specs.push(buildSpec(source, 'batch107-cda', { kind: 'self' }, { abilities: ['variable_pt_cda'] } as any));
  }

  const typalEquip = parseEquipmentYouControlHaveEquipTypalCost(text);
  if (typalEquip) {
    specs.push(buildSpec(source, 'equip-typal-grant', { kind: 'self' }, {
      abilities: [`equip_typal_${typalEquip.typal.toLowerCase()}`],
    } as any));
  }

  const chosenLord = parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT(text);
  if (chosenLord) {
    specs.push(buildSpec(source, 'chosen-type-lord', { kind: 'creatures_you_control' }, {
      power: chosenLord.power,
      toughness: chosenLord.toughness,
    }));
  }

  if (parseVehicleCreaturesYouControlAreChosenType(text)) {
    specs.push(buildSpec(source, 'vehicle-chosen-type', { kind: 'self' }, { abilities: ['vehicle_chosen_type'] } as any));
  }

  const notCombatPt = parseGetsPTAsLongAsItIsntAttackingOrBlocking(text);
  if (notCombatPt) {
    specs.push(buildSpec(source, 'pt-if-not-attacking-or-blocking', { kind: 'self' }, {
      power: notCombatPt.power,
      toughness: notCombatPt.toughness,
    }));
  }

  const lessonPt = parseGetsPTIfLessonInGraveyard(text);
  if (lessonPt) {
    specs.push(buildSpec(source, 'pt-if-lesson-in-gy', { kind: 'self' }, {
      power: lessonPt.power,
      toughness: lessonPt.toughness,
    }));
  }

  const exiledPt = parseExiledWithThisCountGetsPTAndHexproof(text);
  if (exiledPt) {
    specs.push(buildSpec(source, 'exiled-with-pt-hexproof', { kind: 'self' }, {
      power: exiledPt.power,
      toughness: exiledPt.toughness,
      abilities: ['hexproof'],
    }));
  }

  const vehiclePt = parseVehiclesYouControlGetPTAsLongAsCreature(text);
  if (vehiclePt) {
    specs.push(buildSpec(source, 'vehicle-creature-pt', { kind: 'self' }, {
      power: vehiclePt.power,
      toughness: vehiclePt.toughness,
    }));
  }

  const landsAnim = parseLandsYouControlAreNNCreaturesWithKeywordStillLands(text);
  if (landsAnim) {
    specs.push(buildSpec(source, 'lands-you-control-nn-keyword', { kind: 'lands_you_control' } as any, {
      power: landsAnim.power,
      toughness: landsAnim.toughness,
      abilities: [landsAnim.keyword],
    }));
  }

  if (parseMagnetCounterAlsoAttackIfAble(text)) {
    specs.push(buildSpec(source, 'magnet-also-attack', { kind: 'self' }, { abilities: ['magnet_also_attack'] } as any));
  }
  if (parseEnchantedCantBeBlockedExceptByArtifactAndOrColor(text)) {
    specs.push(buildSpec(source, 'enchanted-block-except-artifact-or-color', { kind: 'self' }, { abilities: ['block_restriction'] } as any));
  }
  if (parseDuringTurnsOtherThanYoursThisIsArtifactCreature(text)) {
    specs.push(buildSpec(source, 'off-turn-artifact-creature', { kind: 'self' }, { abilities: ['off_turn_creature'] } as any));
  }
  if (parseRenownedHasMenace(text)) {
    specs.push(buildSpec(source, 'renowned-menace', { kind: 'self' }, { abilities: ['menace'] }));
  }
  if (parseSlumberCounterIsLandNotCreature(text)) {
    specs.push(buildSpec(source, 'slumber-is-land', { kind: 'self' }, { abilities: ['slumber_is_land'] } as any));
  }
  if (parseEnchantedAttackingAloneCantBeBlocked(text)) {
    specs.push(buildSpec(source, 'enchanted-alone-unblockable', { kind: 'self' }, { abilities: ['unblockable_alone'] } as any));
  }
  if (parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed(text)) {
    specs.push(buildSpec(source, 'chosen-names-cant-cast-or-play', { kind: 'self' }, { abilities: ['chosen_name_lock'] } as any));
  }
  const typalColorless = parseAllTypalAreColorless(text);
  if (typalColorless) {
    specs.push(buildSpec(source, 'typal-colorless', { kind: 'self' }, { abilities: ['typal_colorless'] } as any));
  }
  if (parseCounterGateUntapCreaturesDuringOthersUntap(text)) {
    specs.push(buildSpec(source, 'counter-gate-other-untap', { kind: 'self' }, { abilities: ['other_player_untap'] } as any));
  }
  if (parseHasBushidoXEqualToAttackingCreatures(text)) {
    specs.push(buildSpec(source, 'bushido-x-attackers', { kind: 'self' }, { abilities: ['bushido_x'] } as any));
  }
  if (parseOpponentsCreaturesAttackEachCombatIfAble(text)) {
    specs.push(buildSpec(source, 'opponents-must-attack', { kind: 'self' }, { abilities: ['opponents_must_attack'] } as any));
  }
  if (parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble(text)) {
    specs.push(buildSpec(source, 'enchanted-player-must-attack', { kind: 'self' }, { abilities: ['enchanted_player_must_attack'] } as any));
  }
  if (parseYourMaximumHandSizeIsTwenty(text)) {
    specs.push(buildSpec(source, 'hand-size-twenty', { kind: 'player_you' } as any, { abilities: ['max_hand_size_twenty'] } as any));
  }

  if (!kind) return;
}
