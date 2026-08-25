// server/src/rules-engine/targeting-handlers/targetingParseTargetRequirements.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: parseTargetRequirements plus exclusive graveyard-target helpers
//   it closed over (buildGraveyardCardTargetType, buildGraveyardCardTargetTypes,
//   normalizeGraveyardScope, buildGraveyardCardTargetDescription,
//   buildManaValueConstraintSuffix, buildManaValueConstraintFromClause,
//   parseTargetTypePhrase, GroupedTargetRequirement), and the intervening
//   matchesGraveyardCardTargetType / requiresTargeting declarations that sat
//   between those helpers.
// Public entry symbols: parseTargetRequirements, matchesGraveyardCardTargetType,
//   requiresTargeting, GroupedTargetRequirement.
// Stat/keyword filters live in targetingParseTargetRequirementRestrictions.ts.

import { inferManaValueConstraintFromText, type DynamicManaValueContext } from '../../state/modules/graveyard-mana-value.js';
import type { StatRequirement, TargetRestriction } from './targetingSpellSpecTypes.js';
import {
  attachParsedTargetRequirementStatKeywordFilters,
  parseTargetRequirementStatKeywordFilters,
  stripTargetTypeRestrictionSuffix,
} from './targetingParseTargetRequirementRestrictions.js';

export {
  parseTargetRequirementStatKeywordFilters,
  stripTargetTypeRestrictionSuffix,
  attachParsedTargetRequirementStatKeywordFilters,
  permanentMatchesTargetRequirementStatKeywordFilters,
} from './targetingParseTargetRequirementRestrictions.js';
export type { ParsedTargetRequirementStatKeywordFilters } from './targetingParseTargetRequirementRestrictions.js';

function buildGraveyardCardTargetType(rawTargetType: string | undefined): string {
  const normalized = String(rawTargetType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return normalized ? `graveyard_${normalized}_card` : 'graveyard_card';
}

function isPermanentCardTypeLine(typeLine: string): boolean {
  return typeLine.includes('artifact')
    || typeLine.includes('battle')
    || typeLine.includes('creature')
    || typeLine.includes('enchantment')
    || typeLine.includes('land')
    || typeLine.includes('planeswalker');
}

function escapeTargetTypeWord(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesCompoundGraveyardCardTargetType(typeLine: string, rawRequirement: string): boolean {
  const requirements = String(rawRequirement || '')
    .split('_')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (requirements.length === 0) {
    return false;
  }

  return requirements.every((requirement) => {
    switch (requirement) {
      case 'permanent':
        return isPermanentCardTypeLine(typeLine);
      case 'nonland':
        return !/\bland\b/i.test(typeLine);
      case 'noncreature':
        return !/\bcreature\b/i.test(typeLine);
      case 'historic':
        return /\bartifact\b/i.test(typeLine) || /\blegendary\b/i.test(typeLine) || /\bsaga\b/i.test(typeLine);
      default:
        return new RegExp(`\\b${escapeTargetTypeWord(requirement)}\\b`, 'i').test(typeLine);
    }
  });
}

export function matchesGraveyardCardTargetType(card: any, rawTargetType: string): boolean {
  const targetType = String(rawTargetType || '').trim().toLowerCase();
  const typeLine = String(card?.type_line || '').toLowerCase();

  // Generic non-<subtype> exclusion (e.g. "graveyard_non-dragon_creature_card",
  // "graveyard_non-zombie_card"). The subtype must NOT appear anywhere in the
  // card's type line; the remaining tokens (if any) form the base requirement.
  const nonSubtypeMatch = targetType.match(/^graveyard_non-([a-z][a-z0-9'-]*)(?:_(.+?))?_card$/);
  if (nonSubtypeMatch) {
    const excludedSubtype = String(nonSubtypeMatch[1] || '').toLowerCase();
    if (excludedSubtype && typeLine.includes(excludedSubtype)) return false;
    const remainder = String(nonSubtypeMatch[2] || '').trim();
    if (!remainder) return true;
    return matchesGraveyardCardTargetType(card, `graveyard_${remainder}_card`);
  }

  switch (targetType) {
    case 'graveyard_card':
      return true;
    case 'graveyard_permanent_card':
      return isPermanentCardTypeLine(typeLine);
    case 'graveyard_battle_card':
      return typeLine.includes('battle');
    case 'graveyard_creature_card':
      return typeLine.includes('creature');
    case 'graveyard_artifact_card':
      return typeLine.includes('artifact');
    case 'graveyard_enchantment_card':
      return typeLine.includes('enchantment');
    case 'graveyard_land_card':
      return typeLine.includes('land');
    case 'graveyard_instant_card':
      return typeLine.includes('instant');
    case 'graveyard_sorcery_card':
      return typeLine.includes('sorcery');
    case 'graveyard_planeswalker_card':
      return typeLine.includes('planeswalker');
    case 'graveyard_nonland_card':
      return !typeLine.includes('land');
    case 'graveyard_noncreature_card':
      return !typeLine.includes('creature');
    default:
      {
        const compoundMatch = targetType.match(/^graveyard_(.+)_card$/);
        if (!compoundMatch?.[1]) {
          return false;
        }
        return matchesCompoundGraveyardCardTargetType(typeLine, compoundMatch[1]);
      }
  }
}

function buildGraveyardCardTargetTypes(rawTargetType: string | undefined): string[] {
  const normalized = String(rawTargetType || '').trim().toLowerCase();
  if (!normalized) {
    return ['graveyard_card'];
  }

  const hasListSeparators = /,|\bor\b|\band\/or\b/i.test(normalized);
  if (!hasListSeparators) {
    return [buildGraveyardCardTargetType(normalized)];
  }

  const matchedTypes = Array.from(new Set(
    (normalized.match(/\b(?:permanent|battle|creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\b/g) || [])
      .map((piece) => piece.trim().toLowerCase())
      .filter(Boolean)
  ));

  if (matchedTypes.length === 0) {
    return [buildGraveyardCardTargetType(normalized)];
  }

  return matchedTypes.map((typeName) => buildGraveyardCardTargetType(typeName));
}

function normalizeGraveyardScope(rawScope: string | undefined): 'your' | 'any' {
  return String(rawScope || '').trim().toLowerCase() === 'your' ? 'your' : 'any';
}

function buildGraveyardCardTargetDescription(
  rawTargetType: string,
  scope: 'your' | 'any',
  prefix: string,
): string {
  const typeLabel = rawTargetType ? `${rawTargetType} card` : 'card';
  const graveyardLabel = scope === 'your' ? 'your graveyard' : 'a graveyard';
  return `${prefix} ${typeLabel} in ${graveyardLabel}`;
}

function buildManaValueConstraintSuffix(exactManaValue?: number, maxManaValue?: number, minManaValue?: number): string {
  if (typeof exactManaValue === 'number' && Number.isFinite(exactManaValue)) {
    return ` with mana value ${exactManaValue}`;
  }
  if (typeof maxManaValue === 'number' && Number.isFinite(maxManaValue)) {
    return ` with mana value ${maxManaValue} or less`;
  }
  if (typeof minManaValue === 'number' && Number.isFinite(minManaValue)) {
    return ` with mana value ${minManaValue} or greater`;
  }
  return '';
}

function buildManaValueConstraintFromClause(rawClause: string | undefined, context?: DynamicManaValueContext): { targetFilterExactManaValue?: number; targetFilterMinManaValue?: number; targetFilterMaxManaValue?: number } {
  const clauseText = String(rawClause || '').trim();
  if (!clauseText) {
    return {};
  }

  return inferManaValueConstraintFromText(clauseText, context);
}

const KNOWN_TARGET_TYPE_PATTERN = /\b(?:nonland\s+permanents?|noncreature\s+permanents?|noncreature\s+spells?|creature\s+spells?|instant\s+or\s+sorcery\s+spells?|instant\s+spells?|sorcery\s+spells?|nonland|noncreature|permanents?|creatures?|artifacts?|enchantments?|lands?|battles?|planeswalkers?|players?|opponents?|spells?)\b/gi;

function canonicalizeParsedTargetType(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

function parseTargetTypePhrase(rawTargetType: string | undefined): string[] {
  const normalized = stripTargetTypeRestrictionSuffix(String(rawTargetType || '')
    .toLowerCase()
    .replace(/\band\/or\b/g, 'or')
    .replace(/[.,]/g, ' ')
    .replace(/\btarget\b/g, ' ')
    .replace(/\bthat player controls\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());

  if (!normalized) return [];

  KNOWN_TARGET_TYPE_PATTERN.lastIndex = 0;
  const knownTypes = Array.from(new Set(
    (normalized.match(KNOWN_TARGET_TYPE_PATTERN) || [])
      .map((entry) => canonicalizeParsedTargetType(entry))
      .filter(Boolean),
  ));
  if (knownTypes.length > 0) return knownTypes;

  const pieces = normalized
    .split(/\s+or\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  return pieces.length > 0 ? pieces : [normalized];
}

/**
 * Detect if a spell requires targets based on oracle text
 * This is a comprehensive check that looks for ANY "target" pattern in the spell text
 * 
 * MTG Rules 601.2c: The player announces targets for the spell.
 * Targets must be chosen before costs are paid.
 */
export function requiresTargeting(oracleText?: string): boolean {
  if (!oracleText) return false;
  const t = oracleText.toLowerCase();
  
  // Skip if this is an enchant aura (handled separately)
  if (/^enchant\s+/.test(t)) return false;
  
  // Check for "target" keyword followed by a valid target type
  // This catches ALL spells that require targets
  const targetPatterns = [
    /target\s+(?:(?:tapped|untapped|attacking or blocking|attacking|blocking)\s+)?(?:creature|permanent|artifact|enchantment|land|battle|player|opponent|planeswalker)/i,
    /any\s+target/i,
    /target\s+spell/i,
    /target\s+(?:instant|sorcery)(?:\s+or\s+(?:instant|sorcery))?\s+spell/i,
    /counter\s+target\s+(?:instant|sorcery|spell|activated|triggered)/i,
    /target\s+(?:activated|triggered)\s+ability/i,
    /target\s+ability\b/i,
    /up\s+to\s+\w+\s+target/i,
    /target\s+(?:nonland|noncreature|nonartifact)/i,
    /target\s+(?:non\w+[\s,]+)+permanent/i,
    /each\s+target/i,
  ];
  
  return targetPatterns.some(pattern => pattern.test(t));
}

export interface GroupedTargetRequirement {
  readonly groupBy: 'controller';
  readonly groupPlayers: 'each_player' | 'each_opponent';
  readonly minTargetsPerGroup: number;
  readonly maxTargetsPerGroup: number;
  readonly maxGroups?: number;
}

/**
 * Parse target requirements from oracle text
 * Returns details about what types of targets are needed and how many
 */
export function parseTargetRequirements(oracleText?: string, options?: DynamicManaValueContext): {
  needsTargets: boolean;
  targetTypes: string[];
  minTargets: number;
  maxTargets: number;
  minTargetsIsX?: boolean;
  maxTargetsIsX?: boolean;
  targetDescription: string;
  groupedTargets?: GroupedTargetRequirement;
  perOpponent?: boolean;  // For "for each opponent, up to one target X that player controls"
  targetControllerConstraint?: 'opponent' | 'that_player' | 'you' | 'any';
  graveyardScope?: 'your' | 'any';
  targetFilterExactManaValue?: number;
  targetFilterMinManaValue?: number;
  targetFilterMaxManaValue?: number;
  targetTotalPowerLimit?: number;
  targetFilterExcludeTypes?: string[];
  targetRestriction?: TargetRestriction;
  statRequirement?: StatRequirement;
  creatureRestriction?: TargetRestriction;
} {
  if (!oracleText) return { needsTargets: false, targetTypes: [], minTargets: 0, maxTargets: 0, targetDescription: '' };
  
  const t = oracleText.toLowerCase();
  const xValue = typeof options?.xValue === 'number' && Number.isFinite(options.xValue)
    ? Number(options.xValue)
    : undefined;
  const manaValueContext: DynamicManaValueContext = {
    ...(options || {}),
    ...(typeof xValue === 'number' ? { xValue } : null),
  };
  const targetTypes: string[] = [];
  let minTargets = 0;
  let maxTargets = 0;
  let targetDescription = '';
  const statKeywordFilters = parseTargetRequirementStatKeywordFilters(oracleText);
  const finish = <T extends { needsTargets: boolean }>(result: T) =>
    attachParsedTargetRequirementStatKeywordFilters(result, statKeywordFilters);

  const parseGroupedTargetPhrase = (
    rawTargetPhrase: string,
  ): { targetTypes: string[]; excludeTypes: string[] } => {
    const normalized = String(rawTargetPhrase || '').trim().toLowerCase();
    const excludeTypes = Array.from(
      normalized.matchAll(/\bnon(artifact|creature|enchantment|land|planeswalker)\b/g),
    ).map((match) => String(match[1]));
    const positivePhrase = normalized
      .replace(/\bnon(?:artifact|creature|enchantment|land|planeswalker)\b[\s,]*/g, '')
      .trim();
    const parsedTypes = stripTargetTypeRestrictionSuffix(positivePhrase)
      .split(/\s+or\s+/)
      .map((type) => type.trim())
      .filter(Boolean);
    return {
      targetTypes: parsedTypes.length > 0 ? parsedTypes : ['permanent'],
      excludeTypes,
    };
  };
  
  // Check for "Choose any number of target opponents" pattern (Strive spells like Call the Coppercoats)
  // Pattern: "choose any number of target opponents" - can target 0 or more opponents
  const anyNumberOpponentsMatch = t.match(/choose\s+any\s+number\s+of\s+target\s+opponents?/i);
  if (anyNumberOpponentsMatch) {
    minTargets = 0; // "any number" means minimum is 0
    maxTargets = 999; // Effectively unlimited (bounded by number of opponents)
    targetTypes.push('opponent');
    targetDescription = 'any number of target opponents';
    return { 
      needsTargets: true, 
      targetTypes, 
      minTargets, 
      maxTargets, 
      targetDescription,
      targetControllerConstraint: 'opponent',
    };
  }

  const anyNumberGraveyardTotalPowerMatch = t.match(/any\s+number\s+of\s+target\s+(?:(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+with\s+total\s+power\s+(\d+)\s+or\s+less\s+from\s+(your|a|any)\s+graveyard/i);
  if (anyNumberGraveyardTotalPowerMatch) {
    const rawTargetType = String(anyNumberGraveyardTotalPowerMatch[1] || '').trim().toLowerCase();
    const totalPowerLimit = Number.parseInt(String(anyNumberGraveyardTotalPowerMatch[2] || ''), 10);
    const scope = normalizeGraveyardScope(anyNumberGraveyardTotalPowerMatch[3]);
    minTargets = 0;
    maxTargets = 99;
    targetTypes.push(buildGraveyardCardTargetType(rawTargetType));
    targetDescription = `any number of target ${rawTargetType ? `${rawTargetType} ` : ''}cards with total power ${totalPowerLimit} or less from ${scope === 'your' ? 'your' : 'a'} graveyard`;
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, graveyardScope: scope, ...(Number.isFinite(totalPowerLimit) ? { targetTotalPowerLimit: totalPowerLimit } : {}) };
  }

  const anyNumberTargetsMatch = t.match(/(?:choose\s+)?any\s+number\s+of\s+target\s+([^.]+)/i);
  if (anyNumberTargetsMatch) {
    const targetPhrase = anyNumberTargetsMatch[1].trim();
    const normalizedTargetPhrase = targetPhrase
      .replace(/\beach\b/g, '')
      .replace(/\buntil end of turn\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    minTargets = 0;
    maxTargets = 999;

    if (/\bopponents?\b/i.test(normalizedTargetPhrase)) {
      targetTypes.push('opponent');
      targetDescription = `any number of target ${normalizedTargetPhrase}`;
      return {
        needsTargets: true,
        targetTypes,
        minTargets,
        maxTargets,
        targetDescription,
        targetControllerConstraint: 'opponent',
      };
    }

    if (/\bcreatures?\b/i.test(normalizedTargetPhrase)) {
      targetTypes.push('creature');
    } else if (/\bartifacts?\b/i.test(normalizedTargetPhrase)) {
      targetTypes.push('artifact');
    } else if (/\benchantments?\b/i.test(normalizedTargetPhrase)) {
      targetTypes.push('enchantment');
    } else if (/\bpermanents?\b/i.test(normalizedTargetPhrase)) {
      targetTypes.push('permanent');
    } else {
      targetTypes.push(normalizedTargetPhrase.replace(/\s+you control|\s+an opponent controls|\s+with different controllers/g, '').trim());
    }

    targetDescription = `any number of target ${normalizedTargetPhrase}`;
    return finish({
      needsTargets: true,
      targetTypes,
      minTargets,
      maxTargets,
      targetDescription,
      targetControllerConstraint: /\byou control\b/i.test(normalizedTargetPhrase)
        ? 'you'
        : (/\ban opponent controls\b/i.test(normalizedTargetPhrase) ? 'opponent' : 'any'),
    });
  }
  
  // Generic grouped controller targeting:
  // "For each player/opponent, choose target ... that player controls."
  const groupedExactMatch = t.match(
    /for each (player|opponent),?\s+(?:choose\s+)?(?:destroy|exile|return|tap|untap)?\s*target\s+([^.]+?)\s+that\s+player\s+controls/i,
  );
  if (groupedExactMatch) {
    const groupPlayers = groupedExactMatch[1] === 'player' ? 'each_player' : 'each_opponent';
    const targetPhrase = groupedExactMatch[2].trim();
    const parsed = parseGroupedTargetPhrase(targetPhrase);
    return finish({
      needsTargets: true,
      targetTypes: parsed.targetTypes,
      minTargets: 1,
      maxTargets: 1,
      targetDescription: `for each ${groupedExactMatch[1]}, target ${targetPhrase} that player controls`,
      groupedTargets: {
        groupBy: 'controller',
        groupPlayers,
        minTargetsPerGroup: 1,
        maxTargetsPerGroup: 1,
      },
      ...(groupPlayers === 'each_opponent' ? { perOpponent: true } : {}),
      targetControllerConstraint: 'that_player',
      ...(parsed.excludeTypes.length > 0 ? { targetFilterExcludeTypes: parsed.excludeTypes } : {}),
    });
  }

  const groupedUpToMatch = t.match(
    /for each (player|opponent),?\s+(?:choose\s+)?(?:destroy|exile|return|tap|untap)?\s*up\s+to\s+(\w+)\s+target\s+([^.]+?)\s+that\s+player\s+controls/i,
  );
  if (groupedUpToMatch) {
    const groupPlayers = groupedUpToMatch[1] === 'player' ? 'each_player' : 'each_opponent';
    const numWord = groupedUpToMatch[2];
    const targetPhrase = groupedUpToMatch[3].trim();
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const maxPerGroup = numMap[numWord] || parseInt(numWord, 10) || 1;
    const parsed = parseGroupedTargetPhrase(targetPhrase);
    return finish({
      needsTargets: true,
      targetTypes: parsed.targetTypes,
      minTargets: 0,
      maxTargets: maxPerGroup,
      targetDescription: `for each ${groupedUpToMatch[1]}, up to ${numWord} target ${targetPhrase} that player controls`,
      groupedTargets: {
        groupBy: 'controller',
        groupPlayers,
        minTargetsPerGroup: 0,
        maxTargetsPerGroup: maxPerGroup,
      },
      ...(groupPlayers === 'each_opponent' ? { perOpponent: true } : {}),
      targetControllerConstraint: 'that_player',
      ...(parsed.excludeTypes.length > 0 ? { targetFilterExcludeTypes: parsed.excludeTypes } : {}),
    });
  }

  // Legacy "for each opponent, X target Y that player controls" patterns.
  // Examples:
  // - "For each opponent, destroy up to one target artifact or enchantment that player controls."
  // - "For each opponent, exile target creature that player controls."
  const perOpponentMatch = t.match(/for each opponent,?\s+(?:destroy|exile|return|tap|untap)?\s*up\s+to\s+(\w+)\s+target\s+([^.]+?)\s+that\s+player\s+controls/i);
  if (perOpponentMatch) {
    const numWord = perOpponentMatch[1];
    const targetType = perOpponentMatch[2].trim();
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const targetsPerOpponent = numMap[numWord] || parseInt(numWord, 10) || 1;
    // For "up to", min is 0
    minTargets = 0;
    maxTargets = targetsPerOpponent;
    // Parse the target type (e.g., "artifact or enchantment")
    const types = targetType.split(/\s+or\s+/);
    for (const type of types) {
      targetTypes.push(type.trim());
    }
    targetDescription = `for each opponent, up to ${numWord} target ${targetType} that player controls`;
    return finish({
      needsTargets: true,
      targetTypes,
      minTargets,
      maxTargets,
      targetDescription,
      groupedTargets: {
        groupBy: 'controller',
        groupPlayers: 'each_opponent',
        minTargetsPerGroup: 0,
        maxTargetsPerGroup: targetsPerOpponent,
      },
      perOpponent: true,
      targetControllerConstraint: 'that_player',
    });
  }
  
  // Check for "for each opponent, target X that player controls" (exact one, not "up to")
  const perOpponentExactMatch = t.match(/for each opponent,?\s+(?:destroy|exile|return|tap|untap)?\s*target\s+([^.]+?)\s+that\s+player\s+controls/i);
  if (perOpponentExactMatch) {
    const targetType = perOpponentExactMatch[1].trim();
    minTargets = 1;
    maxTargets = 1;
    const types = targetType.split(/\s+or\s+/);
    for (const type of types) {
      targetTypes.push(type.trim());
    }
    targetDescription = `for each opponent, target ${targetType} that player controls`;
    return finish({
      needsTargets: true, 
      targetTypes, 
      minTargets, 
      maxTargets, 
      targetDescription,
      groupedTargets: {
        groupBy: 'controller',
        groupPlayers: 'each_opponent',
        minTargetsPerGroup: 1,
        maxTargetsPerGroup: 1,
      },
      perOpponent: true,
      targetControllerConstraint: 'that_player',
    });
  }

  // Check for graveyard-to-hand card targeting on activated abilities.
  // Examples:
  // - "Return target creature card from your graveyard to your hand."
  // - "Return up to one target artifact card from your graveyard to your hand."
  const graveyardUpToMatch = t.match(/up\s+to\s+(\w+)\s+target\s+(?:(.+?)\s+)?card((?:\s+with\s+mana\s+value\s+.+?)?)\s+(?:from|in)\s+(?:your\s+)?graveyard\s+to\s+your\s+hand/i);
  if (graveyardUpToMatch) {
    const numWord = String(graveyardUpToMatch[1] || '').toLowerCase();
    const rawTargetType = String(graveyardUpToMatch[2] || '').trim().toLowerCase();
    const manaValueConstraint = buildManaValueConstraintFromClause(graveyardUpToMatch[3], manaValueContext);
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    maxTargets = numMap[numWord] || parseInt(numWord, 10) || 1;
    minTargets = 0;
    targetTypes.push(...buildGraveyardCardTargetTypes(rawTargetType));
    targetDescription = buildGraveyardCardTargetDescription(rawTargetType, 'your', `up to ${numWord} target`) + buildManaValueConstraintSuffix(manaValueConstraint.targetFilterExactManaValue, manaValueConstraint.targetFilterMaxManaValue, manaValueConstraint.targetFilterMinManaValue);
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, graveyardScope: 'your', ...manaValueConstraint };
  }

  const graveyardMatch = t.match(/target\s+(?:(.+?)\s+)?card((?:\s+with\s+mana\s+value\s+.+?)?)\s+(?:from|in)\s+(?:your\s+)?graveyard\s+to\s+your\s+hand/i);
  if (graveyardMatch) {
    const rawTargetType = String(graveyardMatch[1] || '').trim().toLowerCase();
    const manaValueConstraint = buildManaValueConstraintFromClause(graveyardMatch[2], manaValueContext);
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push(...buildGraveyardCardTargetTypes(rawTargetType));
    targetDescription = buildGraveyardCardTargetDescription(rawTargetType, 'your', 'target') + buildManaValueConstraintSuffix(manaValueConstraint.targetFilterExactManaValue, manaValueConstraint.targetFilterMaxManaValue, manaValueConstraint.targetFilterMinManaValue);
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, graveyardScope: 'your', ...manaValueConstraint };
  }

  const anyGraveyardUpToMatch = t.match(/up\s+to\s+(\w+)\s+target\s+(?:(.+?)\s+)?card((?:\s+with\s+mana\s+value\s+.+?)?)\s+(?:from|in)\s+(your|a|any|an\s+opponent['’]?s?)\s+graveyard/i);
  if (anyGraveyardUpToMatch) {
    const numWord = String(anyGraveyardUpToMatch[1] || '').toLowerCase();
    const rawTargetType = String(anyGraveyardUpToMatch[2] || '').trim().toLowerCase();
    const manaValueConstraint = buildManaValueConstraintFromClause(anyGraveyardUpToMatch[3], manaValueContext);
    const scope = normalizeGraveyardScope(anyGraveyardUpToMatch[4]);
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    maxTargets = numMap[numWord] || parseInt(numWord, 10) || 1;
    minTargets = 0;
    targetTypes.push(...buildGraveyardCardTargetTypes(rawTargetType));
    targetDescription = buildGraveyardCardTargetDescription(rawTargetType, scope, `up to ${numWord} target`) + buildManaValueConstraintSuffix(manaValueConstraint.targetFilterExactManaValue, manaValueConstraint.targetFilterMaxManaValue, manaValueConstraint.targetFilterMinManaValue);
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, graveyardScope: scope, ...manaValueConstraint };
  }

  const anyGraveyardMatch = t.match(/target\s+(?:(.+?)\s+)?card((?:\s+with\s+mana\s+value\s+.+?)?)\s+(?:from|in)\s+(your|a|any|an\s+opponent['’]?s?)\s+graveyard/i);
  if (anyGraveyardMatch) {
    const rawTargetType = String(anyGraveyardMatch[1] || '').trim().toLowerCase();
    const manaValueConstraint = buildManaValueConstraintFromClause(anyGraveyardMatch[2], manaValueContext);
    const scope = normalizeGraveyardScope(anyGraveyardMatch[3]);
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push(...buildGraveyardCardTargetTypes(rawTargetType));
    targetDescription = buildGraveyardCardTargetDescription(rawTargetType, scope, 'target') + buildManaValueConstraintSuffix(manaValueConstraint.targetFilterExactManaValue, manaValueConstraint.targetFilterMaxManaValue, manaValueConstraint.targetFilterMinManaValue);
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, graveyardScope: scope, ...manaValueConstraint };
  }
  
  // Check for "up to X target" patterns
  const upToMatch = t.match(/up\s+to\s+(\w+)\s+target\s+([^.]+?)(?:\s+that\s+player\s+controls|\.|,|$)/i);
  if (upToMatch) {
    const numWord = String(upToMatch[1] || '').toLowerCase();
    const rawTargetType = String(upToMatch[2] || '').trim().toLowerCase();
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const isXCount = numWord === 'x';
    maxTargets = isXCount ? 0 : (numMap[numWord] || parseInt(numWord, 10) || 1);
    minTargets = 0; // "up to" means minimum is 0
    targetTypes.push(...parseTargetTypePhrase(rawTargetType));
    targetDescription = `up to ${numWord} target ${rawTargetType}`;
    return finish({ needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription, ...(isXCount ? { maxTargetsIsX: true } : {}) });
  }
  
  // Check for "X target" patterns (e.g., "two target creatures")
  const multiTargetMatch = t.match(/(\w+)\s+target\s+([^.]+?)(?:\.|,|$)/i);
  if (multiTargetMatch) {
    const numWord = String(multiTargetMatch[1] || '').toLowerCase();
    const rawTargetType = String(multiTargetMatch[2] || '').trim().toLowerCase();
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const isXCount = numWord === 'x';
    const num = isXCount ? 0 : (numMap[numWord] || parseInt(numWord, 10));
    if (isXCount || (num && num > 0)) {
      minTargets = isXCount ? 0 : num;
      maxTargets = isXCount ? 0 : num;
      targetTypes.push(...parseTargetTypePhrase(rawTargetType));
      targetDescription = `${numWord} target ${rawTargetType}`;
      return finish({
        needsTargets: true,
        targetTypes,
        minTargets,
        maxTargets,
        targetDescription,
        ...(isXCount ? { minTargetsIsX: true, maxTargetsIsX: true } : {}),
      });
    }
  }
  
  // Check for "any target" (can target creatures, planeswalkers, or players)
  if (/any\s+target/i.test(t)) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push('any');
    targetDescription = 'any target';
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }

  const nonSubtypeCreatureTargetMatch = t.match(/target\s+non-([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature(?:\s+(you\s+control|an\s+opponent\s+controls))?/i);
  if (nonSubtypeCreatureTargetMatch) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push('creature');
    const excludedTypes = String(nonSubtypeCreatureTargetMatch[1] || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
    const scope = String(nonSubtypeCreatureTargetMatch[2] || '').trim().toLowerCase();
    targetDescription = `target non-${String(nonSubtypeCreatureTargetMatch[1] || '').trim()} creature${scope ? ` ${scope}` : ''}`;
    return finish({
      needsTargets: true,
      targetTypes,
      minTargets,
      maxTargets,
      targetDescription,
      targetFilterExcludeTypes: excludedTypes,
      ...(scope === 'you control' ? { targetControllerConstraint: 'you' as const } : {}),
      ...(scope === 'an opponent controls' ? { targetControllerConstraint: 'opponent' as const } : {}),
    });
  }
  
  // Comma/or multi-type lists (Atraxa's Fall, Nature's Claim). Must run before
  // the first-type-only "target artifact" match.
  const multiPermanentTypeMatch = t.match(
    /target\s+((?:(?:non(?:land|creature)\s+)?(?:artifact|battle|enchantment|creature|land|planeswalker|permanent)s?(?:\s*,?\s+or\s+|\s+and\/or\s+|\s*,\s*))+(?:(?:non(?:land|creature)\s+)?(?:artifact|battle|enchantment|creature|land|planeswalker|permanent)s?))(?:\s+with\b[^.]+)?/i,
  );
  if (multiPermanentTypeMatch) {
    const parsedTypes = parseTargetTypePhrase(multiPermanentTypeMatch[1]);
    if (parsedTypes.length > 1) {
      minTargets = 1;
      maxTargets = 1;
      targetTypes.push(...parsedTypes);
      targetDescription = `target ${String(multiPermanentTypeMatch[1] || '').trim()}`;
      return finish({ needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription });
    }
  }

  // Check for standard "target X" patterns
  // Include counterspell subjects: "target noncreature spell", "target creature spell", "target spell"
  // Prefixes (tapped / attacking or blocking / …) are stripped into targetRestriction.
  const targetMatch = t.match(/target\s+(?:(?:tapped|untapped|attacking or blocking|attacking|blocking)\s+)?(creature|permanent|artifact|enchantment|land|battle|player|opponent|planeswalker|spell|nonland\s+permanent|noncreature\s+permanent|noncreature\s+spell|creature\s+spell|instant\s+or\s+sorcery\s+spell|instant\s+spell|sorcery\s+spell)(?:\s+(you\s+control|an\s+opponent\s+controls))?/i);
  if (targetMatch) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push(targetMatch[1]);
    const scope = String(targetMatch[2] || '').trim().toLowerCase();
    targetDescription = `target ${targetMatch[1]}${scope ? ` ${scope}` : ''}`;
    return finish({
      needsTargets: true,
      targetTypes,
      minTargets,
      maxTargets,
      targetDescription,
      ...(scope === 'you control' ? { targetControllerConstraint: 'you' as const } : {}),
      ...(scope === 'an opponent controls' ? { targetControllerConstraint: 'opponent' as const } : {}),
    });
  }
  
  // Check for "target activated or triggered ability"
  if (/target\s+(?:activated|triggered)\s+ability/i.test(t)) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push('ability');
    targetDescription = 'target ability';
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }
  
  return { needsTargets: false, targetTypes: [], minTargets: 0, maxTargets: 0, targetDescription: '' };
}
