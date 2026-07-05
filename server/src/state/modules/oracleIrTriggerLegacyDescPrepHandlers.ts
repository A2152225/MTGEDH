
export function computeTriggerLegacyIsKynaiosEffect(
  sourceName: string,
  triggerItem: any,
  desc: string,
): boolean {
  const sourceNameLower = String(sourceName || '').toLowerCase();
  const triggerSourceNameLower = String(triggerItem?.sourceName || triggerItem?.card?.name || '').toLowerCase();
  return (
    sourceNameLower.includes('kynaios and tiro of meletis')
    || triggerSourceNameLower.includes('kynaios and tiro of meletis')
    || (desc.includes('each player may put a land') && desc.includes('opponent') && desc.includes('draws a card'))
  );
}

export function stripTriggerLegacyInterveningIfPrefix(desc: string): string {
  let normalizedDesc = String(desc || '');
  if (/^if\s+/.test(normalizedDesc) && normalizedDesc.includes(',') && !/^if\s+you\s+do\b/.test(normalizedDesc)) {
    const commaIndex = normalizedDesc.indexOf(',');
    if (commaIndex > 0) {
      const maybeClause = normalizedDesc.slice(0, commaIndex);
      if (!/^if\s+you\s+do\b/.test(maybeClause)) {
        normalizedDesc = normalizedDesc.slice(commaIndex + 1).trim();
      }
    }
  }
  return normalizedDesc;
}

export function computeTriggerLegacySourceNames(
  sourceName: string,
  triggerItem: any,
): { readonly sourceNameLower: string; readonly triggerSourceNameLower: string; readonly triggerSourceId: string } {
  return {
    sourceNameLower: String(sourceName || '').toLowerCase(),
    triggerSourceNameLower: String(triggerItem?.sourceName || triggerItem?.card?.name || '').toLowerCase(),
    triggerSourceId: String(
      triggerItem?.id ||
      triggerItem?.sourceId ||
      triggerItem?.source ||
      triggerItem?.permanentId ||
      '',
    ).trim(),
  };
}
