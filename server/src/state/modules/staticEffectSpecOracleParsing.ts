import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { parseAttachmentGrantedKeywordsFromOracle } from '../../../../shared/src/attachmentKeywordGrants.js';
import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';
import type { StaticEffectCountBasis, StaticEffectSpec } from './staticEffectSpec.js';
import { sanitizeOracleTextForStaticEffectScan } from '../../../../rules-engine/src/staticEffectOracleSanitize.js';
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
import { pushLoseKeywordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingLoseKeywords.js';
import { pushAttackYouTaxSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingAttackYouTax.js';
import { pushTypedAndKeywordLordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingTypedAndKeywordLords.js';
import { pushQuotedNumericAndBasePTLordSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingQuotedNumericBasePT.js';

/** Lightning Greaves / Swiftfoot Boots: grant keywords to the equipped/enchanted host. */
function pushAttachedHostKeywordGrants(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracleText: string,
): void {
  const attachedTo = String((perm as any).attachedTo || '').trim();
  if (!attachedTo) return;

  const granted = parseAttachmentGrantedKeywordsFromOracle(oracleText)
    .map((ability) => String(ability || '').trim().toLowerCase())
    .filter((ability) => ABILITY_WORDS.includes(ability));
  if (granted.length === 0) return;

  const duringYourTurn = /during your turn,?\s*(?:equipped|enchanted)\s+creature\s+has/i.test(oracleText);

  specs.push({
    ...buildSpec(
      source,
      'attachment-keyword-host',
      { kind: 'self' },
      { abilities: granted },
      duringYourTurn ? { kind: 'during_source_controller_turn' } : undefined,
    ),
    sourcePermanentId: attachedTo,
    scope: { kind: 'self' },
  });
}

/** Flickering Ward / White Ward: grant protection to the enchanted/equipped host, not the Aura. */
function pushAttachedHostProtectionGrant(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracle: string,
  chosenColor?: string,
): void {
  const attachedTo = String((perm as any).attachedTo || '').trim();
  if (!attachedTo) return;

  const match = oracle.match(
    /(?:enchanted (?:creature|permanent|land)|equipped creature) has protection from (the chosen colou?r|white|blue|black|red|green)/i,
  );
  if (!match) return;

  let color = String(match[1] || '').trim().toLowerCase();
  if (/chosen/.test(color)) {
    color = String(chosenColor || '').trim().toLowerCase();
  }
  if (!color || !COLOR_WORDS.includes(color)) return;

  specs.push({
    ...buildSpec(
      source,
      'attachment-protection-host',
      { kind: 'self' },
      { abilities: [`protection from ${color}`] },
    ),
    sourcePermanentId: attachedTo,
    scope: { kind: 'self' },
  });
}

function pushChosenTypeAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const chosenMatch = oracle.match(
    /other\s+([a-z]+)s?\s+(?:creatures?\s+)?you\s+control\s+get\s+(\+\d+\s*\/\s*\+\d+)\s+and\s+have\s+all\s+abilities\s+of\s+your\s+choice\s+among/i,
  );
  if (!chosenMatch) return;

  const creatureType = parseLordCreatureType(String(chosenMatch[1] || ''));
  const abilities = resolveChosenOptionsFromPermanent(perm);
  if (!creatureType || abilities.length === 0) return;

  specs.push(buildSpec(
    source,
    `other-${creatureType}-chosen-abilities`,
    { kind: 'other_creatures_you_control', creatureType },
    { abilities },
  ));
}

function pushAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushChosenTypeAbilityGrantSpecs(specs, source, perm, oracle);

  const shalaiStyleMatch = oracle.match(
    /you,?\s+planeswalkers you control,?\s+and\s+other\s+creatures you control have\s+([^.]+)/i,
  );
  if (shalaiStyleMatch) {
    const abilities = parseAbilitiesFromTail(shalaiStyleMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
      specs.push(buildSpec(
        source,
        'planeswalker-ability-grant',
        { kind: 'planeswalkers_you_control' },
        { abilities },
      ));
      pushPlayerAbilityGrantsFromList(specs, source, 'shalai-style', abilities);
    }
    return;
  }

  const youAndOtherMatch = oracle.match(/you and other creatures you control have\s+([^.]+)/i);
  if (youAndOtherMatch) {
    const abilities = parseAbilitiesFromTail(youAndOtherMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'you-and-other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
      pushPlayerAbilityGrantsFromList(specs, source, 'you-and-other', abilities);
    }
    return;
  }

  if (/abilities of your choice among/i.test(oracle)) {
    return;
  }

  const otherTypedAbilityMatch = oracle.match(
    /other\s+([a-z]+)\s+creatures?\s+you\s+control\s+have\s+([^.]+)/i,
  );
  if (otherTypedAbilityMatch) {
    const creatureType = parseLordCreatureType(String(otherTypedAbilityMatch[1] || ''));
    const abilities = parseAbilitiesFromTail(otherTypedAbilityMatch[2] || '');
    if (creatureType && isCreatureTypeWord(creatureType) && abilities.length > 0) {
      specs.push(buildSpec(
        source,
        `other-${creatureType}-ability-grant`,
        { kind: 'other_creatures_you_control', creatureType },
        { abilities },
      ));
      return;
    }
  }

  // "Other Dinosaurs you control have haste." — subtype without the word "creatures".
  const otherTypedNoCreatureWordMatch = oracle.match(
    /other\s+([a-z]+)s?\s+you\s+control\s+have\s+([^.]+)/i,
  );
  if (otherTypedNoCreatureWordMatch) {
    const creatureType = parseLordCreatureType(String(otherTypedNoCreatureWordMatch[1] || ''));
    const abilities = parseAbilitiesFromTail(otherTypedNoCreatureWordMatch[2] || '');
    if (creatureType && isCreatureTypeWord(creatureType) && abilities.length > 0) {
      specs.push(buildSpec(
        source,
        `other-${creatureType}-ability-grant`,
        { kind: 'other_creatures_you_control', creatureType },
        { abilities },
      ));
      return;
    }
  }

  const otherCreaturesAbilityMatch = oracle.match(/other creatures you control have ([^.]+)/i);
  if (otherCreaturesAbilityMatch) {
    const abilities = parseAbilitiesFromTail(otherCreaturesAbilityMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
    }
    return;
  }

  // "[Type] creatures you control have …" / "[color] creatures you control have …"
  // Must run before the unrestricted "creatures you control have" pattern, which would
  // otherwise match inside "Pegasus creatures you control have lifelink."
  const typedCreaturesAbilityMatch = oracle.match(
    /(?:^|[.\n;])\s*(?!other\s+)([a-z]+)\s+creatures you control have ([^.]+)/i,
  );
  if (typedCreaturesAbilityMatch) {
    const qualifier = String(typedCreaturesAbilityMatch[1] || '').toLowerCase();
    const abilities = parseAbilitiesFromTail(typedCreaturesAbilityMatch[2] || '');
    if (abilities.length > 0) {
      if (COLOR_WORDS.includes(qualifier)) {
        specs.push(buildSpec(
          source,
          `${qualifier}-creatures-ability-grant`,
          { kind: 'creatures_you_control' },
          { abilities },
          { kind: 'target_has_mana_color', color: qualifier },
        ));
      } else {
        const creatureType = parseLordCreatureType(qualifier);
        if (isCreatureTypeWord(creatureType)) {
          specs.push(buildSpec(
            source,
            `${creatureType}-creatures-ability-grant`,
            { kind: 'creatures_you_control', creatureType },
            { abilities },
          ));
        }
      }
    }
    return;
  }

  if (!/other creatures you control have/i.test(oracle) && !oracleHasGraveyardLandKeywordGrant(oracle)) {
    const creaturesAbilityMatch = oracle.match(/(?<![a-z] )(?<!legendary )(?:all )?creatures you control have ([^.]+)/i);
    if (creaturesAbilityMatch) {
      const abilities = parseAbilitiesFromTail(creaturesAbilityMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'creatures-ability-grant',
          { kind: 'creatures_you_control' },
          { abilities },
        ));
      }
    }
  }
}

function pushColorAnthemSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  for (const colorWord of COLOR_WORDS) {
    const match = oracle.match(new RegExp(`${colorWord}\\s+creatures\\s+get\\s+([+-]\\d+\\s*/\\s*[+-]\\d+)`, 'i'));
    if (!match) continue;
    const buff = parseBuffSegment(match[1]);
    if (!buff) continue;
    specs.push(buildSpec(
      source,
      `${colorWord}-creatures-anthem`,
      { kind: 'all_creatures' },
      { power: buff.power, toughness: buff.toughness },
      { kind: 'target_has_mana_color', color: colorWord },
    ));
  }
}

function pushDynamicLordSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  const coatMatch = oracle.match(
    /each creature gets \+(\d+)\/\+(\d+) for each other creature on the battlefield that shares at least one creature type with it/i,
  );
  if (coatMatch) {
    const power = parseInt(coatMatch[1], 10);
    const toughness = parseInt(coatMatch[2], 10);
    if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
      specs.push(buildSpec(
        source,
        'shared-type-dynamic-lord',
        { kind: 'all_creatures' },
        {
          power,
          toughness,
          countBasis: 'other_creatures_sharing_creature_type' satisfies StaticEffectCountBasis,
        },
      ));
    }
    return;
  }

  const sliverLegionMatch = oracle.match(
    /(?:all )?sliver creatures get \+(\d+)\/\+(\d+) for each other sliver on the battlefield/i,
  );
  if (sliverLegionMatch) {
    const power = parseInt(sliverLegionMatch[1], 10);
    const toughness = parseInt(sliverLegionMatch[2], 10);
    if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
      specs.push(buildSpec(
        source,
        'sliver-dynamic-lord',
        { kind: 'all_creatures_of_type', creatureType: 'sliver' },
        {
          power,
          toughness,
          countBasis: 'other_creatures_matching_scope' satisfies StaticEffectCountBasis,
        },
      ));
    }
  }
}

function pushLordSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  const deathBaronMatch = oracle.match(
    /skeletons you control and other zombies you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (deathBaronMatch) {
    const buff = parseBuffSegment(deathBaronMatch[1]);
    if (!buff) return;
    const abilities = parseLordAbilitiesFromTail(deathBaronMatch[2] || '');
    specs.push(buildSpec(
      source,
      'skeleton-lord',
      { kind: 'creatures_you_control', creatureType: 'skeleton' },
      { power: buff.power, toughness: buff.toughness, abilities },
    ));
    specs.push(buildSpec(
      source,
      'other-zombie-lord',
      { kind: 'other_creatures_you_control', creatureType: 'zombie' },
      { power: buff.power, toughness: buff.toughness, abilities },
    ));
    return;
  }

  const otherTypeMatch = oracle.match(
    /other\s+([a-z]+)s?\s+(?:creatures?\s+)?(?:you\s+control\s+)?get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (otherTypeMatch) {
    const creatureType = parseLordCreatureType(String(otherTypeMatch[1] || ''));
    const buff = parseBuffSegment(otherTypeMatch[2]);
    if (creatureType && isCreatureTypeWord(creatureType) && buff) {
      const hasYouControl = /you\s+control/i.test(otherTypeMatch[0]);
      specs.push(buildSpec(
        source,
        `other-${creatureType}-lord`,
        hasYouControl
          ? { kind: 'other_creatures_you_control', creatureType }
          : { kind: 'other_all_creatures_of_type', creatureType },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseLordAbilitiesFromTail(otherTypeMatch[3] || ''),
        },
      ));
    }
  }
}

/** Parse anthem/lord/conditional static P/T from battlefield oracle text (Phase 5.4). */
export function parseStaticEffectSpecsFromOraclePermanent(
  perm: BattlefieldPermanent,
): StaticEffectSpec[] {
  const oracleText = String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || '').trim();
  if (!oracleText) return [];

  const oracle = sanitizeOracleTextForStaticEffectScan(oracleText).toLowerCase();
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
  if (specs.length > 0) return specs;

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

  const legendaryMatch = oracle.match(/legendary creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
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

  const legendaryHaveMatch = oracle.match(/legendary creatures you control have\s+([^.]+)/i);
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

  const allCreaturesMatch = oracle.match(/all creatures get (\+\d+\s*\/\s*\+\d+)/i);
  // Inside an activated ability ("{2}, {T}: All creatures get +2/+2 for as long as ...", Thran Weaponry) it is a
  // one-shot effect handled by the Oracle IR executor (source-linked modifier), not a permanent anthem.
  const allCreaturesLinePrefix = allCreaturesMatch
    ? oracle.slice(0, allCreaturesMatch.index ?? 0).split('\n').pop() || ''
    : '';
  if (allCreaturesMatch && !allCreaturesLinePrefix.includes(':')) {
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
    /(?<!other )(?<!nontoken )(?<!nonblack )(?<!non[- ]?human )(?<!legendary )creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/i,
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
      ? oracle.match(/(?<!other )(?<!nontoken )(?<!nonblack )(?<!non[- ]?human )(?<!legendary )creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i)
      : null;
    if (anthemMatch) {
      const buff = parseBuffSegment(anthemMatch[1]);
      if (buff) {
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
  pushMassCantAttackBlockSpecs(specs, source, perm, oracle);
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
    if (/\b(?:this (?:creature|permanent|artifact)|it) is the chosen colou?r\b/i.test(oracle)) {
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

export function collectDeclarativeStaticSourcePermanentIds(specs: readonly StaticEffectSpec[]): Set<string> {
  const sourceIds = new Set<string>();
  for (const spec of specs) {
    const sourceId = String(spec.sourcePermanentId || '').trim();
    if (sourceId) sourceIds.add(sourceId);
  }
  return sourceIds;
}

export function collectDeclarativePtSourcePermanentIds(specs: readonly StaticEffectSpec[]): Set<string> {
  const sourceIds = new Set<string>();
  for (const spec of specs) {
    if (!staticEffectSpecHasPowerToughnessGrant(spec)) continue;
    const sourceId = String(spec.sourcePermanentId || '').trim();
    if (sourceId) sourceIds.add(sourceId);
  }
  return sourceIds;
}
