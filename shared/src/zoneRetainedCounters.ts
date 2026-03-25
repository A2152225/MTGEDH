function getOracleText(obj: any): string {
  return String((obj as any)?.oracle_text || (obj as any)?.card?.oracle_text || '').trim();
}

function getCardName(obj: any): string {
  return String((obj as any)?.name || (obj as any)?.card?.name || '').trim();
}

function normalizeCounters(raw: any): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (String(key).trim().toLowerCase() === 'damage') continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out[String(key)] = amount;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeIdList(raw: any): string[] | undefined {
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out.length > 0 ? out : undefined;
}

export function hasZoneRetainedCountersAbility(obj: any): boolean {
  const oracleText = getOracleText(obj).toLowerCase();
  if (oracleText.includes("counters remain on it as it moves to any zone other than a player's hand or library")) {
    return true;
  }

  return getCardName(obj).toLowerCase() === 'skullbriar, the walking grave';
}

export function buildZoneObjectWithRetainedCounters(card: any, source: any, destinationZone: string): any {
  const nextCard = { ...(card || {}), zone: destinationZone };
  const damageSourceIds = normalizeIdList((source as any)?.damageSourceIds ?? (card as any)?.damageSourceIds);
  if (damageSourceIds) {
    nextCard.damageSourceIds = damageSourceIds;
  } else if ('damageSourceIds' in nextCard) {
    delete nextCard.damageSourceIds;
  }

  if (!hasZoneRetainedCountersAbility(source)) {
    return nextCard;
  }

  if (destinationZone === 'hand' || destinationZone === 'library') {
    if ('counters' in nextCard) delete nextCard.counters;
    return nextCard;
  }

  const counters = normalizeCounters((source as any)?.counters ?? (card as any)?.counters);
  if (counters) nextCard.counters = counters;
  else if ('counters' in nextCard) delete nextCard.counters;
  return nextCard;
}

export function mergeRetainedCountersForBattlefieldEntry(
  card: any,
  sourceZone: string,
  addedCounters?: Record<string, number>
): Record<string, number> | undefined {
  const retained =
    sourceZone !== 'hand' && sourceZone !== 'library' && hasZoneRetainedCountersAbility(card)
      ? normalizeCounters((card as any)?.counters)
      : undefined;

  if (!retained && !addedCounters) return undefined;

  return {
    ...(retained || {}),
    ...(addedCounters || {}),
  };
}
