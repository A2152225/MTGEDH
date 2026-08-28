// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingTypedAndKeywordLords.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: artifact/enchantment/land creature lords, outlaw designation lords,
//   nontoken / attacking "have" grants (live-seam static_other_type_lord /
//   static_creatures_you_control gaps).
// Public entry symbols: pushTypedAndKeywordLordSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  COLOR_WORDS,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  pushPlayerAbilityGrantsFromList,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';

const CARD_TYPE_LORD_TYPES = ['artifact', 'enchantment', 'land'] as const;

const CARD_TYPE_GET_RE =
  /(?:^|[.\n;]|—)\s*(other\s+)?(artifact|enchantment|land) creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/gi;
const CARD_TYPE_HAVE_RE =
  /(?:^|[.\n;]|—)\s*(other\s+)?(artifact|enchantment|land) creatures you control have ([^.]+)/gi;
const OUTLAW_GET_RE =
  /(?:^|[.\n;])\s*(other\s+)?outlaws you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/gi;
const OUTLAW_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?outlaws you control have ([^.]+)/gi;
const NONTOKEN_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?nontoken creatures you control have ([^.]+)/gi;
const ATTACKING_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?attacking creatures you control have ([^.]+)/gi;
const COLOR_GET_RE =
  /(?:^|[.\n;])\s*(other\s+)?(white|blue|black|red|green|colorless|multicolored) creatures(?: you control)? get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/gi;
const COLOR_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?(white|blue|black|red|green|colorless|multicolored) creatures(?: you control)? have ([^.]+)/gi;
const PERMANENT_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?(permanents?|artifacts?|enchantments?) you control have ([^.]+)/gi;
const OTHER_TYPE_HAVE_NO_CONTROL_RE =
  /(?:^|[.\n;])\s*other\s+([a-z]+)s?\s+(?:creatures?\s+)?have\s+([^.]+)/gi;
const MODIFIED_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?modified creatures you control have ([^.]+)/gi;
const EQUIPPED_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?equipped creatures you control have ([^.]+)/gi;
const ENCHANTED_HAVE_RE =
  /(?:^|[.\n;])\s*(other\s+)?enchanted creatures you control have ([^.]+)/gi;
const CREATURES_HAVE_RE =
  /(?:^|[.\n;])\s*(?:all )?creatures you control have ([^.]+)/gi;
const YOU_AND_OTHER_TYPE_HAVE_RE =
  /you and other ([a-z]+)s? you control have ([^.]+)/gi;

function tailHasUnsupportedConditional(tail: string): boolean {
  return /\bas long as\b/i.test(tail)
    || /\bfor each\b/i.test(tail)
    || /\bbase power and toughness\b/i.test(tail);
}

function colorCondition(colorWord: string): StaticEffectSpec['condition'] | undefined {
  if (colorWord === 'colorless') return { kind: 'target_is_colorless' };
  if (colorWord === 'multicolored') return { kind: 'target_is_multicolored' };
  if ((COLOR_WORDS as readonly string[]).includes(colorWord)) {
    return { kind: 'target_has_mana_color', color: colorWord };
  }
  return undefined;
}

function singularCardTypeWord(raw: string): 'artifact' | 'enchantment' | 'permanent' | null {
  const lower = String(raw || '').trim().toLowerCase();
  if (lower === 'permanent' || lower === 'permanents') return 'permanent';
  if (lower === 'artifact' || lower === 'artifacts') return 'artifact';
  if (lower === 'enchantment' || lower === 'enchantments') return 'enchantment';
  return null;
}

function otherScope(isOther: boolean): StaticEffectSpec['scope'] {
  return { kind: isOther ? 'other_creatures_you_control' : 'creatures_you_control' };
}

function removeUnqualifiedCreatureGetSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const hasUnqualified = /(?:^|[.\n;])\s*(?:other\s+)?creatures you control get\s+[+-]?\d+/i.test(oracle);
  if (hasUnqualified) return;
  const prefixes = [
    `${source.sourcePermanentId}:creatures-anthem`,
    `${source.sourcePermanentId}:monument-anthem`,
  ];
  for (let index = specs.length - 1; index >= 0; index -= 1) {
    if (prefixes.includes(String(specs[index]?.id || ''))) {
      specs.splice(index, 1);
    }
  }
}

/**
 * Card-type creature lords, outlaw designation lords, and keyword-have
 * templates that the creature-subtype parsers miss (artifact is not a
 * subtype; outlaw is a designation; riot/exalted need ABILITY_WORDS).
 */
export function pushTypedAndKeywordLordSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '');
  let addedCardTypeGet = false;

  for (const match of text.matchAll(CARD_TYPE_GET_RE)) {
    const tail = match[4] || '';
    if (tailHasUnsupportedConditional(tail)) continue;
    const cardType = String(match[2] || '').toLowerCase();
    if (!(CARD_TYPE_LORD_TYPES as readonly string[]).includes(cardType)) continue;
    const buff = parseBuffSegment(match[3] || '');
    if (!buff) continue;
    const isOther = Boolean(match[1]);
    const abilities = parseLordAbilitiesFromTail(tail);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${cardType}-creatures-lord`,
      otherScope(isOther),
      { power: buff.power, toughness: buff.toughness, abilities },
      { kind: 'target_has_type', cardType },
    ));
    if (!isOther) addedCardTypeGet = true;
  }

  for (const match of text.matchAll(CARD_TYPE_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const cardType = String(match[2] || '').toLowerCase();
    if (!(CARD_TYPE_LORD_TYPES as readonly string[]).includes(cardType)) continue;
    const abilities = parseLordAbilitiesFromTail(match[3] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${cardType}-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_has_type', cardType },
    ));
  }

  for (const match of text.matchAll(OUTLAW_GET_RE)) {
    const tail = match[3] || '';
    if (tailHasUnsupportedConditional(tail)) continue;
    const buff = parseBuffSegment(match[2] || '');
    if (!buff) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}outlaw-lord`,
      otherScope(isOther),
      { power: buff.power, toughness: buff.toughness, abilities: parseLordAbilitiesFromTail(tail) },
      { kind: 'target_is_outlaw' },
    ));
  }

  for (const match of text.matchAll(OUTLAW_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}outlaw-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_is_outlaw' },
    ));
  }

  for (const match of text.matchAll(NONTOKEN_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}nontoken-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_is_not_token' },
    ));
  }

  for (const match of text.matchAll(ATTACKING_HAVE_RE)) {
    const isOther = Boolean(match[1]);
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}attacking-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_is_attacking' },
    ));
  }

  for (const match of text.matchAll(COLOR_GET_RE)) {
    const tail = match[4] || '';
    if (tailHasUnsupportedConditional(tail)) continue;
    const colorWord = String(match[2] || '').toLowerCase();
    const condition = colorCondition(colorWord);
    if (!condition) continue;
    const buff = parseBuffSegment(match[3] || '');
    if (!buff) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${colorWord}-creatures-lord`,
      otherScope(isOther),
      { power: buff.power, toughness: buff.toughness, abilities: parseLordAbilitiesFromTail(tail) },
      condition,
    ));
  }

  for (const match of text.matchAll(COLOR_HAVE_RE)) {
    const colorWord = String(match[2] || '').toLowerCase();
    const condition = colorCondition(colorWord);
    if (!condition) continue;
    const abilities = parseLordAbilitiesFromTail(match[3] || '');
    if (abilities.length === 0) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${colorWord}-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      condition,
    ));
  }

  for (const match of text.matchAll(PERMANENT_HAVE_RE)) {
    const abilities = parseLordAbilitiesFromTail(match[3] || '');
    if (abilities.length === 0) continue;
    const cardType = singularCardTypeWord(match[2] || '');
    if (!cardType) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}${cardType}-you-control-ability-grant`,
      { kind: isOther ? 'other_permanents_you_control' : 'permanents_you_control' },
      { abilities },
      cardType === 'permanent' ? undefined : { kind: 'target_has_type', cardType },
    ));
  }

  for (const match of text.matchAll(OTHER_TYPE_HAVE_NO_CONTROL_RE)) {
    if (/\byou\s+control\b/i.test(String(match[0] || ''))) continue;
    const creatureType = parseLordCreatureType(String(match[1] || ''));
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    if ((COLOR_WORDS as readonly string[]).includes(creatureType)) continue;
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `other-all-${creatureType}-ability-grant`,
      { kind: 'other_all_creatures_of_type', creatureType },
      { abilities },
    ));
  }

  for (const match of text.matchAll(MODIFIED_HAVE_RE)) {
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}modified-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_is_modified' },
    ));
  }

  for (const match of text.matchAll(EQUIPPED_HAVE_RE)) {
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}equipped-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_is_equipped' },
    ));
  }

  for (const match of text.matchAll(ENCHANTED_HAVE_RE)) {
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    const isOther = Boolean(match[1]);
    specs.push(buildSpec(
      source,
      `${isOther ? 'other-' : ''}enchanted-creatures-ability-grant`,
      otherScope(isOther),
      { abilities },
      { kind: 'target_enchanted_by_aura_you_control' },
    ));
  }

  for (const match of text.matchAll(YOU_AND_OTHER_TYPE_HAVE_RE)) {
    const creatureType = parseLordCreatureType(String(match[1] || ''));
    if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
    const abilities = parseLordAbilitiesFromTail(match[2] || '');
    if (abilities.length === 0) continue;
    specs.push(buildSpec(
      source,
      `you-and-other-${creatureType}-ability-grant`,
      { kind: 'other_creatures_you_control', creatureType },
      { abilities },
    ));
    pushPlayerAbilityGrantsFromList(specs, source, `you-and-other-${creatureType}`, abilities);
  }

  if (!/other creatures you control have/i.test(text)) {
    for (const match of text.matchAll(CREATURES_HAVE_RE)) {
      const abilities = parseLordAbilitiesFromTail(match[1] || '');
      if (abilities.length === 0) continue;
      if (specs.some((spec) => spec.id.endsWith(':creatures-ability-grant'))) continue;
      specs.push(buildSpec(
        source,
        'creatures-ability-grant',
        { kind: 'creatures_you_control' },
        { abilities },
      ));
    }
  }

  if (addedCardTypeGet) {
    removeUnqualifiedCreatureGetSpecs(specs, source, text);
  }
}
