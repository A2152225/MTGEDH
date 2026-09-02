/**
 * Origin parent: server/src/socket/game-actions-handlers/gameActionsSpellTargetSelection.ts
 *
 * Cluster moved: IR-primary cast-time targeting resolution that prefers
 * parseTargetRequirements over the categorizeSpellWithoutPrimaryRetirement
 * opcode table. IR-off (ORACLE_IR_SPELL_PRIMARY=0) still uses categorize.
 *
 * Public entry symbols: resolveCastSpellParsedTargeting,
 * deriveSpellSpecFromParsedTargetReqs, parsedTargetReqsCoverCastTargets,
 * shouldPreferParsedTargetReqs.
 */
import type { SpellSpec, PermanentFilter, SpellTypeFilter } from "../../rules-engine/targeting-handlers/targetingSpellSpecTypes.js";
import {
  categorizeSpellWithoutPrimaryRetirement,
  parseTargetRequirements,
  requiresTargeting,
} from "../../rules-engine/targeting";
import { isOracleIrSpellPrimaryEnabled } from "../../state/modules/oracleIrFeatureFlags.js";

export type ParsedTargetRequirements = ReturnType<typeof parseTargetRequirements>;

export type CastSpellParsedTargeting = {
  spellSpec: SpellSpec | null;
  targetReqs: ParsedTargetRequirements;
  preferParsedTargetReqs: boolean;
};

export function shouldPreferParsedTargetReqs(
  targetReqs: ParsedTargetRequirements | null | undefined,
): boolean {
  if (!targetReqs?.needsTargets) return false;
  if (targetReqs.groupedTargets) return true;
  if (targetReqs.perOpponent === true) return true;
  return Array.isArray(targetReqs.targetTypes)
    && targetReqs.targetTypes.some((targetType) => String(targetType || '').toLowerCase().startsWith('graveyard_'));
}

export function parsedTargetReqsCoverCastTargets(
  targetReqs: ParsedTargetRequirements | null | undefined,
  oracleText?: string,
): boolean {
  if (targetReqs?.needsTargets && Array.isArray(targetReqs.targetTypes) && targetReqs.targetTypes.length > 0) {
    return true;
  }
  return !requiresTargeting(oracleText);
}

function permanentFilterFromTargetType(rawTargetType: string): {
  filter: PermanentFilter;
  nonlandOnly?: boolean;
  spellTypeFilter?: SpellTypeFilter;
} {
  const targetType = String(rawTargetType || '').trim().toLowerCase();
  if (targetType === 'any') return { filter: 'ANY' };
  if (targetType === 'creature') return { filter: 'CREATURE' };
  if (targetType === 'planeswalker') return { filter: 'PLANESWALKER' };
  if (targetType === 'battle') return { filter: 'BATTLE' };
  if (targetType === 'artifact') return { filter: 'ARTIFACT' };
  if (targetType === 'enchantment') return { filter: 'ENCHANTMENT' };
  if (targetType === 'land') return { filter: 'LAND' };
  if (targetType === 'nonland permanent') return { filter: 'PERMANENT', nonlandOnly: true };
  if (targetType.includes('noncreature spell')) return { filter: 'ANY', spellTypeFilter: 'NONCREATURE' };
  if (targetType.includes('creature spell')) return { filter: 'ANY', spellTypeFilter: 'CREATURE_SPELL' };
  if (targetType.includes('instant') || targetType.includes('sorcery')) {
    return { filter: 'ANY', spellTypeFilter: 'INSTANT_SORCERY' };
  }
  if (targetType.includes('spell')) return { filter: 'ANY', spellTypeFilter: 'ANY_SPELL' };
  return { filter: 'PERMANENT' };
}

function attachParsedStatKeywordRestrictions(
  spec: SpellSpec,
  targetReqs: ParsedTargetRequirements,
): SpellSpec {
  return {
    ...spec,
    ...(targetReqs.targetRestriction ? { targetRestriction: targetReqs.targetRestriction } : {}),
    ...(targetReqs.statRequirement ? { statRequirement: targetReqs.statRequirement } : {}),
    ...(targetReqs.creatureRestriction ? { creatureRestriction: targetReqs.creatureRestriction } : {}),
  };
}

/**
 * Minimal SpellSpec for evaluateTargeting when parsed reqs cannot drive the
 * target list themselves. Does not consult the categorize opcode table.
 */
export function deriveSpellSpecFromParsedTargetReqs(
  targetReqs: ParsedTargetRequirements | null | undefined,
): SpellSpec | null {
  if (!targetReqs?.needsTargets) return null;
  const targetTypes = Array.isArray(targetReqs.targetTypes)
    ? targetReqs.targetTypes.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (targetTypes.length === 0) return null;

  const minTargets = Math.max(0, Number(targetReqs.minTargets || 0));
  const maxTargets = Math.max(minTargets, Number(targetReqs.maxTargets || 0));
  const opponentOnly = targetTypes.includes('opponent')
    || targetReqs.targetControllerConstraint === 'opponent';
  const controllerOnly = targetReqs.targetControllerConstraint === 'you';

  if (targetTypes.includes('player') || targetTypes.includes('opponent')) {
    return attachParsedStatKeywordRestrictions({
      op: 'TARGET_PLAYER',
      filter: 'ANY',
      minTargets,
      maxTargets,
      opponentOnly,
      targetDescription: targetReqs.targetDescription,
      ...(targetReqs.minTargetsIsX ? { minTargetsIsX: true } : {}),
      ...(targetReqs.maxTargetsIsX ? { maxTargetsIsX: true } : {}),
    }, targetReqs);
  }

  if (targetTypes.includes('ability')) {
    return attachParsedStatKeywordRestrictions({
      op: 'COUNTER_TARGET_ABILITY',
      filter: 'ANY',
      minTargets,
      maxTargets,
      targetDescription: targetReqs.targetDescription,
      ...(targetReqs.minTargetsIsX ? { minTargetsIsX: true } : {}),
      ...(targetReqs.maxTargetsIsX ? { maxTargetsIsX: true } : {}),
    }, targetReqs);
  }

  if (targetTypes.some((targetType) => targetType.includes('spell'))) {
    const mapped = permanentFilterFromTargetType(targetTypes[0] || 'spell');
    return attachParsedStatKeywordRestrictions({
      op: 'COUNTER_TARGET_SPELL',
      filter: 'ANY',
      minTargets,
      maxTargets,
      spellTypeFilter: mapped.spellTypeFilter || 'ANY_SPELL',
      targetDescription: targetReqs.targetDescription,
      ...(targetReqs.stackTargetsIgnoreCantBeCountered ? { ignoreCantBeCountered: true } : {}),
      ...(targetReqs.minTargetsIsX ? { minTargetsIsX: true } : {}),
      ...(targetReqs.maxTargetsIsX ? { maxTargetsIsX: true } : {}),
    }, targetReqs);
  }

  if (targetTypes.includes('any')) {
    return attachParsedStatKeywordRestrictions({
      op: 'ANY_TARGET_DAMAGE',
      filter: 'ANY',
      minTargets,
      maxTargets,
      targetDescription: targetReqs.targetDescription,
      ...(targetReqs.minTargetsIsX ? { minTargetsIsX: true } : {}),
      ...(targetReqs.maxTargetsIsX ? { maxTargetsIsX: true } : {}),
    }, targetReqs);
  }

  const battlefieldTypes = targetTypes.filter((targetType) =>
    !targetType.startsWith('graveyard_') && targetType !== 'player' && targetType !== 'opponent'
  );
  if (battlefieldTypes.length === 0) return null;

  const mappedFilters = battlefieldTypes.map((targetType) => permanentFilterFromTargetType(targetType));
  const uniqueFilters = Array.from(new Set(mappedFilters.map((mapped) => mapped.filter)));
  const nonlandOnly = mappedFilters.some((mapped) => mapped.nonlandOnly === true);
  const primaryFilter = uniqueFilters[0] || 'PERMANENT';

  return attachParsedStatKeywordRestrictions({
    op: primaryFilter === 'CREATURE' ? 'TARGET_CREATURE' : 'TARGET_PERMANENT',
    filter: primaryFilter,
    minTargets,
    maxTargets,
    ...(uniqueFilters.length > 1 ? { multiFilter: uniqueFilters } : {}),
    ...(nonlandOnly ? { nonlandOnly: true } : {}),
    ...(controllerOnly ? { controllerOnly: true } : {}),
    ...(opponentOnly ? { opponentOnly: true } : {}),
    targetDescription: targetReqs.targetDescription,
    ...(targetReqs.minTargetsIsX ? { minTargetsIsX: true } : {}),
    ...(targetReqs.maxTargetsIsX ? { maxTargetsIsX: true } : {}),
  }, targetReqs);
}

export function resolveCastSpellParsedTargeting(args: {
  cardName: string;
  oracleText: string;
  xValue?: number;
  gameState?: any;
  controllerId?: string;
}): CastSpellParsedTargeting {
  const targetReqs = parseTargetRequirements(args.oracleText, {
    xValue: args.xValue,
    gameState: args.gameState,
    controllerId: args.controllerId,
    sourceName: args.cardName,
  });

  if (isOracleIrSpellPrimaryEnabled()) {
    const covers = parsedTargetReqsCoverCastTargets(targetReqs, args.oracleText);
    return {
      spellSpec: covers ? null : deriveSpellSpecFromParsedTargetReqs(targetReqs),
      targetReqs,
      preferParsedTargetReqs: covers,
    };
  }

  return {
    spellSpec: categorizeSpellWithoutPrimaryRetirement(args.cardName, args.oracleText),
    targetReqs,
    preferParsedTargetReqs: shouldPreferParsedTargetReqs(targetReqs),
  };
}
