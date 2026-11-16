// server/src/state/modules/staticEffectSpec-handlers/batch108LongTailStatics.ts
// B108 long-tail static specs. Public: parseBatch108LongTailStaticKind,
// pushBatch108LongTailStaticSpecs, BATCH108_LAYER4_SPECS.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated,
  parseAllBasicLandTypeAreNNColorCreaturesStillLands,
  parseAllCreaturesWithFlyingAbleToBlockThisDoSo,
  parseAsLongAsThisIsACreatureItHasProwess,
  parseCanOnlyAttackAlone,
  parseCantAttackOrBlockUnlessNPlusCounters,
  parseCantBeBlockedExceptByLegendaryCreatures,
  parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked,
  parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink,
  parseEachTypalCreatureCardInYourGraveyardHasUnearth,
  parseEnchantedCantBeBlockedAsLongAsAttackingAlone,
  parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands,
  parseGetsPTAsLongAsNCreaturesAreBlockingIt,
  parseGetsPTAsLongAsTopLibraryCardIsCreature,
  parseHasDoubleStrikeAsLongAsNEquipmentAttached,
  parseTypalCreaturesAttackEachCombatIfAble,
} from '../batch108Parsers.js';

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

export function parseBatch108LongTailStaticKind(oracle: string): string | null {
  if (parseGetsPTAsLongAsNCreaturesAreBlockingIt(oracle)) return 'blocked_by_n_pt';
  if (parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked(oracle)) return 'pt_cap_cant_be_blocked';
  if (parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink(oracle)) return 'your_turn_lifelink';
  if (parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands(oracle)) return 'forests_and_saprolings_animation';
  if (parseCantBeBlockedExceptByLegendaryCreatures(oracle)) return 'except_legendary';
  if (parseTypalCreaturesAttackEachCombatIfAble(oracle)) return 'typal_must_attack';
  if (parseHasDoubleStrikeAsLongAsNEquipmentAttached(oracle)) return 'double_strike_if_n_equipment';
  if (parseCanOnlyAttackAlone(oracle)) return 'can_only_attack_alone';
  if (parseEachTypalCreatureCardInYourGraveyardHasUnearth(oracle)) return 'gy_typal_unearth';
  if (parseEnchantedCantBeBlockedAsLongAsAttackingAlone(oracle)) return 'enchanted_attacking_alone_unblockable';
  if (parseAllBasicLandTypeAreNNColorCreaturesStillLands(oracle)) return 'basic_land_color_animation';
  if (parseAllCreaturesWithFlyingAbleToBlockThisDoSo(oracle)) return 'flying_must_block';
  if (parseGetsPTAsLongAsTopLibraryCardIsCreature(oracle)) return 'top_library_creature_pt';
  if (parseCantAttackOrBlockUnlessNPlusCounters(oracle)) return 'attack_block_unless_n_counters';
  if (parseAsLongAsThisIsACreatureItHasProwess(oracle)) return 'prowess_while_creature';
  if (parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated(oracle)) return 'chosen_permanent_no_activate';
  return null;
}

export function pushBatch108LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;
  const kind = parseBatch108LongTailStaticKind(text);
  if (!kind) return;
  specs.push(buildSpec(source, `batch108-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}

export const BATCH108_LAYER4_SPECS: Array<{ re: RegExp; build: (source: any) => any }> = [
  {
    re: /all forests and all saprolings are (\d+)\s*\/\s*(\d+) (white|blue|black|red|green) saproling creatures and forest lands in addition/i,
    build: (source) => {
      const m = String(source?.card?.oracle_text || source?.oracle_text || '')
        .replace(/\u2019/g, "'")
        .match(/all forests and all saprolings are (\d+)\s*\/\s*(\d+)/i);
      const power = Number(m?.[1] || 1);
      const toughness = Number(m?.[2] || 1);
      return {
        addTypes: ['Creature', 'Land', 'Forest', 'Saproling'],
        basePT: () => ({ power, toughness }),
        appliesTo: (perm: any) => {
          const tl = typeLineOf(perm);
          return /\bforest\b/.test(tl) || /\bsaproling\b/.test(tl);
        },
      };
    },
  },
  {
    re: /all (plains|islands|swamps|mountains|forests) are (\d+)\s*\/\s*(\d+) (white|blue|black|red|green) creatures that are still lands/i,
    build: (source) => {
      const m = String(source?.card?.oracle_text || source?.oracle_text || '')
        .replace(/\u2019/g, "'")
        .match(/all (plains|islands|swamps|mountains|forests) are (\d+)\s*\/\s*(\d+)/i);
      const raw = String(m?.[1] || 'swamps').toLowerCase();
      const sub = raw === 'plains' ? 'plains' : raw.slice(0, -1);
      const power = Number(m?.[2] || 1);
      const toughness = Number(m?.[3] || 1);
      const re = new RegExp('\\b' + sub + '\\b');
      return {
        addTypes: ['Creature'],
        basePT: () => ({ power, toughness }),
        appliesTo: (perm: any) => re.test(typeLineOf(perm)),
      };
    },
  },
];
