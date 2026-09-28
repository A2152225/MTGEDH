// server/src/state/modules/oracleIrSetPowerToughness.ts
// Rules-engine "has base power and toughness X/Y" / "becomes an X/Y" effects
// (applyTemporarySetBasePowerToughness) write `modifiers` entries of type
// `setPowerToughness` with `setPower` / `setToughness`. CR 613.4b (layer 7b): these set
// P/T after characteristic-defining / base values and before P/T modifications and counters
// (layer 7c). With several setters, the most recent (last) one wins, matching
// rules-engine staticAbilitiesEvaluation. End-of-turn setters are removed in cleanup
// (turnStepCleanup filters `modifiers` with duration end_of_turn).
// Public entry symbols: resolveOracleIrSetPowerToughness.

export interface OracleIrSetPowerToughness {
  power?: number;
  toughness?: number;
}

/** Last rules-engine setPowerToughness modifier on the permanent, or undefined. */
export function resolveOracleIrSetPowerToughness(perm: any): OracleIrSetPowerToughness | undefined {
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers : [];
  let result: OracleIrSetPowerToughness | undefined;
  for (const modifier of modifiers) {
    if (String(modifier?.type || '').trim() !== 'setPowerToughness') continue;
    const setPower = Number(modifier?.setPower);
    const setToughness = Number(modifier?.setToughness);
    const hasPower = modifier?.setPower !== undefined && modifier?.setPower !== null && Number.isFinite(setPower);
    const hasToughness = modifier?.setToughness !== undefined && modifier?.setToughness !== null && Number.isFinite(setToughness);
    if (!hasPower && !hasToughness) continue;
    result = {
      ...(hasPower ? { power: setPower } : { power: result?.power }),
      ...(hasToughness ? { toughness: setToughness } : { toughness: result?.toughness }),
    };
  }
  return result;
}