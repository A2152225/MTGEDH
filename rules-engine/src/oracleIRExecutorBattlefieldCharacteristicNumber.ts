// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: readCharacteristicNumber.
// Public entry: readCharacteristicNumber.

export function readCharacteristicNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

