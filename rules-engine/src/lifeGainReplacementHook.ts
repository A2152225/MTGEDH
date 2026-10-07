/**
 * Life-gain replacement hook for the Oracle IR executor.
 *
 * The executor's gain_life steps run on a plain rules-engine state and know nothing about
 * the server's replacement-effect registry (Angel of Vitality "+1", Rhox Faithmender
 * "twice that much", Tainted Remedy "loses instead", "can't gain life"). The server registers
 * its life-gain replacement pipeline once at startup; gain_life steps ask it for the final
 * signed life delta. With nothing registered the original amount is used unchanged.
 *
 * Public: registerLifeGainAmountResolver, resolveLifeGainDeltaFromHook
 * Leaf: imports nothing from the rest of the rules-engine.
 */
export type LifeGainAmountResolver = (state: any, playerId: string, amount: number) => number;

let registeredResolver: LifeGainAmountResolver | null = null;

export function registerLifeGainAmountResolver(resolver: LifeGainAmountResolver | null): void {
  registeredResolver = resolver;
}

/** Final signed life delta for "playerId would gain amount life" (may be 0 or negative). */
export function resolveLifeGainDeltaFromHook(state: any, playerId: string, amount: number): number {
  if (!registeredResolver || !(amount > 0)) return amount;
  try {
    const next = Number(registeredResolver(state, String(playerId || ''), amount));
    return Number.isFinite(next) ? Math.trunc(next) : amount;
  } catch {
    return amount;
  }
}
