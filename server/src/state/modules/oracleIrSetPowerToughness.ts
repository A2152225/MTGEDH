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

/** One rules-engine setter with its ordering data (layer 7b, CR 613.7). */
export interface OracleIrSetPowerToughnessSetter extends OracleIrSetPowerToughness {
  /** Strictly increasing creation timestamp; undefined for legacy modifiers without one. */
  timestamp?: number;
  battlefieldPosition?: number;
  battlefieldAnchorId?: string;
  /** True when `timestamp` came from the game-wide permanent timestamp counter (exact ordering). */
  globalTimestamp?: boolean;
}

/** All setPowerToughness modifiers on the permanent in array (creation) order. */
export function listOracleIrSetPowerToughnessSetters(perm: any): OracleIrSetPowerToughnessSetter[] {
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers : [];
  const setters: OracleIrSetPowerToughnessSetter[] = [];
  for (const modifier of modifiers) {
    if (String(modifier?.type || '').trim() !== 'setPowerToughness') continue;
    const setPower = Number(modifier?.setPower);
    const setToughness = Number(modifier?.setToughness);
    const hasPower = modifier?.setPower !== undefined && modifier?.setPower !== null && Number.isFinite(setPower);
    const hasToughness = modifier?.setToughness !== undefined && modifier?.setToughness !== null && Number.isFinite(setToughness);
    if (!hasPower && !hasToughness) continue;
    const timestamp = Number(modifier?.timestamp);
    const position = Number(modifier?.battlefieldPosition);
    const anchorId = String(modifier?.battlefieldAnchorId || '').trim();
    setters.push({
      ...(hasPower ? { power: setPower } : {}),
      ...(hasToughness ? { toughness: setToughness } : {}),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      ...(Number.isFinite(position) ? { battlefieldPosition: position } : {}),
      ...(anchorId ? { battlefieldAnchorId: anchorId } : {}),
      ...(modifier?.globalTimestamp === true && Number.isFinite(timestamp) ? { globalTimestamp: true } : {}),
    });
  }
  return setters;
}

/**
 * Winning rules-engine setPowerToughness values on the permanent (latest timestamp per component;
 * legacy modifiers without a timestamp fall back to array order), or undefined.
 */
export function resolveOracleIrSetPowerToughness(perm: any): OracleIrSetPowerToughness | undefined {
  const setters = listOracleIrSetPowerToughnessSetters(perm);
  if (setters.length === 0) return undefined;
  const ordered = setters
    .map((setter, index) => ({ setter, index }))
    .sort((left, right) => {
      const leftTs = Number.isFinite(left.setter.timestamp) ? (left.setter.timestamp as number) : Number.NEGATIVE_INFINITY;
      const rightTs = Number.isFinite(right.setter.timestamp) ? (right.setter.timestamp as number) : Number.NEGATIVE_INFINITY;
      // Legacy (untimestamped) setters keep array order and come before stamped ones.
      return (leftTs - rightTs) || (left.index - right.index);
    });
  let result: OracleIrSetPowerToughness | undefined;
  for (const { setter } of ordered) {
    result = {
      power: setter.power ?? result?.power,
      toughness: setter.toughness ?? result?.toughness,
    };
  }
  return result;
}