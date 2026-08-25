// server/src/state/modules/turn-handlers/turnTemporaryRetainedMana.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: temporary retained-mana buckets (Horizon Stone / Omnath /
// until-end-of-combat and until-end-of-turn).
// Public entry symbols: TEMPORARY_RETAINED_MANA_COLORS,
// getTemporaryRetainedManaForPlayer, syncTemporaryRetainedManaToPool,
// clearTemporaryRetainedManaDuration.
// Leaf must not import turn.ts or turn-handlers/index.ts.

export const TEMPORARY_RETAINED_MANA_COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

type TemporaryRetainedManaDuration = 'untilEndCombat' | 'untilEndTurn';

function getTemporaryRetainedManaBuckets(state: any, playerId: string): {
  untilEndCombat?: Record<string, number>;
  untilEndTurn?: Record<string, number>;
} {
  state.temporaryRetainedMana = state.temporaryRetainedMana || {};
  state.temporaryRetainedMana[playerId] = state.temporaryRetainedMana[playerId] || {
    untilEndCombat: {},
    untilEndTurn: {},
  };
  return state.temporaryRetainedMana[playerId];
}

export function getTemporaryRetainedManaForPlayer(state: any, playerId: string): Record<string, number> {
  const buckets = state?.temporaryRetainedMana?.[playerId];
  const totals: Record<string, number> = {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };

  if (!buckets) return totals;

  for (const duration of ['untilEndCombat', 'untilEndTurn'] as const) {
    const bucket = buckets[duration] || {};
    for (const color of TEMPORARY_RETAINED_MANA_COLORS) {
      totals[color] += Math.max(0, Number(bucket[color] || 0));
    }
  }

  return totals;
}

export function syncTemporaryRetainedManaToPool(state: any, playerId: string): void {
  const buckets = state?.temporaryRetainedMana?.[playerId];
  if (!buckets) return;

  const pool = state?.manaPool?.[playerId] || {};

  for (const color of TEMPORARY_RETAINED_MANA_COLORS) {
    let remaining = Math.max(0, Number(pool[color] || 0));

    const untilEndTurnAmount = Math.min(remaining, Math.max(0, Number(buckets.untilEndTurn?.[color] || 0)));
    if (untilEndTurnAmount > 0) (buckets.untilEndTurn || (buckets.untilEndTurn = {}))[color] = untilEndTurnAmount;
    else if (buckets.untilEndTurn) delete buckets.untilEndTurn[color];
    remaining -= untilEndTurnAmount;

    const untilEndCombatAmount = Math.min(remaining, Math.max(0, Number(buckets.untilEndCombat?.[color] || 0)));
    if (untilEndCombatAmount > 0) (buckets.untilEndCombat || (buckets.untilEndCombat = {}))[color] = untilEndCombatAmount;
    else if (buckets.untilEndCombat) delete buckets.untilEndCombat[color];
  }

  if (buckets.untilEndCombat && Object.keys(buckets.untilEndCombat).length === 0) delete buckets.untilEndCombat;
  if (buckets.untilEndTurn && Object.keys(buckets.untilEndTurn).length === 0) delete buckets.untilEndTurn;

  if (!buckets.untilEndCombat && !buckets.untilEndTurn) {
    delete state.temporaryRetainedMana[playerId];
  }
  if (state.temporaryRetainedMana && Object.keys(state.temporaryRetainedMana).length === 0) {
    delete state.temporaryRetainedMana;
  }
}

export function clearTemporaryRetainedManaDuration(state: any, duration: TemporaryRetainedManaDuration): void {
  const allBuckets = state?.temporaryRetainedMana;
  if (!allBuckets || typeof allBuckets !== 'object') return;

  for (const playerId of Object.keys(allBuckets)) {
    const buckets = allBuckets[playerId];
    if (!buckets || typeof buckets !== 'object') continue;
    delete buckets[duration];
    if (!buckets.untilEndCombat && !buckets.untilEndTurn) {
      delete allBuckets[playerId];
    }
  }

  if (Object.keys(allBuckets).length === 0) {
    delete state.temporaryRetainedMana;
  }
}
