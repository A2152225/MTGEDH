// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: buildAllAbleBlockerRequirementDescription.
// Public entry: buildAllAbleBlockerRequirementDescription.

export function buildAllAbleBlockerRequirementDescription(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = String(target.text || target.raw || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const qualifiedMatch = normalized.match(/^all creatures(?: your opponents control)? with (.+?) able to block$/i);
  if (qualifiedMatch) {
    return `all creatures with ${String(qualifiedMatch[1] || '').trim()} able to block this creature do so`;
  }

  if (/^all creatures(?: your opponents control)? able to block$/i.test(normalized)) {
    return 'all creatures able to block this creature do so';
  }

  return null;
}

