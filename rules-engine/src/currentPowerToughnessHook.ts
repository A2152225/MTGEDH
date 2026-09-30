/**
 * Current power/toughness hook for rules-engine readers that have a game state but no access to the
 * server's shared calculation (AI evaluation, combat scoring, mana-power reads).
 *
 * The server registers the shared current P/T calculation (the same numbers the battlefield badge shows:
 * anthems, pumps, set-base effects, counters, long-duration modifiers) once at startup. Readers call
 * readCurrentPowerFromHook(state, permanent); it answers null when nothing is registered, the permanent
 * is not on the battlefield, or the calculation has no numeric P/T, so callers keep their previous
 * behavior for non-battlefield objects and for stand-alone rules-engine use.
 *
 * Public: registerCurrentPowerToughnessResolver, readCurrentPowerFromHook, readCurrentToughnessFromHook
 * Leaf: imports nothing from the rest of the rules-engine.
 */
export type CurrentPowerToughnessResolver = (
  state: any,
  permanent: any,
) => { power: number; toughness: number } | undefined;

let registeredResolver: CurrentPowerToughnessResolver | null = null;

export function registerCurrentPowerToughnessResolver(resolver: CurrentPowerToughnessResolver | null): void {
  registeredResolver = resolver;
}

function isOnBattlefield(state: any, permanent: any): any | null {
  const id = String(permanent?.id || '').trim();
  if (!id || !Array.isArray(state?.battlefield)) return null;
  return state.battlefield.find((entry: any) => String(entry?.id || '').trim() === id) || null;
}

function readStat(state: any, permanent: any, stat: 'power' | 'toughness'): number | null {
  if (!registeredResolver || !state) return null;
  const onBattlefield = isOnBattlefield(state, permanent);
  if (!onBattlefield) return null;
  try {
    const current = registeredResolver(state, onBattlefield);
    const value = Number(current?.[stat]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function readCurrentPowerFromHook(state: any, permanent: any): number | null {
  return readStat(state, permanent, 'power');
}

export function readCurrentToughnessFromHook(state: any, permanent: any): number | null {
  return readStat(state, permanent, 'toughness');
}