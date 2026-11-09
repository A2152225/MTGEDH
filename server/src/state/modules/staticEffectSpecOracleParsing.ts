import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { pushPairedAndGraveyardCountQuotedGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingPairedThresholdQuotedGrants.js';
import {
  parseAttachmentGrantedKeywordsFromOracle,
  parseAttachmentGrantedTypesFromOracle,
} from '../../../../shared/src/attachmentKeywordGrants.js';
import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';
import type { StaticEffectCountBasis, StaticEffectSpec } from './staticEffectSpec.js';
import { sanitizeOracleTextForStaticEffectScan } from '../../../../rules-engine/src/staticEffectOracleSanitize.js';
import { normalizeStaticSelfNameSubjects } from './staticEffectSpecSelfNameSubject.js';
import {
  ABILITY_WORDS,
  COLOR_WORDS,
  buildSpec,
  parseAbilitiesFromTail,
  parseBuffSegment,
  parseCardCountWord,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  pushPlayerAbilityGrantsFromList,
  resolveChosenOptionsFromPermanent,
} from './staticEffectSpec-handlers/staticEffectSpecOracleParseHelpers.js';
import {
  oracleHasGraveyardLandKeywordGrant,
  pushGraveyardLandKeywordGrantSpecs,
} from './staticEffectSpec-handlers/staticEffectSpecOracleParsingGraveyardLandKeywords.js';
import {
  pushOtherCreatureAndOpponentPolaritySpecs,
  pushPlayerHexproofAndConditionalGrantSpecs,
} from './staticEffectSpec-handlers/staticEffectSpecOracleParsingAsLongAsAndPolarity.js';
import { pushManaAbilityGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingManaAbilityGrants.js';
import { pushTapUntapAbilityGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingTapUntapAbilityGrants.js';
import { pushMustBeBlockedSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlocked.js';
import { pushMustBeBlockedByTypeSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlockedByType.js';
import { pushCantAttackBlockSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';
import { pushMassCantAttackBlockSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingMassCantAttack.js';
import { pushR35CombatGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingR35CombatGrants.js';
import { pushSelfCombatConditionSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfCombatConditions.js';
import { pushR36MassCombatSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingR36MassCombat.js';
import { pushCountedAndAttachedPTSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingCountedPT.js';
import { pushEnchantedCreatureLordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingEnchantedCreatureLord.js';
import { pushConditionalAttachedPTSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalAttachedPT.js';
import { pushAttachedExtraSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingAttachedExtras.js';
import { pushQualifiedGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedGrants.js';
import { pushSelfStateGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfStateGrants.js';
import { pushAttachedQuotedAbilityGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingAttachedQuotedGrants.js';
import { pushLoseKeywordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingLoseKeywords.js';
import { pushAttackYouTaxSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingAttackYouTax.js';
import { pushTypedAndKeywordLordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingTypedAndKeywordLords.js';
import { pushQuotedNumericAndBasePTLordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingQuotedNumericBasePT.js';
import { pushBorrowedActivatedSelfSpecs } from './staticEffectSpecBorrowedActivated.js';
import { pushConditionalSelfGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalSelfGrants.js';
import { pushOpponentKeywordMirrorGrantSpecs } from './staticEffectSpec-handlers/opponentKeywordMirrorGrants.js';
import { pushBatch62LongTailStaticSpecs } from './staticEffectSpec-handlers/batch62LongTailStatics.js';
import { pushBatch63LongTailStaticSpecs } from './staticEffectSpec-handlers/batch63LongTailStatics.js';
import { pushBatch65LongTailStaticSpecs } from './staticEffectSpec-handlers/batch65LongTailStatics.js';
import { pushBatch66LongTailStaticSpecs } from './staticEffectSpec-handlers/batch66LongTailStatics.js';
import { pushBatch68LongTailStaticSpecs } from './staticEffectSpec-handlers/batch68LongTailStatics.js';
import { pushBatch69LongTailStaticSpecs } from './staticEffectSpec-handlers/batch69LongTailStatics.js';
import { pushBatch70LongTailStaticSpecs } from './staticEffectSpec-handlers/batch70LongTailStatics.js';
import { pushBatch71LongTailStaticSpecs } from './staticEffectSpec-handlers/batch71LongTailStatics.js';
import { pushBatch72LongTailStaticSpecs } from './staticEffectSpec-handlers/batch72LongTailStatics.js';
import { pushBatch73LongTailStaticSpecs } from './staticEffectSpec-handlers/batch73LongTailStatics.js';
import { pushBatch74LongTailStaticSpecs } from './staticEffectSpec-handlers/batch74LongTailStatics.js';
import { pushBatch75LongTailStaticSpecs } from './staticEffectSpec-handlers/batch75LongTailStatics.js';
import { pushBatch76LongTailStaticSpecs } from './staticEffectSpec-handlers/batch76LongTailStatics.js';
import { pushBatch77LongTailStaticSpecs } from './staticEffectSpec-handlers/batch77LongTailStatics.js';
import { pushConditionalScopedGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalScopedGrants.js';
import { splitStationThresholdLines, gateStationThresholdSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingStationThresholds.js';
import { pushTrekSelfStaticSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingTrekStatics.js';
import { pushGlobalGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingGlobalGrants.js';
import { pushQualifiedScopeSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedScopes.js';
import { pushPhase5SupplementalSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingPhase5Supplement.js';

import {
  pushAttachedHostKeywordGrants,
  pushAttachedHostTypeAdditions,
  pushAttachedHostProtectionGrant,
  pushChosenTypeAbilityGrantSpecs,
  pushAbilityGrantSpecs,
  pushColorAnthemSpecs,
  pushDynamicLordSpecs,
  pushLordSpecs,
} from './staticEffectSpecOracleParsingHostGrantsAndLords.js';

/** Parse anthem/lord/conditional static P/T from battlefield oracle text (Phase 5.4). */
export function parseStaticEffectSpecsFromOraclePermanent(
  perm: BattlefieldPermanent,
): StaticEffectSpec[] {
  // The parse is a pure function of the permanent, so it is memoized on the permanent's full
  // serialized form (every field it could read); hits return deep copies. Replays re-derive the
  // whole board on every death, which made this the dominant reload cost.
  let key: string | undefined;
  try { key = JSON.stringify(perm); } catch { key = undefined; }
  const cached = key !== undefined ? STATIC_SPEC_PARSE_CACHE.get(key) : undefined;
  if (cached) return structuredClone(cached);
  // R32: Station "N+ | text" lines are parsed separately and gated on N charge counters.
  const station = splitStationThresholdLines(perm);
  const basePerm = station ? station.basePerm : perm;
  const specs = pushPhase5SupplementalSpecs(
    parseStaticEffectSpecsFromOraclePermanentCore(basePerm),
    basePerm,
    parseStaticEffectSpecsFromOraclePermanent,
  );
  for (const g of station?.gated || []) specs.push(...gateStationThresholdSpecs(parseStaticEffectSpecsFromOraclePermanentCore(g.perm), g.amount));
  if (key !== undefined) {
    try {
      const copy = structuredClone(specs);
      if (STATIC_SPEC_PARSE_CACHE.size >= STATIC_SPEC_PARSE_CACHE_MAX) STATIC_SPEC_PARSE_CACHE.clear();
      STATIC_SPEC_PARSE_CACHE.set(key, copy);
    } catch { /* uncloneable spec: skip caching */ }
  }
  return specs;
}

const STATIC_SPEC_PARSE_CACHE = new Map<string, StaticEffectSpec[]>();
const STATIC_SPEC_PARSE_CACHE_MAX = 4096;

function parseStaticEffectSpecsFromOraclePermanentCore(
  perm: BattlefieldPermanent,
): StaticEffectSpec[] {
  const oracleText = String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || '').trim();
  if (!oracleText) return [];

  const oracle = sanitizeOracleTextForStaticEffectScan(normalizeStaticSelfNameSubjects(oracleText, perm)).toLowerCase();
  const sourcePermanentId = String(perm.id || '').trim();
  const sourceController = String(perm.controller || '').trim();
  const sourceName = String((perm as any)?.card?.name || (perm as any)?.name || 'Unknown').trim();
  if (!sourcePermanentId || !sourceController) return [];

  const source = { sourcePermanentId, sourceController, sourceName };
  const specs: StaticEffectSpec[] = [];
  const chosenCreatureType = String(
    (perm as any)?.chosenCreatureType
    || (perm as any)?.card?.chosenCreatureType
    || '',
  ).trim().toLowerCase();
  const chosenColor = String(
    (perm as any)?.chosenColor || (perm as any)?.card?.chosenColor || '',
  ).trim().toLowerCase();

  pushDynamicLordSpecs(specs, source, oracle);
  const hasDynamicLord = specs.length > 0;

  // "As long as <condition>, this creature has X" - evaluated against current state. Runs even
  // beside a dynamic lord line (Svyelun: conditional self indestructible + Merfolk ward lord).
  pushConditionalSelfGrantSpecs(specs, source, oracle);
  pushOpponentKeywordMirrorGrantSpecs(specs, source, oracle);
  pushBatch62LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch63LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch65LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch66LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch68LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch69LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch70LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch71LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch72LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch73LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch74LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch75LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch76LongTailStaticSpecs(specs, source, perm, oracle);
  pushBatch77LongTailStaticSpecs(specs, source, perm, oracle);
  pushConditionalScopedGrantSpecs(specs, source, oracle);
  pushTrekSelfStaticSpecs(specs, source, oracle);
  pushGlobalGrantSpecs(specs, source, oracle);
  pushQualifiedScopeSpecs(specs, source, oracle);
  if (hasDynamicLord) return specs;

  const leylineLifeMatch = oracle.match(
    /if you have at least (\w+) life more than your starting life total, creatures you control get (\+\d+\s*\/\s*\+\d+)/i,
  );
  if (leylineLifeMatch) {
    const offset = parseCardCountWord(leylineLifeMatch[1]);
    const buff = parseBuffSegment(leylineLifeMatch[2]);
    if (offset !== undefined && buff) {
      specs.push(buildSpec(
        source,
        'life-threshold-anthem',
        { kind: 'creatures_you_control' },
        { power: buff.power, toughness: buff.toughness },
        { kind: 'controller_life_at_least_starting_plus', offset },
      ));
    }
  }

  const tokenTurnBuffMatch = oracle.match(
    /during your turn,?\s*creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (tokenTurnBuffMatch) {
    const buff = parseBuffSegment(tokenTurnBuffMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'turn-token-buff',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(tokenTurnBuffMatch[2] || ''),
        },
        { kind: 'target_is_token_during_source_controller_turn' },
      ));
    }
  } else {
    const tokenBuffMatch = oracle.match(/creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (tokenBuffMatch) {
      const buff = parseBuffSegment(tokenBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'token-anthem',
          { kind: 'creatures_you_control' },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseAbilitiesFromTail(tokenBuffMatch[2] || ''),
          },
          { kind: 'target_is_token' },
        ));
      }
    }
  }

  const nontokenBuffMatch = oracle.match(/nontoken creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nontokenBuffMatch) {
    const buff = parseBuffSegment(nontokenBuffMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nontoken-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nontokenBuffMatch[2] || ''),
        },
        { kind: 'target_is_not_token' },
      ));
    }
  }

  const nonblackMatch = oracle.match(/nonblack creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nonblackMatch) {
    const buff = parseBuffSegment(nonblackMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nonblack-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nonblackMatch[2] || ''),
        },
        { kind: 'target_is_not_black_creature' },
      ));
    }
  }

  const nonHumanMatch = oracle.match(/non[- ]?human creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nonHumanMatch) {
    const buff = parseBuffSegment(nonHumanMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nonhuman-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nonHumanMatch[2] || ''),
        },
        { kind: 'target_is_not_human_creature' },
      ));
    }
  }

  // Flowering of the White Tree: "Nonlegendary creatures you control get +1/+1." (issue #46)
  const nonlegendaryMatch = oracle.match(/\bnon-?legendary creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nonlegendaryMatch) {
    const buff = parseBuffSegment(nonlegendaryMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nonlegendary-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseLordAbilitiesFromTail(nonlegendaryMatch[2] || ''),
        },
        { kind: 'target_is_nonlegendary_creature' },
      ));
    }
  }

  const legendaryMatch = oracle.match(/(?<![a-z-])legendary creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (legendaryMatch) {
    const buff = parseBuffSegment(legendaryMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'legendary-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseLordAbilitiesFromTail(legendaryMatch[2] || ''),
        },
        { kind: 'target_is_legendary_creature' },
      ));
    }
  }

  const legendaryHaveMatch = oracle.match(/(?<![a-z-])legendary creatures you control have\s+([^.]+)/i);
  if (legendaryHaveMatch) {
    const abilities = parseAbilitiesFromTail(legendaryHaveMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'legendary-ability-grant',
        { kind: 'creatures_you_control' },
        { abilities },
        { kind: 'target_is_legendary_creature' },
      ));
    }
  }

  const allCreaturesMatch = oracle.match(/all creatures get ([+-]\d+\s*\/\s*[+-]\d+)(?![^.\n]*until end of turn)/i);
  // Inside an activated ability ("{2}, {T}: All creatures get +2/+2 for as long as ...", Thran Weaponry) it is a
  // one-shot effect handled by the Oracle IR executor (source-linked modifier), not a permanent anthem.
  const allCreaturesLinePrefix = allCreaturesMatch
    ? oracle.slice(0, allCreaturesMatch.index ?? 0).split('\n').pop() || ''
    : '';
  if (allCreaturesMatch && !allCreaturesLinePrefix.includes(':') && !/^\s*(?:when|whenever|at|if)\b/i.test(allCreaturesLinePrefix)) {
    const buff = parseBuffSegment(allCreaturesMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'all-creatures-anthem',
        { kind: 'all_creatures' },
        { power: buff.power, toughness: buff.toughness },
      ));
    }
  }

  const hasOtherTypeLordPattern = /other\s+[a-z]+\s+creatures?\s+you\s+control\s+get/i.test(oracle);

  const monumentMatch = oracle.match(
    /(?:^|[.\n;:,]\s*)creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/i,
  );
  if (monumentMatch) {
    const buff = parseBuffSegment(monumentMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'monument-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(monumentMatch[2] || ''),
        },
      ));
    }
  } else {
    const anthemMatch = !leylineLifeMatch
      && !tokenTurnBuffMatch
      && !oracle.includes('creature tokens you control get')
      && !nontokenBuffMatch
      && !hasOtherTypeLordPattern
      && !legendaryMatch
      && !legendaryHaveMatch
      && !nonlegendaryMatch
      ? oracle.match(/(?:^|[.\n;:,]\s*)creatures you control get ([+-]\d+\s*\/\s*[+-]\d+)([^.]*)/i)
      : null;
    if (anthemMatch) {
      const buff = parseBuffSegment(anthemMatch[1]);
      // Penalty anthems (Heartless Summoning -1/-1, Flowstone Surge +1/-1) must be static: no trigger/duration/count tail.
      const sentenceStart = Math.max(0, oracle.lastIndexOf('\n', anthemMatch.index ?? 0) + 1);
      const lead = oracle.slice(sentenceStart, anthemMatch.index ?? 0);
      const penaltyOk = !buff || (buff.power >= 0 && buff.toughness >= 0)
        || (!/until end of turn|this turn|for each|as long as|where x/i.test(anthemMatch[2] || '') && !/\b(?:when|whenever|at the beginning|if|until)\b/i.test(lead));
      if (buff && penaltyOk) {
        specs.push(buildSpec(
          source,
          'creatures-anthem',
          { kind: 'creatures_you_control' },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseAbilitiesFromTail(anthemMatch[2] || ''),
          },
        ));
      }
    }
  }

  pushLordSpecs(specs, source, oracle);
  pushTypedAndKeywordLordSpecs(specs, source, oracle);
  pushQuotedNumericAndBasePTLordSpecs(specs, source, oracle);
  pushBorrowedActivatedSelfSpecs(specs, source, oracle);
  pushOtherCreatureAndOpponentPolaritySpecs(specs, source, oracle);
  pushAbilityGrantSpecs(specs, source, perm, oracle);
  pushTapUntapAbilityGrantSpecs(specs, source, oracle);
  pushPlayerHexproofAndConditionalGrantSpecs(specs, source, oracle);
  pushGraveyardLandKeywordGrantSpecs(specs, source, oracle);
  pushManaAbilityGrantSpecs(specs, source, oracle);
  pushLoseKeywordSpecs(specs, source, oracle);
  pushMustBeBlockedSpecs(specs, source, perm, oracle);
  pushMustBeBlockedByTypeSpecs(specs, source, perm, oracle);
  pushCantAttackBlockSpecs(specs, source, perm, oracle);
  pushSelfCombatConditionSpecs(specs, source, oracle);
  pushR35CombatGrantSpecs(specs, source, perm, oracle);
  pushR36MassCombatSpecs(specs, source, oracle);
  pushMassCantAttackBlockSpecs(specs, source, perm, oracle);
  pushAttachedQuotedAbilityGrantSpecs(specs, source, perm, oracle);
  pushCountedAndAttachedPTSpecs(specs, source, perm, oracle);
  pushEnchantedCreatureLordSpecs(specs, source, perm, oracle);
  pushConditionalAttachedPTSpecs(specs, source, perm, oracle);
  pushAttachedExtraSpecs(specs, source, perm, oracle);
  pushQualifiedGrantSpecs(specs, source, perm, oracle);
  pushSelfStateGrantSpecs(specs, source, oracle);
  pushPairedAndGraveyardCountQuotedGrantSpecs(specs, source, perm, oracle);
  pushAttackYouTaxSpecs(specs, source, oracle, perm);
  pushColorAnthemSpecs(specs, source, oracle);

  if (chosenColor) {
    const chosenColorBuffMatch = oracle.match(/creatures you control of the chosen color get\s+(\+\d+\s*\/\s*\+\d+)/i);
    if (chosenColorBuffMatch) {
      const buff = parseBuffSegment(chosenColorBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-color-anthem',
          { kind: 'creatures_you_control' },
          { power: buff.power, toughness: buff.toughness },
          { kind: 'target_has_mana_color', color: chosenColor },
        ));
      }
    } else {
      // Gauntlet of Power: "Creatures of the chosen color get +1/+1" (global)
      const globalChosenColorBuffMatch = oracle.match(
        /creatures of the chosen color get\s+(\+\d+\s*\/\s*\+\d+)/i,
      );
      if (globalChosenColorBuffMatch) {
        const buff = parseBuffSegment(globalChosenColorBuffMatch[1]);
        if (buff) {
          specs.push(buildSpec(
            source,
            'chosen-color-global-anthem',
            { kind: 'all_creatures' },
            { power: buff.power, toughness: buff.toughness },
            { kind: 'target_has_mana_color', color: chosenColor },
          ));
        }
      }
    }

    const colorSymbol = ({
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
    } as Record<string, string>)[String(chosenColor).toLowerCase()] || String(chosenColor).toUpperCase();

    // Voice of All / Order of the Stars: "This creature has protection from the chosen color."
    // Do not treat Aura text like "Enchanted creature has protection from the chosen color"
    // as a self-grant (Flickering Ward).
    const grantsSelfChosenColorProtection =
      /\b(?:this (?:creature|permanent)|it) has protection from the chosen colou?r\b/i.test(oracle)
      || (
        /\bprotection from the chosen colou?r\b/i.test(oracle)
        && !/\benchanted\s+(?:creature|permanent|land)\s+has\s+protection from the chosen colou?r\b/i.test(oracle)
        && !/\bequipped\s+creature\s+has\s+protection from the chosen colou?r\b/i.test(oracle)
        && !/\ball\s+\w+s?\s+have protection from the chosen colou?r\b/i.test(oracle)
        && !/\bcreatures?\s+you\s+control\b.*\bprotection from the chosen colou?r\b/i.test(oracle)
      );
    if (grantsSelfChosenColorProtection) {
      specs.push(buildSpec(
        source,
        'chosen-color-protection-self',
        { kind: 'self' },
        { abilities: [`protection from ${String(chosenColor).toLowerCase()}`] },
      ));
    }

    // Ward Sliver-style: "All Slivers have protection from the chosen color."
    const allTypeProtection = oracle.match(
      /all\s+([a-z]+)s?\s+have\s+protection from the chosen colou?r/i,
    );
    if (allTypeProtection) {
      const creatureType = String(allTypeProtection[1] || '').trim();
      if (creatureType) {
        specs.push(buildSpec(
          source,
          'chosen-color-protection-type',
          { kind: 'all_creatures_of_type', creatureType },
          { abilities: [`protection from ${String(chosenColor).toLowerCase()}`] },
        ));
      }
    }

    // Alloy Golem: "This creature is the chosen color."
    if (/\b(?:this (?:creature|permanent|artifact)|it) is the chosen colou?r\b/i.test(oracle)
      || oracle.includes(`${sourceName.toLowerCase()} is the chosen color`)) {
      specs.push(buildSpec(
        source,
        'chosen-color-characteristic-self',
        { kind: 'self' },
        { colorAdditions: [colorSymbol] },
      ));
    }

    // Painter's Servant: "... are the chosen color in addition to their other colors."
    if (/are the chosen colou?r in addition to their other colors/i.test(oracle)) {
      specs.push(buildSpec(
        source,
        'chosen-color-addition-global',
        { kind: 'all_permanents' },
        { colorAdditions: [colorSymbol] },
      ));
    }

    // Enchanted permanent is the chosen color (Shimmerwilds Growth, etc.)
    if (/enchanted (?:land|creature|permanent) is the chosen colou?r/i.test(oracle)) {
      const attachedTo = String((perm as any).attachedTo || '').trim();
      if (attachedTo) {
        specs.push({
          ...buildSpec(
            source,
            'chosen-color-characteristic-enchanted',
            { kind: 'all_permanents' },
            { colorAdditions: [colorSymbol] },
          ),
          // Narrow via sourcePermanentId match in apply — use condition-less self-like filter:
          // override scope matching by storing enchanted id in sourceName metadata is messy;
          // instead grant via a synthetic self scope against attached permanent id.
          sourcePermanentId: attachedTo,
          scope: { kind: 'self' },
        });
      }
    }
  }

  pushAttachedHostProtectionGrant(specs, source, perm, oracle, chosenColor);
  pushAttachedHostKeywordGrants(specs, source, perm, oracleText);
  pushAttachedHostTypeAdditions(specs, source, perm, oracleText);

  if (chosenCreatureType) {
    const chosenTypeOtherBuffMatch = oracle.match(
      /other creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)/i,
    );
    if (chosenTypeOtherBuffMatch) {
      const buff = parseBuffSegment(chosenTypeOtherBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-type-other-lord',
          { kind: 'other_creatures_you_control', creatureType: chosenCreatureType },
          { power: buff.power, toughness: buff.toughness },
        ));
      }
    }

    const hasOtherChosenTypeLord = /other creatures you control of the chosen type get/i.test(oracle);

    if (!hasOtherChosenTypeLord) {
      const controlledChosenTypeBuffMatch = oracle.match(
        /creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
      );
      if (controlledChosenTypeBuffMatch) {
        const buff = parseBuffSegment(controlledChosenTypeBuffMatch[1]);
        if (buff) {
          specs.push(buildSpec(
            source,
            'chosen-type-controlled-anthem',
            { kind: 'creatures_you_control', creatureType: chosenCreatureType },
            {
              power: buff.power,
              toughness: buff.toughness,
              abilities: parseLordAbilitiesFromTail(controlledChosenTypeBuffMatch[2] || ''),
            },
          ));
        }
      }
    }

    const opponentDebuffMatch = oracle.match(
      /creatures of the chosen type your opponents control get\s+([+-]?\d+)\s*\/\s*([+-]?\d+)/i,
    );
    if (opponentDebuffMatch) {
      const power = parseInt(opponentDebuffMatch[1], 10);
      const toughness = parseInt(opponentDebuffMatch[2], 10);
      if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
        specs.push(buildSpec(
          source,
          'opponent-chosen-type-debuff',
          { kind: 'opponent_creatures_of_type', creatureType: chosenCreatureType },
          { power, toughness },
        ));
      }
    }

    const globalChosenTypeBuffMatch = oracle.match(
      /creatures of the chosen type(?! your opponents) get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
    );
    if (globalChosenTypeBuffMatch) {
      const buff = parseBuffSegment(globalChosenTypeBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-type-global-anthem',
          { kind: 'all_creatures_of_type', creatureType: chosenCreatureType },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseLordAbilitiesFromTail(globalChosenTypeBuffMatch[2] || ''),
          },
        ));
      }
    }

    const controlledChosenTypeAbilitiesMatch = oracle.match(
      /creatures you control of the chosen type have\s+([^.]+)/i,
    );
    if (controlledChosenTypeAbilitiesMatch) {
      const abilities = parseAbilitiesFromTail(controlledChosenTypeAbilitiesMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'chosen-type-controlled-abilities',
          { kind: 'creatures_you_control', creatureType: chosenCreatureType },
          { abilities },
        ));
      }
    }

    const globalChosenTypeAbilitiesMatch = oracle.match(
      /creatures of the chosen type have\s+([^.]+)/i,
    );
    if (globalChosenTypeAbilitiesMatch) {
      const abilities = parseAbilitiesFromTail(globalChosenTypeAbilitiesMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'chosen-type-global-abilities',
          { kind: 'all_creatures_of_type', creatureType: chosenCreatureType },
          { abilities },
        ));
      }
    }
  }

  return specs;
}

export function staticEffectSpecHasPowerToughnessGrant(spec: StaticEffectSpec): boolean {
  const perCount = Number(spec.grant.power || 0) !== 0 || Number(spec.grant.toughness || 0) !== 0;
  return perCount;
}
