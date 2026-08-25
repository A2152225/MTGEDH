// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeSelfReferenceText.
// Public entry: normalizeSelfReferenceText.

export function normalizeSelfReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

