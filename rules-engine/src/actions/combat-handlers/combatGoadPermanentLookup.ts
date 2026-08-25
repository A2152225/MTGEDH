// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: getPermanentForGoadAnalysis.
// Public entry symbols: getPermanentForGoadAnalysis.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

export function getPermanentForGoadAnalysis(permanent: any, battlefield?: any[]): any {
  if (!permanent) return permanent;
  const permanentId = String((permanent as any)?.id || '').trim();
  if (!permanentId || !Array.isArray(battlefield) || battlefield.length === 0) return permanent;
  return battlefield.find((candidate: any) => String((candidate as any)?.id || '').trim() === permanentId) || permanent;
}
