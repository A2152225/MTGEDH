// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: getPlayerLifeTotal, canPayManaCostWithAvailableSources
// (exact floating + untapped-source payment search).
// Public entry symbols: canPayManaCostWithAvailableSources, getPlayerLifeTotal.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { debug } from "../../../utils/debug.js";
import { getAvailableMana } from "./manaCheckAvailableMana.js";
import { canPayManaCost } from "./manaCheckCanPayManaCost.js";
import {
  EXACT_MANA_SEARCH_NODE_BUDGET,
  normalizePoolSignature,
  buildExactSacrificeCandidates,
  buildExactHandCandidates,
  type ExactManaPaymentOptions,
  type ExactManaSpendPurpose,
  exactManaSpendRestrictionAllowsPurpose,
  removeSacrificeCandidates,
  removeHandCandidates,
  removeReturnToHandCandidates,
  spendManaCostFromExactPool,
  buildExactManaSources,
} from "./manaCheckExactSources.js";
import type { ParsedManaCost } from "./manaCheckPaymentTypes.js";
import {
  type ExactManaSource,
  type ExactSacrificeCandidate,
  type ExactHandCandidate,
  type SimpleManaKey,
  SIMPLE_MANA_KEYS,
  createSimpleManaPool,
  getManaPoolFromState,
  addProducedMana,
  manaSymbolToColorKey,
} from "./manaCheckSimplePool.js";

export function getPlayerLifeTotal(state: any, playerId: PlayerID): number {
  const mappedLife = Number(state?.life?.[playerId]);
  if (Number.isFinite(mappedLife)) {
    return mappedLife;
  }

  const playerEntry = Array.isArray(state?.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : null;
  const playerLife = Number(playerEntry?.life);
  if (Number.isFinite(playerLife)) {
    return playerLife;
  }

  return 40;
}

function restrictedFloatingEntryColorKey(entry: { type?: string } | null | undefined): SimpleManaKey | undefined {
  const raw = String(entry?.type || '').trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if ((SIMPLE_MANA_KEYS as readonly string[]).includes(lower)) {
    return lower as SimpleManaKey;
  }
  return manaSymbolToColorKey(raw.toUpperCase());
}

/**
 * Fold already-floating restricted pool mana (Secluded Courtyard / Cavern of Souls)
 * into a simple WUBRGC pool when the spend purpose is legal. Untapped restricted
 * sources are handled by the exact search; once those lands are tapped the mana
 * lives only on `pool.restricted` and was previously ignored, so Smart Pass treated
 * a tapped-out main phase as idle.
 */
function withMatchingRestrictedFloatingMana<TPool extends Record<string, number>>(
  pool: TPool,
  rawPool: any,
  purpose: ExactManaSpendPurpose | undefined,
): TPool {
  if (!purpose) return pool;
  const restricted = Array.isArray(rawPool?.restricted) ? rawPool.restricted : [];
  if (restricted.length === 0) return pool;

  let changed = false;
  const next: TPool = { ...pool };
  for (const entry of restricted) {
    if (!entry) continue;
    const amount = Number(entry.amount || 0);
    if (!(amount > 0)) continue;
    const restriction = String(entry.restriction || '').trim();
    if (!restriction) continue;
    if (!exactManaSpendRestrictionAllowsPurpose(
      { restriction, restrictedTo: entry.restrictedTo },
      purpose,
    )) {
      continue;
    }
    const colorKey = restrictedFloatingEntryColorKey(entry);
    if (!colorKey) continue;
    next[colorKey] = Number(next[colorKey] || 0) + amount;
    changed = true;
  }
  return changed ? next : pool;
}

/**
 * Check whether the player can pay a mana cost using their floating mana plus untapped mana sources.
 * This exact helper is primarily used when activation-cost sources like Signets are present,
 * because aggregate optimistic pools can overcount those sources for castability checks.
 */
export function canPayManaCostWithAvailableSources(
  state: any,
  playerId: PlayerID,
  parsedCost: ParsedManaCost,
  lifeAvailable: number = Infinity,
  options?: ExactManaPaymentOptions,
): boolean {
  const effectiveLifeAvailable = Number.isFinite(Number(lifeAvailable))
    ? Number(lifeAvailable)
    : getPlayerLifeTotal(state, playerId);
  const rawFloatingPool = getManaPoolFromState(state, playerId);
  const restrictedSpendPurpose = options?.restrictedSpendPurpose;
  const floatingPool = withMatchingRestrictedFloatingMana(
    createSimpleManaPool(rawFloatingPool),
    rawFloatingPool,
    restrictedSpendPurpose,
  );
  if (canPayManaCost(floatingPool, parsedCost, effectiveLifeAvailable)) {
    return true;
  }

  const sources = buildExactManaSources(state, playerId);
  const battlefieldCandidates = buildExactSacrificeCandidates(state, playerId);
  const excludedHandCardIds = new Set(
    (Array.isArray(options?.excludedHandCardIds) ? options?.excludedHandCardIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const handCandidates = buildExactHandCandidates(state, playerId).filter(
    (candidate) => !excludedHandCardIds.has(String(candidate.id || '')),
  );
  const hasActivationCostSource = sources.some((source) =>
    source.options.some((option) => option.activationCost),
  );
  const hasLifeCostSource = sources.some((source) =>
    source.options.some((option) => Number(option.lifeCost || 0) > 0),
  );
  const hasHandCostSource = sources.some((source) =>
    source.options.some((option) => option.handCost),
  );
  const hasSacrificeCostSource = sources.some((source) =>
    source.options.some((option) => option.sacrificeCost),
  );
  const hasReturnToHandCostSource = sources.some((source) =>
    source.options.some((option) => option.returnToHandCost),
  );
  const hasRemoveCounterOrBatteryFixSource = sources.some((source) =>
    source.options.some((option) => option.removeCounterCost || option.batteryColorFix),
  );
  const hasBranchingSource = sources.some((source) => source.options.length > 1);
  const hasRestrictedSpendSource = sources.some((source) =>
    source.options.some((option) => Boolean(option.spendRestriction?.restriction)),
  );

  // Fast path ignores per-source spendRestrictions (Vibranium/Powerstone). When a cast/ability
  // purpose is provided and any source is restricted, force the exact search so illegal mana
  // is not counted toward the cost.
  if (
    !hasActivationCostSource &&
    !hasLifeCostSource &&
    !hasHandCostSource &&
    !hasSacrificeCostSource &&
    !hasReturnToHandCostSource &&
    !hasRemoveCounterOrBatteryFixSource &&
    !hasBranchingSource &&
    !(hasRestrictedSpendSource && restrictedSpendPurpose)
  ) {
    return canPayManaCost(
      withMatchingRestrictedFloatingMana(getAvailableMana(state, playerId), rawFloatingPool, restrictedSpendPurpose),
      parsedCost,
      effectiveLifeAvailable,
    );
  }

  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const manaSourcePermanentIds = new Set(
    sources.map((source) => String(source.permanentId || '')).filter(Boolean),
  );
  let nodesVisited = 0;
  let budgetExceeded = false;

  const search = (
    pool: Record<SimpleManaKey, number>,
    life: number,
    remainingSources: ExactManaSource[],
    remainingBattlefieldCandidates: ExactSacrificeCandidate[],
    remainingHandCandidates: ExactHandCandidate[],
  ): boolean => {
    if (budgetExceeded) {
      return false;
    }
    nodesVisited += 1;
    if (nodesVisited > EXACT_MANA_SEARCH_NODE_BUDGET) {
      budgetExceeded = true;
      return false;
    }

    if (canPayManaCost(pool, parsedCost, life)) {
      return true;
    }

    if (remainingSources.length === 0) {
      return false;
    }

    // Candidate identity for memo: count + small fingerprint. Full id lists with
    // dozens of tokens explode memo memory alongside the search tree.
    const battlefieldFingerprint = `${remainingBattlefieldCandidates.length}:${remainingBattlefieldCandidates.slice(0, 4).map((c) => c.id).join(',')}`;
    const handFingerprint = `${remainingHandCandidates.length}:${remainingHandCandidates.slice(0, 4).map((c) => c.id).join(',')}`;
    const key = `${normalizePoolSignature(pool)}|${life}|${remainingSources.map((source) => source.id).join(',')}|${battlefieldFingerprint}|${handFingerprint}`;
    const cached = memo.get(key);
    if (typeof cached === 'boolean') {
      return cached;
    }
    if (visiting.has(key)) {
      return false;
    }

    visiting.add(key);

    for (let index = 0; index < remainingSources.length; index += 1) {
      if (budgetExceeded) {
        break;
      }
      const source = remainingSources[index];
      const nextRemainingSources = remainingSources
        .slice(0, index)
        .concat(remainingSources.slice(index + 1));

      for (const option of source.options) {
        if (budgetExceeded) {
          break;
        }
        let workingPool = createSimpleManaPool(pool);
        let workingLife = life;
        let workingCounterBudgets = source.counterBudgets
          ? { ...source.counterBudgets }
          : undefined;

        if (option.removeCounterCost) {
          const counterType = option.removeCounterCost.counterType;
          const needed = Math.max(1, Number(option.removeCounterCost.count || 1));
          const available = Number(workingCounterBudgets?.[counterType] || 0);
          if (available < needed) {
            continue;
          }
          workingCounterBudgets = {
            ...(workingCounterBudgets || {}),
            [counterType]: available - needed,
          };
        }

        if (option.activationCost) {
          const spent = spendManaCostFromExactPool(workingPool, option.activationCost, workingLife);
          if (!spent) {
            continue;
          }

          workingPool = spent.pool;
          workingLife = spent.lifeAvailable;
        }

        if (option.lifeCost) {
          if (workingLife < Number(option.lifeCost)) {
            continue;
          }
          workingLife -= Number(option.lifeCost);
        }

        type ExactSearchBranchState = {
          remainingSources: ExactManaSource[];
          remainingBattlefieldCandidates: ExactSacrificeCandidate[];
          remainingHandCandidates: ExactHandCandidate[];
        };

        const sourceAfterUse: ExactManaSource = {
          ...source,
          ...(workingCounterBudgets ? { counterBudgets: workingCounterBudgets } : {}),
        };
        const canRepeat = Boolean(option.repeatable);
        const stillHasRemoveCounters = option.removeCounterCost
          ? Number(workingCounterBudgets?.[option.removeCounterCost.counterType] || 0)
            >= Math.max(1, Number(option.removeCounterCost.count || 1))
          : true;
        const keepSource = canRepeat && (!option.removeCounterCost || stillHasRemoveCounters);
        const baseRemainingSources = keepSource
          ? remainingSources.map((entry, entryIndex) => (
            entryIndex === index ? sourceAfterUse : entry
          ))
          : nextRemainingSources;
        let branchStates: ExactSearchBranchState[] = [{
          remainingSources: baseRemainingSources,
          remainingBattlefieldCandidates,
          remainingHandCandidates,
        }];

        if (option.handCost) {
          const nextBranchStates: ExactSearchBranchState[] = [];
          for (const branchState of branchStates) {
            const handRemovalSets = removeHandCandidates(branchState.remainingHandCandidates, option.handCost);
            for (const handRemovalSet of handRemovalSets) {
              nextBranchStates.push({
                ...branchState,
                remainingHandCandidates: handRemovalSet.remainingCandidates,
              });
            }
          }

          if (nextBranchStates.length === 0) {
            continue;
          }

          branchStates = nextBranchStates;
        }

        if (option.sacrificeCost) {
          const nextBranchStates: ExactSearchBranchState[] = [];
          for (const branchState of branchStates) {
            const sacrificeRemovalSets = removeSacrificeCandidates(
              branchState.remainingBattlefieldCandidates,
              option.sacrificeCost,
              source.permanentId,
              manaSourcePermanentIds,
            );
            for (const sacrificeRemovalSet of sacrificeRemovalSets) {
              const removedIds = new Set(sacrificeRemovalSet.removedIds);
              nextBranchStates.push({
                remainingSources: branchState.remainingSources.filter((candidateSource) => !removedIds.has(candidateSource.permanentId)),
                remainingBattlefieldCandidates: sacrificeRemovalSet.remainingCandidates,
                remainingHandCandidates: branchState.remainingHandCandidates,
              });
            }
          }

          if (nextBranchStates.length === 0) {
            continue;
          }

          branchStates = nextBranchStates;
        }

        if (option.returnToHandCost) {
          const nextBranchStates: ExactSearchBranchState[] = [];
          for (const branchState of branchStates) {
            const returnRemovalSets = removeReturnToHandCandidates(
              branchState.remainingBattlefieldCandidates,
              option.returnToHandCost,
              source.permanentId,
            );
            for (const returnRemovalSet of returnRemovalSets) {
              const removedIds = new Set(returnRemovalSet.removedIds);
              nextBranchStates.push({
                remainingSources: branchState.remainingSources.filter((candidateSource) => !removedIds.has(candidateSource.permanentId)),
                remainingBattlefieldCandidates: returnRemovalSet.remainingCandidates,
                remainingHandCandidates: branchState.remainingHandCandidates,
              });
            }
          }

          if (nextBranchStates.length === 0) {
            continue;
          }

          branchStates = nextBranchStates;
        }

        if (!exactManaSpendRestrictionAllowsPurpose(option.spendRestriction, restrictedSpendPurpose)) {
          continue;
        }

        for (const branchState of branchStates) {
          const producedPool = addProducedMana(workingPool, option.produced);
          if (
            search(
              producedPool,
              workingLife,
              branchState.remainingSources,
              branchState.remainingBattlefieldCandidates,
              branchState.remainingHandCandidates,
            )
          ) {
            memo.set(key, true);
            visiting.delete(key);
            return true;
          }
        }
      }
    }

    memo.set(key, false);
    visiting.delete(key);
    return false;
  };

  const exactResult = search(floatingPool, effectiveLifeAvailable, sources, battlefieldCandidates, handCandidates);
  if (exactResult) {
    return true;
  }

  if (budgetExceeded) {
    debug(2, `[mana-check] exact payment search hit node budget (${EXACT_MANA_SEARCH_NODE_BUDGET}); falling back to available-mana estimate`);
    return canPayManaCost(
      withMatchingRestrictedFloatingMana(getAvailableMana(state, playerId), rawFloatingPool, restrictedSpendPurpose),
      parsedCost,
      effectiveLifeAvailable,
    );
  }

  return false;
}
