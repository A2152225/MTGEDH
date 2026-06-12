/**
 * When a malformed stack item merges a static ability into the trigger description,
 * keep only the first sentence of the extracted effect clause.
 */
function trimMergedStaticAbilityTail(effectClause: string): string {
  const trimmed = effectClause.trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx === -1) return trimmed;

  const afterDot = trimmed.slice(dotIdx + 1).trim();
  if (/^(creatures|this creature|this artifact|this permanent|equipped|at the beginning|other|all)/i.test(afterDot)) {
    return trimmed.slice(0, dotIdx).trim();
  }

  return trimmed;
}

/**
 * Resolve the effect clause text for a triggered-ability stack item.
 * Prefer explicit `effect`; fall back to parsing `description` for known shapes.
 */
export function resolveTriggerStackItemEffectText(item: any): string {
  const effect = String(item?.effect || '').trim();
  if (effect) return effect;

  const description = String(item?.description || '').trim();
  if (!description) return '';

  const triggerType = String(item?.triggerType || '').trim();
  if (triggerType === 'cast_creature_type') {
    const tribalMatch = description.match(
      /whenever you cast an? [^.]+ spell,?\s*(.+)$/i,
    );
    if (tribalMatch?.[1]) {
      return trimMergedStaticAbilityTail(String(tribalMatch[1]).trim());
    }

    const chosenTypeMatch = description.match(
      /whenever you cast a spell of the chosen type,?\s*(.+)$/i,
    );
    if (chosenTypeMatch?.[1]) {
      return trimMergedStaticAbilityTail(String(chosenTypeMatch[1]).trim());
    }
  }

  return description;
}
