/**
 * Deferred "next spell you cast this turn costs N less" grants driven by
 * counters-removed (Mutated Cultist) or fixed amounts.
 */
import type { PlayerID } from '../../../shared/src';

export interface NextSpellCostReductionGrant {
  id: string;
  controllerId: PlayerID;
  genericAmount: number;
  turnApplied: number;
  sourceName?: string;
  used?: boolean;
}

function getGrants(state: any): NextSpellCostReductionGrant[] {
  return Array.isArray(state?.nextSpellCostReductionGrants)
    ? state.nextSpellCostReductionGrants
    : [];
}

function setGrants(state: any, grants: NextSpellCostReductionGrant[]): void {
  state.nextSpellCostReductionGrants = grants;
}

export function grantNextSpellCostReduction(
  state: any,
  controllerId: PlayerID,
  genericAmount: number,
  sourceName?: string,
): void {
  const amount = Math.max(0, Math.floor(Number(genericAmount) || 0));
  if (amount <= 0) return;
  const turnApplied = Number(state?.turnNumber || 0);
  const grants = getGrants(state);
  grants.push({
    id: `nscr_${Date.now()}_${grants.length}`,
    controllerId,
    genericAmount: amount,
    turnApplied,
    sourceName,
  });
  setGrants(state, grants);
}

export function getActiveNextSpellCostReduction(
  state: any,
  controllerId: PlayerID,
): number {
  const turn = Number(state?.turnNumber || 0);
  return getGrants(state)
    .filter(
      (g) =>
        String(g.controllerId) === String(controllerId)
        && !g.used
        && Number(g.turnApplied || 0) === turn,
    )
    .reduce((sum, g) => sum + Math.max(0, Number(g.genericAmount) || 0), 0);
}

export function consumeNextSpellCostReductionAfterCast(
  state: any,
  controllerId: PlayerID,
): number {
  const turn = Number(state?.turnNumber || 0);
  let consumed = 0;
  const grants = getGrants(state).map((g) => {
    if (
      String(g.controllerId) === String(controllerId)
      && !g.used
      && Number(g.turnApplied || 0) === turn
    ) {
      consumed += Math.max(0, Number(g.genericAmount) || 0);
      return { ...g, used: true };
    }
    return g;
  });
  setGrants(state, grants);
  return consumed;
}

export function resetNextSpellCostReductionForNewTurn(state: any, currentTurn: number): void {
  setGrants(
    state,
    getGrants(state).filter((g) => Number(g.turnApplied || 0) >= currentTurn),
  );
}
