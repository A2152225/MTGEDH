// server/src/rules-engine/targeting-handlers/targetingParseTargetRequirementRestrictions.ts
// Origin parent: server/src/rules-engine/targeting-handlers/targetingParseTargetRequirements.ts
// Cluster: SpellSpec-aligned filters that categorize already encodes
//   (has_keyword, power/toughness, tapped/attacked/entered/damage-this-turn)
//   but parseTargetRequirements omitted, so IR-primary cast-time lists were
//   broader than evaluateTargeting. Matching mirrors targeting.ts cases;
//   do not rewrite targeting.ts.
// Public entry symbols: parseTargetRequirementStatKeywordFilters,
//   stripTargetTypeRestrictionSuffix, attachParsedTargetRequirementStatKeywordFilters,
//   permanentMatchesTargetRequirementStatKeywordFilters,
//   ParsedTargetRequirementStatKeywordFilters.

import type { StatRequirement, TargetRestriction } from './targetingSpellSpecTypes.js';

// Same keyword set categorize uses for "target creature with [keyword]".
const PARSED_TARGET_KEYWORD_ABILITIES = [
  'double strike',
  'first strike',
  'indestructible',
  'deathtouch',
  'lifelink',
  'vigilance',
  'hexproof',
  'trample',
  'menace',
  'flying',
  'reach',
  'haste',
] as const;

export type ParsedTargetRequirementStatKeywordFilters = {
  targetRestriction?: TargetRestriction;
  statRequirement?: StatRequirement;
  creatureRestriction?: TargetRestriction;
};

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHasKeywordRestriction(keyword: string): TargetRestriction {
  return {
    type: 'has_keyword',
    description: `with ${keyword}`,
    keyword,
  };
}

function buildStatusRestriction(type: TargetRestriction['type'], description: string): TargetRestriction {
  return { type, description };
}

/**
 * Encode categorize-owned stat/keyword/status target filters onto parsed reqs.
 * Uses dedicated SpellSpec fields (not a targetTypes suffix) so type matching
 * stays "creature" / "permanent" while evaluateTargeting-style filters travel
 * with the reqs.
 */
export function parseTargetRequirementStatKeywordFilters(oracleText?: string): ParsedTargetRequirementStatKeywordFilters {
  const t = String(oracleText || '').toLowerCase();
  if (!t) return {};

  // Atraxa's Fall: flying applies only to the creature branch of the multi-type list.
  if (/artifact,?\s+battle,?\s+enchantment,?\s+or creature with flying/.test(t)) {
    return { creatureRestriction: buildHasKeywordRestriction('flying') };
  }

  const result: ParsedTargetRequirementStatKeywordFilters = {};

  const compoundStatMatch = t.match(/target (?:attacking or blocking )?(?:creatures?|permanents?) with power or toughness (\d+) or (greater|less)/i);
  const toughnessMatch = t.match(/target (?:attacking or blocking )?(?:creatures?|permanents?) with toughness (\d+) or (greater|less)/i);
  const powerMatch = t.match(/target (?:attacking or blocking )?(?:creatures?|permanents?) with power (\d+) or (greater|less)/i);
  if (compoundStatMatch) {
    result.statRequirement = {
      stat: 'power',
      orStat: 'toughness',
      comparison: compoundStatMatch[2] === 'greater' ? '>=' : '<=',
      value: Number.parseInt(compoundStatMatch[1], 10),
    };
  } else if (toughnessMatch) {
    result.statRequirement = {
      stat: 'toughness',
      comparison: toughnessMatch[2] === 'greater' ? '>=' : '<=',
      value: Number.parseInt(toughnessMatch[1], 10),
    };
  } else if (powerMatch) {
    result.statRequirement = {
      stat: 'power',
      comparison: powerMatch[2] === 'greater' ? '>=' : '<=',
      value: Number.parseInt(powerMatch[1], 10),
    };
  }

  // Mirror targetingCategorizeDamageFlickerRestrictions "target X that..." order.
  const dealtDamageToYouMatch = t.match(/target (?:creature|permanent) that dealt (?:combat )?damage to you this turn/i);
  if (dealtDamageToYouMatch) {
    const isCombatOnly = /combat damage to you this turn/i.test(t);
    result.targetRestriction = buildStatusRestriction(
      isCombatOnly ? 'dealt_combat_damage_to_you_this_turn' : 'dealt_damage_to_you_this_turn',
      isCombatOnly ? 'that dealt combat damage to you this turn' : 'that dealt damage to you this turn',
    );
  } else if (/target attacking or blocking (?:creature|permanent)/i.test(t)) {
    result.targetRestriction = buildStatusRestriction('attacked_or_blocked_this_turn', 'that is attacking or blocking');
  } else if (/target (?:creature|permanent) that attacked this turn/i.test(t) || /target attacking (?:creature|permanent)/i.test(t)) {
    const isCurrentlyAttacking = /target attacking (?:creature|permanent)/i.test(t);
    result.targetRestriction = buildStatusRestriction(
      'attacked_this_turn',
      isCurrentlyAttacking ? 'that is attacking' : 'that attacked this turn',
    );
  } else if (/target (?:creature|permanent) that blocked this turn/i.test(t) || /target blocking (?:creature|permanent)/i.test(t)) {
    const isCurrentlyBlocking = /target blocking (?:creature|permanent)/i.test(t);
    result.targetRestriction = buildStatusRestriction(
      'blocked_this_turn',
      isCurrentlyBlocking ? 'that is blocking' : 'that blocked this turn',
    );
  } else if (/target (?:creature|permanent) that entered(?: (?:the )?battlefield)? this turn/i.test(t)) {
    result.targetRestriction = buildStatusRestriction('entered_this_turn', 'that entered this turn');
  } else if (/target tapped (?:creature|permanent)/i.test(t)) {
    result.targetRestriction = buildStatusRestriction('tapped', 'that is tapped');
  } else if (/target untapped (?:creature|permanent)/i.test(t)) {
    result.targetRestriction = buildStatusRestriction('untapped', 'that is untapped');
  } else if (
    /cast (?:this spell )?only during an opponent's turn/i.test(t)
    && /target (?:creature|permanent) that player controls/i.test(t)
  ) {
    result.targetRestriction = buildStatusRestriction(
      'controlled_by_active_player',
      'controlled by the opponent whose turn it is',
    );
  }

  if (!result.targetRestriction) {
    for (const keyword of PARSED_TARGET_KEYWORD_ABILITIES) {
      const keywordPattern = new RegExp(`\\btarget\\b[\\s\\S]{0,80}?\\bwith\\s+${escapeRegExp(keyword)}\\b`, 'i');
      if (keywordPattern.test(t)) {
        result.targetRestriction = buildHasKeywordRestriction(keyword);
        break;
      }
    }
  }

  return result;
}

/** Keep targetTypes as card types; drop "with flying" / "with power N or greater". */
export function stripTargetTypeRestrictionSuffix(rawTargetType: string | undefined): string {
  let text = String(rawTargetType || '').trim();
  if (!text) return '';
  text = text.replace(/\bwith\s+(?:power or toughness|power|toughness)\s+\d+\s+or\s+(?:greater|less)\b/gi, ' ');
  text = text.replace(/\bthat dealt (?:combat )?damage to you this turn\b/gi, ' ');
  text = text.replace(/\bthat (?:attacked|blocked) this turn\b/gi, ' ');
  text = text.replace(/\bthat entered(?: (?:the )?battlefield)? this turn\b/gi, ' ');
  text = text.replace(/\b(?:attacking or blocking|untapped|tapped|attacking|blocking)\b/gi, ' ');
  for (const keyword of PARSED_TARGET_KEYWORD_ABILITIES) {
    text = text.replace(new RegExp(`\\bwith\\s+${escapeRegExp(keyword)}\\b`, 'gi'), ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function attachParsedTargetRequirementStatKeywordFilters<T extends object>(
  result: T,
  filters: ParsedTargetRequirementStatKeywordFilters,
): T & ParsedTargetRequirementStatKeywordFilters {
  if (!filters.targetRestriction && !filters.statRequirement && !filters.creatureRestriction) {
    return result as T & ParsedTargetRequirementStatKeywordFilters;
  }
  return { ...result, ...filters };
}

function readPermanentStat(permanent: any, stat: 'power' | 'toughness'): number {
  const card = permanent?.card || {};
  const raw = stat === 'power'
    ? (permanent?.effectivePower ?? card?.power)
    : (permanent?.effectiveToughness ?? card?.toughness);
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function comparisonHolds(statValue: number, comparison: StatRequirement['comparison'], value: number): boolean {
  switch (comparison) {
    case '>=': return statValue >= value;
    case '<=': return statValue <= value;
    case '>': return statValue > value;
    case '<': return statValue < value;
    case '=': return statValue === value;
    default: return true;
  }
}

function permanentMeetsStatRequirement(permanent: any, req: StatRequirement): boolean {
  const primary = comparisonHolds(readPermanentStat(permanent, req.stat), req.comparison, req.value);
  if (!req.orStat) return primary;
  return primary || comparisonHolds(readPermanentStat(permanent, req.orStat), req.comparison, req.value);
}

/**
 * Mirrors evaluateTargeting's has_keyword case (keywords array, oracle word
 * boundary, aura/equipment "has [keyword]" grants). Do not rewrite targeting.ts
 * for this; the IR-primary list builder cannot call categorize.
 */
function permanentMeetsHasKeyword(permanent: any, state: any, keywordRaw: string | undefined): boolean {
  const keyword = String(keywordRaw || '').toLowerCase();
  if (!keyword) return true;

  const cardKeywords = permanent?.card?.keywords || [];
  if (Array.isArray(cardKeywords) && cardKeywords.some((entry: string) => typeof entry === 'string' && entry.toLowerCase() === keyword)) {
    return true;
  }

  const oracleText = String(permanent?.card?.oracle_text || '');
  const keywordPattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
  if (keywordPattern.test(oracleText)) return true;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const permanentId = String(permanent?.id || '');
  const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapeRegExp(keyword)}`, 'i');
  for (const attachment of battlefield) {
    if (String(attachment?.attachedTo || '') !== permanentId) continue;
    if (grantsKeywordPattern.test(String(attachment?.card?.oracle_text || ''))) return true;
  }
  return false;
}

function listedNonCreatureTargetTypes(filters: ParsedTargetRequirementStatKeywordFilters | null | undefined): string[] {
  const targetTypes = Array.isArray((filters as { targetTypes?: unknown[] } | null | undefined)?.targetTypes)
    ? (filters as { targetTypes?: unknown[] }).targetTypes || []
    : [];
  return targetTypes
    .map((entry) => String(entry || '').toLowerCase().trim())
    .filter((entry) => entry && entry !== 'creature');
}

/**
 * Mirrors evaluateTargeting's TargetRestrictionType cases. Caster is the
 * player choosing targets (damage-this-turn tracker key).
 */
function permanentMeetsTargetRestriction(
  permanent: any,
  state: any,
  restriction: TargetRestriction,
  casterId?: string,
): boolean {
  switch (restriction.type) {
    case 'dealt_damage_to_you_this_turn':
    case 'dealt_combat_damage_to_you_this_turn': {
      const caster = String(casterId || '');
      if (!caster) return false;
      const damageTracker = state?.creaturesThatDealtDamageToPlayer?.[caster];
      return !!(damageTracker && damageTracker[permanent?.id]);
    }
    case 'attacked_this_turn':
      return !!(permanent?.attacking || permanent?.attackedThisTurn);
    case 'attacked_or_blocked_this_turn':
      return !!(
        permanent?.attacking
        || permanent?.attackedThisTurn
        || permanent?.blocking
        || permanent?.blockedThisTurn
      );
    case 'blocked_this_turn':
      return !!(permanent?.blocking || permanent?.blockedThisTurn);
    case 'entered_this_turn':
      return !!permanent?.enteredThisTurn;
    case 'tapped':
      return !!permanent?.tapped;
    case 'untapped':
      return !permanent?.tapped;
    case 'controlled_by_active_player': {
      const activePlayerId = state?.turnPlayer
        || state?.players?.[state?.activePlayerIndex || 0]?.id;
      return String(permanent?.controller || '') === String(activePlayerId || '');
    }
    case 'has_keyword':
      return permanentMeetsHasKeyword(permanent, state, restriction.keyword);
    default:
      return true;
  }
}

export function permanentMatchesTargetRequirementStatKeywordFilters(
  permanent: any,
  state: any,
  filters: ParsedTargetRequirementStatKeywordFilters | null | undefined,
  casterId?: string,
): boolean {
  if (!filters) return true;
  if (filters.statRequirement && !permanentMeetsStatRequirement(permanent, filters.statRequirement)) {
    return false;
  }
  if (filters.targetRestriction && !permanentMeetsTargetRestriction(permanent, state, filters.targetRestriction, casterId)) {
    return false;
  }
  if (filters.creatureRestriction?.type === 'has_keyword') {
    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('creature') && !permanentMeetsHasKeyword(permanent, state, filters.creatureRestriction.keyword)) {
      const matchesOtherListedType = listedNonCreatureTargetTypes(filters).some((entry) => typeLine.includes(entry));
      if (!matchesOtherListedType) return false;
    }
  }
  return true;
}
