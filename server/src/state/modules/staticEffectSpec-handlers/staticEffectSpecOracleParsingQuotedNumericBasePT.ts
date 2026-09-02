// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: quoted ability-have grants, city's blessing anthems, historic
//   during-your-turn keyword grants, characteristic-setting base P/T,
//   mana-ability creature anthems (live-seam static / attack leftovers).
// Public entry symbols: pushQuotedNumericAndBasePTLordSpecs.

import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  COLOR_WORDS,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const QUOTED_CREATURES_YOU_CONTROL_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?creatures you control have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_TYPED_CREATURES_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?([a-z]+) creatures you control have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_OTHER_TYPE_YOU_CONTROL_HAVE_RE =
  /(?:^|[.\n;])\s*other\s+([a-z]+)s?\s+you control have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_OTHER_CREATURES_HAVE_RE =
  /(?:^|[.\n;])\s*other creatures have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_OTHER_PERMANENT_TYPE_HAVE_RE =
  /(?:^|[.\n;])\s*other (enchantments?|artifacts?|permanents?) have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_ALL_TYPE_HAVE_RE =
  /(?:^|[.\n;])\s*all\s+([a-z]+)s?(?:\s+creatures?)?\s+have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_NON_TYPE_CREATURES_HAVE_RE =
  /(?:^|[.\n;])\s*non-([a-z]+) creatures have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_COMMANDER_YOU_OWN_HAVE_RE =
  /(?:^|[.\n;])\s*commander creatures you own have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_PERMANENTS_YOU_CONTROL_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?permanents you control have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_TRIBAL_YOU_CONTROL_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?([a-z]+)s?\s+you control have\s+["\u201C]([^"\u201D]+)["\u201D]/gi;
const QUOTED_CARD_TYPE_YOU_CONTROL_HAVE_RE =
  /\b(?:creatures?|permanents?|artifacts?|enchantments?|lands?|planeswalkers?)\s+you control have\b/i;
const CITYS_BLESSING_CARD_TYPE_GET_RE =
  /(?:^|[.\n;])\s*(other\s+)?(artifact|enchantment|land) creatures you control get\s+(\+\d+\s*\/\s*\+\d+)\s+as long as you have the city'?s blessing/gi;
const HISTORIC_DURING_TURN_HAVE_RE =
  /during your turn,?\s*(other\s+)?historic creatures you control have ([^.]+)/gi;
const BASE_PT_RE =
  /(?:^|[.\n;])\s*(other\s+)?creatures(?: you control)? have base power and toughness (\d+)\s*\/\s*(\d+)(?: and are ([a-z]+)s? in addition[^.]*)?/gi;
const MANA_ABILITY_ANTHEM_RE =
  /each creature you control with a mana ability gets\s+(\+\d+\s*\/\s*\+\d+)/gi;

function alreadyGrantsAbility(specs: readonly StaticEffectSpec[], ability: string): boolean {
  const key = String(ability || '').trim().toLowerCase();
  if (!key) return false;
  return specs.some((spec) => (
    Array.isArray(spec.grant.abilities)
    && spec.grant.abilities.some((entry) => String(entry || '').trim().toLowerCase() === key)
  ));
}

function pushAbilitySpec(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  idSuffix: string,
  scope: StaticEffectSpec['scope'],
  abilities: readonly string[],
  condition?: StaticEffectCondition,
  extraConditions?: readonly StaticEffectCondition[],
): void {
  const unique = [...new Set(abilities.map((ability) => String(ability || '').trim()).filter(Boolean))];
  if (unique.length === 0) return;
  if (unique.every((ability) => alreadyGrantsAbility(specs, ability))) return;
  const spec = buildSpec(source, idSuffix, scope, { abilities: unique }, condition);
  if (extraConditions && extraConditions.length > 0) {
    spec.conditions = extraConditions;
  }
  specs.push(spec);
}

function qualifierCondition(qualifier: string): StaticEffectCondition | undefined {
  const word = String(qualifier || '').trim().toLowerCase();
  if (!word) return undefined;
  if (word === 'historic') return { kind: 'target_is_historic' };
  if (word === 'nontoken') return { kind: 'target_is_not_token' };
  if (word === 'attacking') return { kind: 'target_is_attacking' };
  if (word === 'modified') return { kind: 'target_is_modified' };
  if (word === 'equipped') return { kind: 'target_is_equipped' };
  if (word === 'enchanted') return { kind: 'target_enchanted_by_aura_you_control' };
  if (word === 'colorless') return { kind: 'target_is_colorless' };
  if (word === 'multicolored') return { kind: 'target_is_multicolored' };
  if ((COLOR_WORDS as readonly string[]).includes(word)) {
    return { kind: 'target_has_mana_color', color: word };
  }
  if (word === 'artifact' || word === 'enchantment' || word === 'land') {
    return { kind: 'target_has_type', cardType: word };
  }
  return undefined;
}

export function pushQuotedNumericAndBasePTLordSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '');

  for (const match of text.matchAll(QUOTED_CREATURES_YOU_CONTROL_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    pushAbilitySpec(
      specs,
      source,
      `${isOther ? 'other-' : ''}creatures-quoted-ability-grant`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
      parseLordAbilitiesFromTail(`"${match[2] || ''}"`),
    );
  }

  for (const match of text.matchAll(QUOTED_TYPED_CREATURES_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const qualifier = String(match[2] || '').toLowerCase();
    const quoted = String(match[3] || '');
    const abilities = parseLordAbilitiesFromTail(`"${quoted}"`);
    const condition = qualifierCondition(qualifier);
    if (condition) {
      pushAbilitySpec(
        specs,
        source,
        `${isOther ? 'other-' : ''}${qualifier}-creatures-quoted-ability-grant`,
        { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
        abilities,
        condition,
      );
      continue;
    }
    const creatureType = parseLordCreatureType(qualifier);
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    pushAbilitySpec(
      specs,
      source,
      `${isOther ? 'other-' : ''}${creatureType}-creatures-quoted-ability-grant`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control', creatureType },
      abilities,
    );
  }

  for (const match of text.matchAll(QUOTED_OTHER_TYPE_YOU_CONTROL_HAVE_RE)) {
    if (/\bcreatures?\b/i.test(String(match[0] || ''))) continue;
    const rawType = String(match[1] || '').toLowerCase();
    const quoted = String(match[2] || '');
    const abilities = parseLordAbilitiesFromTail(`"${quoted}"`);
    const creatureType = parseLordCreatureType(rawType);
    if (creatureType && isCreatureTypeWord(creatureType)) {
      pushAbilitySpec(
        specs,
        source,
        `other-${creatureType}-quoted-ability-grant`,
        { kind: 'other_creatures_you_control', creatureType },
        abilities,
      );
      continue;
    }
    if (!rawType) continue;
    pushAbilitySpec(
      specs,
      source,
      `other-${rawType}-quoted-ability-grant`,
      { kind: 'other_permanents_you_control' },
      abilities,
      { kind: 'target_has_type', cardType: rawType },
    );
  }

  for (const match of text.matchAll(QUOTED_OTHER_CREATURES_HAVE_RE)) {
    pushAbilitySpec(
      specs,
      source,
      'other-all-creatures-quoted-ability-grant',
      { kind: 'other_all_creatures' },
      parseLordAbilitiesFromTail(`"${match[1] || ''}"`),
    );
  }

  for (const match of text.matchAll(QUOTED_OTHER_PERMANENT_TYPE_HAVE_RE)) {
    const cardType = String(match[1] || '').toLowerCase().replace(/s$/, '');
    pushAbilitySpec(
      specs,
      source,
      `other-all-${cardType}-quoted-ability-grant`,
      { kind: 'other_all_permanents' },
      parseLordAbilitiesFromTail(`"${match[2] || ''}"`),
      { kind: 'target_has_type', cardType },
    );
  }

  for (const match of text.matchAll(QUOTED_ALL_TYPE_HAVE_RE)) {
    const rawType = String(match[1] || '').toLowerCase().replace(/s$/, '');
    const quoted = String(match[2] || '');
    const abilities = parseLordAbilitiesFromTail(`"${quoted}"`);
    if (rawType === 'creature') {
      pushAbilitySpec(
        specs,
        source,
        'all-creatures-quoted-ability-grant',
        { kind: 'all_creatures' },
        abilities,
      );
      continue;
    }
    if (rawType === 'permanent') {
      pushAbilitySpec(
        specs,
        source,
        'all-permanents-quoted-ability-grant',
        { kind: 'all_permanents' },
        abilities,
      );
      continue;
    }
    if (rawType === 'artifact' || rawType === 'enchantment' || rawType === 'land') {
      pushAbilitySpec(
        specs,
        source,
        `all-${rawType}-quoted-ability-grant`,
        { kind: 'all_permanents' },
        abilities,
        { kind: 'target_has_type', cardType: rawType },
      );
      continue;
    }
    const creatureType = parseLordCreatureType(rawType);
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    pushAbilitySpec(
      specs,
      source,
      `all-${creatureType}-quoted-ability-grant`,
      { kind: 'all_creatures_of_type', creatureType },
      abilities,
    );
  }

  for (const match of text.matchAll(QUOTED_NON_TYPE_CREATURES_HAVE_RE)) {
    const creatureType = parseLordCreatureType(String(match[1] || ''));
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    pushAbilitySpec(
      specs,
      source,
      `non-${creatureType}-creatures-quoted-ability-grant`,
      { kind: 'all_creatures' },
      parseLordAbilitiesFromTail(`"${match[2] || ''}"`),
      { kind: 'target_lacks_creature_type', creatureType },
    );
  }

  for (const match of text.matchAll(QUOTED_COMMANDER_YOU_OWN_HAVE_RE)) {
    pushAbilitySpec(
      specs,
      source,
      'commander-you-own-quoted-ability-grant',
      { kind: 'all_creatures' },
      parseLordAbilitiesFromTail(`"${match[1] || ''}"`),
      { kind: 'target_is_commander' },
      [{ kind: 'target_owned_by_source_controller' }],
    );
  }

  for (const match of text.matchAll(QUOTED_PERMANENTS_YOU_CONTROL_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    pushAbilitySpec(
      specs,
      source,
      `${isOther ? 'other-' : ''}permanents-quoted-ability-grant`,
      { kind: isOther ? 'other_permanents_you_control' : 'permanents_you_control' },
      parseLordAbilitiesFromTail(`"${match[2] || ''}"`),
    );
  }

  for (const match of text.matchAll(QUOTED_TRIBAL_YOU_CONTROL_HAVE_RE)) {
    if (QUOTED_CARD_TYPE_YOU_CONTROL_HAVE_RE.test(String(match[0] || ''))) continue;
    const isOther = Boolean(match[1]);
    const creatureType = parseLordCreatureType(String(match[2] || ''));
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    pushAbilitySpec(
      specs,
      source,
      `${isOther ? 'other-' : ''}${creatureType}-quoted-ability-grant`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control', creatureType },
      parseLordAbilitiesFromTail(`"${match[3] || ''}"`),
    );
  }

  for (const match of text.matchAll(CITYS_BLESSING_CARD_TYPE_GET_RE)) {
    const buff = parseBuffSegment(match[3] || '');
    if (!buff) continue;
    const isOther = Boolean(match[1]);
    const cardType = String(match[2] || '').toLowerCase();
    specs.push({
      ...buildSpec(
        source,
        `${isOther ? 'other-' : ''}${cardType}-creatures-citys-blessing-lord`,
        { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
        { power: buff.power, toughness: buff.toughness },
        { kind: 'target_has_type', cardType },
      ),
      conditions: [{ kind: 'source_controller_has_citys_blessing' }],
    });
  }

  for (const match of text.matchAll(HISTORIC_DURING_TURN_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}historic-creatures-during-turn-ability-grant`,
      { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' },
      { abilities },
      { kind: 'target_is_historic_during_source_controller_turn' },
    ));
  }

  for (const match of text.matchAll(BASE_PT_RE)) {
    const isOther = Boolean(match[1]);
    const youControl = /\byou control\b/i.test(String(match[0] || ''));
    const setPower = parseInt(String(match[2] || ''), 10);
    const setToughness = parseInt(String(match[3] || ''), 10);
    if (!Number.isFinite(setPower) || !Number.isFinite(setToughness)) continue;
    const typeWord = parseLordCreatureType(String(match[4] || ''));
    const scopeKind = youControl
      ? (isOther ? 'other_creatures_you_control' : 'creatures_you_control')
      : (isOther ? 'other_all_creatures' : 'all_creatures');
    const scope = { kind: scopeKind } as StaticEffectSpec['scope'];
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${youControl ? 'you-control-' : ''}base-pt`,
      scope,
      { setPower, setToughness },
    ));
    if (typeWord && isCreatureTypeWord(typeWord)) {
      specs.push(buildSpec(
        source,
        `${isOther ? 'other-' : ''}${youControl ? 'you-control-' : ''}${typeWord}-type-addition`,
        scope,
        { typeAdditions: [typeWord] },
      ));
    }
  }

  for (const match of text.matchAll(MANA_ABILITY_ANTHEM_RE)) {
    const buff = parseBuffSegment(match[1] || '');
    if (!buff) continue;
    specs.push(buildSpec(
      source,
      'mana-ability-creatures-anthem',
      { kind: 'creatures_you_control' },
      { power: buff.power, toughness: buff.toughness },
      { kind: 'target_has_mana_ability' },
    ));
  }

  const copyActivatedCreaturesMatch = text.match(
    /(?:^|[.\n;])\s*(other\s+)?creatures you control have all activated abilities of all (land|creature|artifact) cards? exiled with/i,
  );
  if (copyActivatedCreaturesMatch) {
    specs.push(buildSpec(
      source,
      `${copyActivatedCreaturesMatch[1] ? 'other-' : ''}copy-exiled-activated`,
      { kind: copyActivatedCreaturesMatch[1] ? 'other_creatures_you_control' : 'creatures_you_control' },
      { copyActivatedFromExiledWithCardType: String(copyActivatedCreaturesMatch[2] || '').toLowerCase() },
    ));
  }

  const copyActivatedTypedMatch = text.match(
    /(?:^|[.\n;])\s*(other\s+)?([a-z]+)s you control have all activated abilities of all (land|creature|artifact) cards? exiled with/i,
  );
  if (copyActivatedTypedMatch && !/^creatures?$/i.test(String(copyActivatedTypedMatch[2] || ''))) {
    const typeWord = String(copyActivatedTypedMatch[2] || '').toLowerCase();
    specs.push(buildSpec(
      source,
      `${copyActivatedTypedMatch[1] ? 'other-' : ''}${typeWord}-copy-exiled-activated`,
      { kind: copyActivatedTypedMatch[1] ? 'other_permanents_you_control' : 'permanents_you_control' },
      { copyActivatedFromExiledWithCardType: String(copyActivatedTypedMatch[3] || '').toLowerCase() },
      { kind: 'target_has_type', cardType: typeWord },
    ));
  }
}
