// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: pillowfort attack-you tax / prohibition statics (Ghostly Prison / Propaganda /
// Baird / Sphere of Safety / Collective Restraint / Norn's Annex / Archangel of Tithes /
// Elephant Grass color-gated / Blazing Archon / Form of the Dragon / Reverence /
// Combat Calligrapher / Vow host / Crawlspace cap / Teferi's Moat / Eriette /
// Silent Arbiter attack+block cap / Archangel of Tithes block tax while attacking).
// This-turn (War Tax / War Cadence) is skipped.
// Public entry: pushAttackYouTaxSpecs.

import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpec.js';
import { parseAttackYouTaxPhyrexianGrant } from '../staticEffectSpecAttackYouTaxPhyrexianParse.js';
import {
  ABILITY_WORDS,
  COLOR_WORDS,
  buildSpec,
  parseCardCountWord,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const UNTIL_EOT = /\b(?:this turn|this combat|until end of turn|until your next turn)\b/i;
const UNTAPPED_PREFIX = /^as long as this (?:creature|permanent) is untapped,?\s*/i;
const ATTACKING_PREFIX = /^as long as this (?:creature|permanent) is attacking,?\s*/i;
const COLOR_PREFIX =
  '(nonblack|nonwhite|nonblue|nonred|nongreen|black|white|blue|red|green)';
const ATTACK_YOU_TAIL = "can't attack you(?: or planeswalkers? you control)?";
const TAX_RE = new RegExp(
  `^(?:${COLOR_PREFIX}\\s+)?creatures ${ATTACK_YOU_TAIL} unless their controller pays \\{([^}]+)\\}`,
  'i',
);
const BLOCK_TAX_RE =
  /^creatures can't block unless their controller pays \{([^}]+)\}/i;
const PROHIBIT_RE = new RegExp(
  `^(?:${COLOR_PREFIX}\\s+)?creatures ${ATTACK_YOU_TAIL}$`,
  'i',
);
const KEYWORD_ALT = [...ABILITY_WORDS]
  .sort((left, right) => right.length - left.length)
  .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const WITHOUT_KEYWORD_PROHIBIT_RE = new RegExp(
  `^creatures without (${KEYWORD_ALT}) ${ATTACK_YOU_TAIL}$`,
  'i',
);
const WITH_KEYWORD_PROHIBIT_RE = new RegExp(
  `^creatures with (${KEYWORD_ALT}) ${ATTACK_YOU_TAIL}$`,
  'i',
);
const POWER_AT_MOST_PROHIBIT_RE = new RegExp(
  `^creatures with power (\\d+) or less ${ATTACK_YOU_TAIL}$`,
  'i',
);
const TYPE_PROHIBIT_RE = new RegExp(
  `^(\\w+) ${ATTACK_YOU_TAIL}$`,
  'i',
);
const YOU_CANT_BE_ATTACKED_RE = /^you can't be attacked$/i;
const YOU_CANT_BE_ATTACKED_EXCEPT_RE =
  /^you can(?:not|'t|’t) be attacked except by creatures with (.+)$/i;
const REPLACEMENT_WRAPPER_RE = /\bif you would\b|\bif you do\b/i;
const HOST_PROHIBIT_RE =
  /\b(enchanted|equipped) creature\b[\s\S]*\bcan't attack you(?: or planeswalkers? you control)?/i;
const ATTACK_YOU_CAP_RE = /^no more than ([a-z]+|\d+) creatures? can attack you(?: each combat)?$/i;
const GLOBAL_ATTACK_CAP_RE = /^no more than ([a-z]+|\d+) creatures? can attack each combat$/i;
const GLOBAL_BLOCK_CAP_RE = /^no more than ([a-z]+|\d+) creatures? can block each combat$/i;
const CHOSEN_COLOR_WITHOUT_KEYWORD_PROHIBIT_RE = new RegExp(
  `^creatures of the chosen color without (${KEYWORD_ALT}) ${ATTACK_YOU_TAIL}$`,
  'i',
);
const AURA_YOU_CONTROL_PROHIBIT_RE = new RegExp(
  `^each creature that(?:'s| is) enchanted by an aura you control ${ATTACK_YOU_TAIL}$`,
  'i',
);
const COLOR_TYPE_SKIP = new Set(['nonblack', 'nonwhite', 'nonblue', 'nonred', 'nongreen', ...COLOR_WORDS]);

function stripReminderText(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function splitOracleSentences(text: string): string[] {
  return stripReminderText(text)
    .split(/(?:\n+|[.!;]+)/)
    .map((sentence) => sentence.replace(/^[\s—–-]+/, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function colorWordToCondition(word: string | undefined): StaticEffectCondition | null | undefined {
  const normalized = String(word || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'nonblack') return { kind: 'target_is_not_black_creature' };
  if (normalized === 'black') return { kind: 'target_has_mana_color', color: 'black' };
  return null;
}

function parseTaxGrant(costToken: string, sentence: string): StaticEffectGrant | null {
  const token = String(costToken || '').trim();
  const lower = String(sentence || '').toLowerCase();
  const phyrexian = parseAttackYouTaxPhyrexianGrant(token);
  if (phyrexian) {
    return { attackYouTaxPhyrexian: phyrexian };
  }
  if (/^\d+$/.test(token)) {
    return { attackYouTaxGeneric: parseInt(token, 10) };
  }
  if (/^x$/i.test(token)) {
    if (/number of enchantments you control/i.test(lower)) {
      return {
        attackYouTaxGeneric: 1,
        attackYouTaxCountBasis: 'enchantments_you_control',
      };
    }
    if (/number of basic land types among lands you control/i.test(lower)) {
      return {
        attackYouTaxGeneric: 1,
        attackYouTaxCountBasis: 'basic_land_types_you_control',
      };
    }
    return null;
  }
  return null;
}

function parseBlockTaxGrant(costToken: string): StaticEffectGrant | null {
  const token = String(costToken || '').trim();
  if (/^\d+$/.test(token)) {
    return { blockTaxGeneric: parseInt(token, 10) };
  }
  return null;
}

function mergeColorCondition(
  existing: StaticEffectCondition | undefined,
  colorWord: string | undefined,
): StaticEffectCondition | undefined | null {
  const colorCondition = colorWordToCondition(colorWord);
  if (colorCondition === null) return null;
  if (existing && colorCondition) return null;
  return colorCondition || existing;
}

function mergeGatedCondition(
  existing: StaticEffectCondition | undefined,
  gated: StaticEffectCondition | undefined,
): StaticEffectCondition | undefined | null {
  if (existing && gated) return null;
  return gated || existing;
}

function parseExceptKeywordList(raw: string): string[] | null {
  const parts = String(raw || '')
    .replace(/\.+$/, '')
    .split(/\s*(?:,\s*(?:and\/or|and|or)\s+|and\/or|\s+or\s+|\s+and\s+|,\s+)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const known = new Set(ABILITY_WORDS.map((word) => word.toLowerCase()));
  const keywords = parts.filter((part) => known.has(part));
  if (keywords.length === 0 || keywords.length !== parts.length) return null;
  return keywords;
}

function parseExceptAttackedKeywords(sentence: string): string[] | null {
  const body = String(sentence || '')
    .replace(/^until your next turn,?\s+/i, '')
    .replace(/\s+until your next turn\.?$/i, '')
    .trim();
  const match = body.match(YOU_CANT_BE_ATTACKED_EXCEPT_RE);
  if (!match) return null;
  return parseExceptKeywordList(String(match[1] || ''));
}

function pushAttackYouProhibit(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  condition: StaticEffectCondition | undefined,
  options?: {
    scope?: StaticEffectSpec['scope'];
    sourcePermanentId?: string;
    idSuffix?: string;
  },
): void {
  const spec = buildSpec(
    source,
    options?.idSuffix || 'attack-you-prohibited',
    options?.scope || { kind: 'player_you' },
    { attackYouProhibited: true },
    condition,
  );
  if (options?.sourcePermanentId) spec.sourcePermanentId = options.sourcePermanentId;
  specs.push(spec);
}

/**
 * Quoted from mtg_data.db (is_token = 0):
 * Ghostly Prison / Propaganda / Windborn Muse: "Creatures can't attack you unless
 *   their controller pays {2} for each creature they control that's attacking you."
 * Baird: "Creatures can't attack you or planeswalkers you control unless their
 *   controller pays {1} for each of those creatures."
 * Sphere of Safety: "...pays {X} ... where X is the number of enchantments you control."
 * Collective Restraint: "...pays {X} ... where X is the number of basic land types
 *   among lands you control."
 * Norn's Annex: "...pays {W/P} for each of those creatures."
 * Archangel of Tithes: "As long as this creature is untapped, creatures can't attack
 *   you or planeswalkers you control unless their controller pays {1}..."
 *   / "As long as this creature is attacking, creatures can't block unless their
 *   controller pays {1}..."
 * Elephant Grass: "Black creatures can't attack you." /
 *   "Nonblack creatures can't attack you unless their controller pays {2}..."
 * Blazing Archon: "Creatures can't attack you."
 * Form of the Dragon: "Creatures without flying can't attack you."
 * Sandwurm Convergence: "Creatures with flying can't attack you or planeswalkers you control."
 * Reverence: "Creatures with power 2 or less can't attack you."
 * Combat Calligrapher: "Inklings can't attack you or planeswalkers you control."
 * Vow / Spectral Grasp: "Enchanted creature ... can't attack you or planeswalkers you control."
 * Assault Suit: "Equipped creature ... can't attack you or planeswalkers you control..."
 * Crawlspace: "No more than two creatures can attack you each combat."
 * Silent Arbiter / Dueling Grounds: "No more than one creature can attack each combat."
 *   / "No more than one creature can block each combat."
 * Teferi's Moat: "Creatures of the chosen color without flying can't attack you."
 * Eriette: "Each creature that's enchanted by an Aura you control can't attack you..."
 * Personal Decoy: "You can't be attacked."
 * Island Sanctuary lock (applied, not the draw-replacement wrapper):
 *   "you can't be attacked except by creatures with flying and/or islandwalk"
 */
export function pushAttackYouTaxSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
  perm?: BattlefieldPermanent,
): void {
  const text = String(oracle || '');
  if (!text) return;

  for (const rawSentence of splitOracleSentences(text)) {
    const isReplacementWrapper = REPLACEMENT_WRAPPER_RE.test(rawSentence);
    let sentence = rawSentence.replace(/^[a-z][a-z'’]*(?:\s+[a-z][a-z'’]*)?\s*[—–-]\s+/i, '');
    let condition: StaticEffectCondition | undefined;
    if (UNTAPPED_PREFIX.test(sentence)) {
      sentence = sentence.replace(UNTAPPED_PREFIX, '').trim();
      condition = { kind: 'source_is_untapped' };
    } else if (ATTACKING_PREFIX.test(sentence)) {
      sentence = sentence.replace(ATTACKING_PREFIX, '').trim();
      condition = { kind: 'source_is_attacking' };
    }

    const exceptKeywords = isReplacementWrapper ? null : parseExceptAttackedKeywords(sentence);
    if (exceptKeywords) {
      const merged = mergeGatedCondition(condition, {
        kind: 'target_lacks_all_keywords',
        keywords: exceptKeywords,
      });
      if (merged !== null) {
        pushAttackYouProhibit(specs, source, merged);
        continue;
      }
    }

    if (UNTIL_EOT.test(rawSentence)) continue;

    const taxMatch = sentence.match(TAX_RE);
    if (taxMatch) {
      const merged = mergeColorCondition(condition, taxMatch[1]);
      if (merged === null) continue;
      const grant = parseTaxGrant(String(taxMatch[2] || ''), sentence);
      if (!grant) continue;
      const phyrexianLife = Number(grant.attackYouTaxPhyrexian?.life);
      const hasPhyrexian = Boolean(grant.attackYouTaxPhyrexian?.symbol)
        && Number.isFinite(phyrexianLife)
        && phyrexianLife > 0;
      if (!hasPhyrexian) {
        if (Number(grant.attackYouTaxGeneric || 0) < 0) continue;
        if (!Number.isFinite(Number(grant.attackYouTaxGeneric))) continue;
      }
      specs.push(buildSpec(
        source,
        merged?.kind === 'source_is_untapped' ? 'attack-you-tax-untapped' : 'attack-you-tax',
        { kind: 'player_you' },
        grant,
        merged,
      ));
      continue;
    }

    const blockTaxMatch = sentence.match(BLOCK_TAX_RE);
    if (blockTaxMatch) {
      const grant = parseBlockTaxGrant(String(blockTaxMatch[1] || ''));
      if (!grant || Number(grant.blockTaxGeneric || 0) <= 0) continue;
      if (!Number.isFinite(Number(grant.blockTaxGeneric))) continue;
      specs.push(buildSpec(
        source,
        condition?.kind === 'source_is_attacking' ? 'block-tax-attacking' : 'block-tax',
        { kind: 'all_creatures' },
        grant,
        condition,
      ));
      continue;
    }

    if (HOST_PROHIBIT_RE.test(sentence) && !/\bunless\b|\bpays?\s*\{/i.test(sentence)) {
      const attachedTo = String((perm as any)?.attachedTo || '').trim();
      if (!attachedTo) continue;
      const hostKind = /\bequipped creature\b/i.test(sentence) ? 'equipped' : 'enchanted';
      pushAttackYouProhibit(specs, source, condition, {
        scope: { kind: 'self' },
        sourcePermanentId: attachedTo,
        idSuffix: `${hostKind}-attack-you-prohibited`,
      });
      continue;
    }

    const chosenColorWithout = sentence.match(CHOSEN_COLOR_WITHOUT_KEYWORD_PROHIBIT_RE);
    if (chosenColorWithout) {
      const chosenColor = String(
        (perm as any)?.chosenColor || (perm as any)?.card?.chosenColor || '',
      ).trim().toLowerCase();
      if (!chosenColor || !COLOR_WORDS.includes(chosenColor)) continue;
      const merged = mergeGatedCondition(condition, {
        kind: 'target_has_mana_color_and_lacks_keyword',
        color: chosenColor,
        keyword: String(chosenColorWithout[1] || '').toLowerCase(),
      });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const withoutKeyword = sentence.match(WITHOUT_KEYWORD_PROHIBIT_RE);
    if (withoutKeyword) {
      const merged = mergeGatedCondition(condition, {
        kind: 'target_lacks_keyword',
        keyword: String(withoutKeyword[1] || '').toLowerCase(),
      });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const withKeyword = sentence.match(WITH_KEYWORD_PROHIBIT_RE);
    if (withKeyword) {
      const merged = mergeGatedCondition(condition, {
        kind: 'target_has_keyword',
        keyword: String(withKeyword[1] || '').toLowerCase(),
      });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const powerAtMost = sentence.match(POWER_AT_MOST_PROHIBIT_RE);
    if (powerAtMost) {
      const power = parseInt(String(powerAtMost[1] || ''), 10);
      if (!Number.isFinite(power)) continue;
      const merged = mergeGatedCondition(condition, { kind: 'target_power_at_most', power });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const prohibitMatch = sentence.match(PROHIBIT_RE);
    if (prohibitMatch) {
      const merged = mergeColorCondition(condition, prohibitMatch[1]);
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const typeMatch = sentence.match(TYPE_PROHIBIT_RE);
    if (typeMatch) {
      const rawType = String(typeMatch[1] || '').trim();
      if (COLOR_TYPE_SKIP.has(rawType.toLowerCase())) continue;
      const creatureType = parseLordCreatureType(rawType);
      if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
      const merged = mergeGatedCondition(condition, {
        kind: 'target_has_creature_type',
        creatureType,
      });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    const auraYouControl = sentence.match(AURA_YOU_CONTROL_PROHIBIT_RE);
    if (auraYouControl) {
      const merged = mergeGatedCondition(condition, { kind: 'target_enchanted_by_aura_you_control' });
      if (merged === null) continue;
      pushAttackYouProhibit(specs, source, merged);
      continue;
    }

    if (YOU_CANT_BE_ATTACKED_RE.test(sentence)) {
      if (condition) continue;
      pushAttackYouProhibit(specs, source, undefined);
      continue;
    }

    const capMatch = sentence.match(ATTACK_YOU_CAP_RE);
    if (capMatch) {
      if (condition) continue;
      const max = parseCardCountWord(String(capMatch[1] || ''));
      if (!max || max <= 0) continue;
      specs.push(buildSpec(
        source,
        'attack-you-max-attackers',
        { kind: 'player_you' },
        { attackYouMaxAttackers: max },
      ));
      continue;
    }

    const globalCapMatch = sentence.match(GLOBAL_ATTACK_CAP_RE);
    if (globalCapMatch) {
      if (condition) continue;
      const max = parseCardCountWord(String(globalCapMatch[1] || ''));
      if (!max || max <= 0) continue;
      specs.push(buildSpec(
        source,
        'max-attackers-each-combat',
        { kind: 'all_creatures' },
        { maxAttackersEachCombat: max },
      ));
      continue;
    }

    const globalBlockCapMatch = sentence.match(GLOBAL_BLOCK_CAP_RE);
    if (globalBlockCapMatch) {
      if (condition) continue;
      const max = parseCardCountWord(String(globalBlockCapMatch[1] || ''));
      if (!max || max <= 0) continue;
      specs.push(buildSpec(
        source,
        'max-blockers-each-combat',
        { kind: 'all_creatures' },
        { maxBlockersEachCombat: max },
      ));
    }
  }
}
