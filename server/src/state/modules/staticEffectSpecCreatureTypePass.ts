// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster moved: declarative type-addition merge plus the in-pass stamp that
// later layers (angel lords, etc.) read via permanentHasCreatureType.
// Public entry symbols: seedContinuousTypeAdditionsForStaticPass, recordDeclarativeTypeAdditions.

export function seedContinuousTypeAdditionsForStaticPass(
  battlefield: readonly { id?: string }[],
  typeAdditions: ReadonlyMap<string, readonly string[]>,
): void {
  for (const permanent of battlefield) {
    if (!permanent) continue;
    const id = String(permanent.id || '');
    (permanent as { continuousTypeAdditions?: string[] }).continuousTypeAdditions = [
      ...(typeAdditions.get(id) || []),
    ];
  }
}

export function recordDeclarativeTypeAdditions(
  result: { typeAdditions: Map<string, string[]> },
  permanent: { id?: string },
  typeAdds: readonly string[] | undefined,
): void {
  const adds = Array.isArray(typeAdds) ? typeAdds : [];
  if (adds.length === 0) return;
  const permanentId = String(permanent?.id || '');
  if (!permanentId) return;
  const existing = result.typeAdditions.get(permanentId) || [];
  const merged = [...existing];
  for (const typeName of adds) {
    const normalized = String(typeName || '').trim();
    if (normalized && !merged.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      merged.push(normalized);
    }
  }
  result.typeAdditions.set(permanentId, merged);
  (permanent as { continuousTypeAdditions?: string[] }).continuousTypeAdditions = merged;
}
