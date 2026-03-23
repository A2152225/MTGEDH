import type { PlayerID } from '../../shared/src';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';

/**
 * Build/augment an execution context from trigger/target event hints.
 *
 * This keeps selector binding logic in one place so callers can pass whichever
 * event fields they already have, and relational selectors like
 * "each of those opponents" can resolve with minimal glue code.
 */
export function buildOracleIRExecutionContext(
  base: OracleIRExecutionContext,
  hint?: OracleIRExecutionEventHint
): OracleIRExecutionContext {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const normalizedControllerId = normalizeId(base.controllerId) ?? base.controllerId;
  const baseSel = base.selectorContext;

  const dedupe = (ids: readonly PlayerID[] | undefined): readonly PlayerID[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out.length > 0 ? out : undefined;
  };

  const normalizeSpellTypes = (value: unknown): readonly string[] | undefined => {
    if (typeof value !== 'string') return undefined;
    const lower = value.toLowerCase();
    const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
    const out = known.filter(type => lower.includes(type));
    if (lower.includes('tribal') && !out.includes('kindred')) out.push('kindred');
    return out.length > 0 ? out : undefined;
  };

  const hintTargetOpponentId = normalizeId(hint?.targetOpponentId);
  const hintTargetPlayerId = normalizeId(hint?.targetPlayerId);
  const hintTargetPermanentId = normalizeId(hint?.targetPermanentId);
  const hintChosenObjectIds = Array.isArray(hint?.chosenObjectIds)
    ? hint.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : undefined;
  const baseTargetOpponentId = normalizeId(baseSel?.targetOpponentId);
  const baseTargetPlayerId = normalizeId(baseSel?.targetPlayerId);

  const eachOfThoseOpponents =
    dedupe(hint?.affectedOpponentIds) ??
    dedupe(hint?.opponentsDealtDamageIds) ??
    dedupe(hint?.affectedPlayerIds) ??
    dedupe(hintTargetOpponentId ? [hintTargetOpponentId] : undefined) ??
    dedupe(hintTargetPlayerId ? [hintTargetPlayerId] : undefined) ??
    baseSel?.eachOfThoseOpponents;

  const sanitizedEachOfThoseOpponents = eachOfThoseOpponents
    ? dedupe(eachOfThoseOpponents.filter(id => id !== normalizedControllerId))
    : undefined;

  const singleton = (ids: readonly PlayerID[] | undefined): PlayerID | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;

  const dedupedAffectedPlayers = dedupe(hint?.affectedPlayerIds);
  const dedupedAffectedOpponents = dedupe(
    (hint?.affectedOpponentIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const dedupedOpponentsDealtDamage = dedupe(
    (hint?.opponentsDealtDamageIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const explicitTargetOpponentId =
    hintTargetOpponentId && hintTargetOpponentId !== normalizedControllerId
      ? hintTargetOpponentId
      : undefined;
  const inferredTargetOpponentId =
    singleton(sanitizedEachOfThoseOpponents) ??
    singleton(dedupedAffectedOpponents) ??
    singleton(dedupedOpponentsDealtDamage);
  const inferredTargetPlayerId =
    singleton(dedupedAffectedPlayers) ??
    inferredTargetOpponentId;
  const baseTargetFromOpponent = baseTargetOpponentId;
  const baseTargetFromPlayer =
    baseTargetPlayerId && baseTargetPlayerId !== normalizedControllerId
      ? baseTargetPlayerId
      : undefined;

  const baseChosenObjectIds = Array.isArray(baseSel?.chosenObjectIds)
    ? baseSel.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];

  const selectorContext: OracleIRSelectorContext = {
    targetPlayerId:
      hintTargetPlayerId ??
      explicitTargetOpponentId ??
      inferredTargetPlayerId ??
      baseTargetPlayerId ??
      baseTargetFromOpponent,
    targetOpponentId:
      explicitTargetOpponentId ??
      inferredTargetOpponentId ??
      baseTargetOpponentId ??
      baseTargetFromPlayer,
    ...(sanitizedEachOfThoseOpponents ? { eachOfThoseOpponents: sanitizedEachOfThoseOpponents } : {}),
    ...((baseChosenObjectIds.length > 0 || (hintChosenObjectIds && hintChosenObjectIds.length > 0))
      ? {
          chosenObjectIds: Array.from(new Set([...(baseChosenObjectIds || []), ...((hintChosenObjectIds || []))])),
        }
      : {}),
  };

  const referenceSpellTypes =
    normalizeSpellTypes(hint?.spellType) ??
    (Array.isArray(base.referenceSpellTypes) && base.referenceSpellTypes.length > 0
      ? base.referenceSpellTypes
      : undefined);

  if (!selectorContext.targetPlayerId && !selectorContext.targetOpponentId && !selectorContext.eachOfThoseOpponents) {
    if (
      normalizedControllerId === base.controllerId &&
      !selectorContext.chosenObjectIds &&
      !referenceSpellTypes &&
      !hintTargetPermanentId &&
      !hint?.tapOrUntapChoice &&
      typeof hint?.wonCoinFlip !== 'boolean' &&
      typeof hint?.winningVoteChoice === 'undefined'
    ) {
      return base;
    }
    return {
      ...base,
      controllerId: normalizedControllerId,
      ...(selectorContext.chosenObjectIds ? { selectorContext } : {}),
      ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
      ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
      ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
      ...(typeof hint?.wonCoinFlip === 'boolean' ? { wonCoinFlip: hint.wonCoinFlip } : {}),
      ...(typeof hint?.winningVoteChoice !== 'undefined' ? { winningVoteChoice: hint.winningVoteChoice } : {}),
    };
  }

  return {
    ...base,
    controllerId: normalizedControllerId,
    selectorContext,
    ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
    ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
    ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
    ...(typeof hint?.wonCoinFlip === 'boolean' ? { wonCoinFlip: hint.wonCoinFlip } : {}),
    ...(typeof hint?.winningVoteChoice !== 'undefined' ? { winningVoteChoice: hint.winningVoteChoice } : {}),
  };
}
