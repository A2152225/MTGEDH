// server/src/state/modules/batch93CounterCause.ts
// B93: Zabaz modular-trigger cause filter for +1/+1 counter replacements.
// Public: counterPlacementCauseIsModularTrigger, overlaySpecsMatchCounterCause.

export function counterPlacementCauseIsModularTrigger(cause: unknown): boolean {
  if (cause == null) return false;
  if (cause === true) return true;
  if (typeof cause === 'string') {
    const t = cause.toLowerCase();
    return t.includes('modular') || t.includes('modular triggered');
  }
  if (typeof cause === 'object') {
    const rec = cause as Record<string, unknown>;
    if (rec.isModular === true || rec.modular === true || rec.isModularTriggeredAbility === true) return true;
    const text = String(rec.abilityText || rec.keyword || rec.kind || rec.cause || rec.type || '');
    return /modular/i.test(text);
  }
  return false;
}

/** Return false when a modular-only spec should not apply to this placement. */
export function overlaySpecsMatchCounterCause(
  spec: { metadata?: any },
  input: { cause?: unknown; isModularTriggeredAbility?: boolean },
): boolean {
  const modularOnly = spec?.metadata?.modularOnly === true || spec?.metadata?.causeIsTriggeredAbility === true;
  if (!modularOnly) return true;
  if (input?.isModularTriggeredAbility === true) return true;
  return counterPlacementCauseIsModularTrigger(input?.cause);
}
