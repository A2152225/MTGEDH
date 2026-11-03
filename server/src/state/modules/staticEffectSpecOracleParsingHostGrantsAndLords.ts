// server/src/state/modules/staticEffectSpecOracleParsingHostGrantsAndLords.ts
// Split from staticEffectSpecOracleParsing.ts (R36): attached-host grants, ability grants, colour anthems and lords.
// Public entry symbols: pushAttachedHostKeywordGrants, pushAttachedHostTypeAdditions, pushAttachedHostProtectionGrant, pushChosenTypeAbilityGrantSpecs, pushAbilityGrantSpecs, pushColorAnthemSpecs, pushDynamicLordSpecs, pushLordSpecs.
import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { pushPairedAndGraveyardCountQuotedGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingPairedThresholdQuotedGrants.js';
import {
  parseAttachmentGrantedKeywordsFromOracle,
  parseAttachmentGrantedTypesFromOracle,
} from '../../../../shared/src/attachmentKeywordGrants.js';
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
import { pushR35CombatGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingR35CombatGrants.js';
import { pushSelfCombatConditionSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfCombatConditions.js';
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
import { pushConditionalScopedGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalScopedGrants.js';
import { splitStationThresholdLines, gateStationThresholdSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingStationThresholds.js';
import { pushTrekSelfStaticSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingTrekStatics.js';
import { pushGlobalGrantSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingGlobalGrants.js';
import { pushQualifiedScopeSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedScopes.js';
import { pushPhase5SupplementalSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingPhase5Supplement.js';

/** Lightning Greaves / Swiftfoot Boots: grant keywords to the equipped/enchanted host. */
export function pushAttachedHostKeywordGrants(
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

/** Angelic Destiny: "is an Angel in addition to its other types" on the enchanted host. */
export function pushAttachedHostTypeAdditions(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracleText: string,
): void {
  const attachedTo = String((perm as any).attachedTo || '').trim();
  if (!attachedTo) return;
  const typeAdditions = parseAttachmentGrantedTypesFromOracle(oracleText);
  if (typeAdditions.length === 0) return;
  specs.push({
    ...buildSpec(
      source,
      'attachment-type-host',
      { kind: 'self' },
      { typeAdditions },
    ),
    sourcePermanentId: attachedTo,
    scope: { kind: 'self' },
  });
}

/** Flickering Ward / White Ward: grant protection to the enchanted/equipped host, not the Aura. */
export function pushAttachedHostProtectionGrant(
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

export function pushChosenTypeAbilityGrantSpecs(
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

export function pushAbilityGrantSpecs(
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

export function pushColorAnthemSpecs(
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

export function pushDynamicLordSpecs(
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

export function pushLordSpecs(
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

