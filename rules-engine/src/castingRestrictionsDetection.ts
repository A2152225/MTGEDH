import type { BattlefieldPermanent } from '../../shared/src';
import {
  CastingRestrictionType,
  RestrictionDuration,
  type CastingRestriction,
} from './castingRestrictionsTypes';

/**
 * Patterns to detect casting restrictions from oracle text.
 */
const RESTRICTION_PATTERNS: {
  pattern: RegExp;
  type: CastingRestrictionType;
  affectedPlayers: CastingRestriction['affectedPlayers'];
  duration: RestrictionDuration;
  extractor?: (match: RegExpMatchArray, oracleText: string) => Partial<CastingRestriction>;
}[] = [
  {
    pattern: /your\s+opponents?\s+can't\s+cast\s+spells?\s+this\s+turn/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.END_OF_TURN,
    extractor: () => ({ expiresAtEndOfTurn: true }),
  },
  {
    pattern: /target\s+player\s+can't\s+cast\s+spells?\s+this\s+turn/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'target',
    duration: RestrictionDuration.END_OF_TURN,
    extractor: () => ({ expiresAtEndOfTurn: true }),
  },
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+spell\s+each\s+turn/i,
    type: CastingRestrictionType.ONE_SPELL_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+noncreature\s+spell/i,
    type: CastingRestrictionType.ONE_NONCREATURE_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ spellTypeRestriction: 'noncreature' }),
  },
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+nonartifact\s+spell/i,
    type: CastingRestrictionType.ONE_NONARTIFACT_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ spellTypeRestriction: 'nonartifact' }),
  },
  {
    pattern: /during\s+your\s+turn.*opponents?\s+can't\s+cast\s+spells?\s+or\s+activate\s+abilities/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ onlyDuringYourTurn: true }),
  },
  {
    pattern: /opponent.*can\s+only\s+cast\s+spells?\s+any\s+time.*could\s+cast\s+a\s+sorcery/i,
    type: CastingRestrictionType.SORCERY_SPEED_ONLY,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
  {
    pattern: /opponents?\s+can't\s+cast\s+spells?\s+from\s+anywhere\s+other\s+than\s+their\s+hands?/i,
    type: CastingRestrictionType.HAND_ONLY,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
];

/**
 * Detect casting restrictions from a permanent's oracle text.
 */
export function detectCastingRestrictions(
  permanent: BattlefieldPermanent | any,
  controllerId: string
): CastingRestriction[] {
  const restrictions: CastingRestriction[] = [];
  const oracleText = permanent.card?.oracle_text?.toLowerCase() ||
    permanent.oracle_text?.toLowerCase() || '';
  const cardName = permanent.card?.name || permanent.name || 'Unknown';

  for (const { pattern, type, affectedPlayers, duration, extractor } of RESTRICTION_PATTERNS) {
    const match = oracleText.match(pattern);
    if (!match) continue;

    const extracted = extractor ? extractor(match, oracleText) : {};
    restrictions.push({
      id: `restriction-${permanent.id}-${type}`,
      sourceId: permanent.id,
      sourceName: cardName,
      sourceControllerId: controllerId,
      type,
      duration,
      affectedPlayers,
      timestamp: Date.now(),
      ...extracted,
    });
  }

  return restrictions;
}
