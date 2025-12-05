import type { GameState, BattlefieldPermanent } from '../../../shared/src';

// Engine effects (counter updates computed by SBA)
export type EngineCounterUpdate = {
  readonly permanentId: string;
  readonly counters: Readonly<Record<string, number>>;
};

export type EngineSBAResult = {
  readonly counterUpdates: readonly EngineCounterUpdate[];
  readonly destroys: readonly string[];
};

// Normalize counters: positives only; +1/+1 and -1/-1 cancel pairwise
function normalizeCounters(input?: Readonly<Record<string, number>>): Record<string, number> {
  if (!input) return {};
  const out: Record<string, number> = {};
  for (const [k, vRaw] of Object.entries(input)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (v > 0) out[k] = v;
  }
  const plus = out['+1/+1'] ?? 0;
  const minus = out['-1/-1'] ?? 0;
  if (plus > 0 && minus > 0) {
    const cancel = Math.min(plus, minus);
    const pRem = plus - cancel;
    const mRem = minus - cancel;
    if (pRem > 0) out['+1/+1'] = pRem; else delete out['+1/+1'];
    if (mRem > 0) out['-1/-1'] = mRem; else delete out['-1/-1'];
  }
  return out;
}

function countersEqual(a?: Readonly<Record<string, number>>, b?: Readonly<Record<string, number>>): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  for (const k of ak) if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  return true;
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function derivedToughness(perm: BattlefieldPermanent): number | undefined {
  // First check if it's a creature by type line
  const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return undefined;
  
  // Get base toughness - first try baseToughness property, then parse from card data
  let baseToughness: number | undefined;
  if (isNumber(perm.baseToughness)) {
    baseToughness = perm.baseToughness;
  } else {
    // Parse from card toughness (e.g., "2" or "1+*" or "*")
    const cardToughness = (perm.card as any)?.toughness;
    if (cardToughness !== undefined && cardToughness !== null) {
      const parsed = parseInt(String(cardToughness), 10);
      if (isNumber(parsed)) {
        baseToughness = parsed;
      }
    }
  }
  
  // If we still don't have a valid toughness, return undefined (non-creature or invalid data)
  if (!isNumber(baseToughness)) return undefined;
  
  const plus = perm.counters?.['+1/+1'] ?? 0;
  const minus = perm.counters?.['-1/-1'] ?? 0;
  const net = plus - minus;
  const totalToughness = baseToughness + net;
  // Damage reduces effective toughness for SBA purposes
  // Check 'damage', 'markedDamage', and 'damageMarked' for all damage tracking patterns
  // - 'damage' is used by spell effects (Lightning Bolt, etc.)
  // - 'markedDamage' is used by combat damage
  // - 'damageMarked' is used by triggered ability damage
  const damage = (perm as any).damage ?? (perm as any).markedDamage ?? (perm as any).damageMarked ?? 0;
  return totalToughness - damage;
}

// Pure SBA pass
export function applyStateBasedActions(state: Readonly<GameState>): EngineSBAResult {
  const updates: EngineCounterUpdate[] = [];

  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const normalized = normalizeCounters(perm.counters);
    if (!countersEqual(perm.counters, normalized)) {
      updates.push({ permanentId: perm.id, counters: normalized });
    }
  }

  const destroys: string[] = [];
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const dt = derivedToughness(perm);
    if (isNumber(dt) && dt <= 0) {
      destroys.push(perm.id);
    }
  }

  return { counterUpdates: updates, destroys };
}

// Damage evaluation (wither/infect → -1/-1 counters)
export type EngineAction =
  | { type: 'DEAL_DAMAGE'; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean };

export type EngineEffect =
  | { kind: 'AddCounters'; permanentId: string; counter: string; amount: number }
  | { kind: 'DestroyPermanent'; permanentId: string };

export function evaluateAction(_state: Readonly<GameState>, action: EngineAction): readonly EngineEffect[] {
  switch (action.type) {
    case 'DEAL_DAMAGE': {
      const { amount, wither, infect, targetPermanentId } = action;
      if ((wither || infect) && amount > 0) {
        return [{ kind: 'AddCounters', permanentId: targetPermanentId, counter: '-1/-1', amount }];
      }
      return [];
    }
    default:
      return [];
  }
}