import type { FutureSpellEffect, GameState, PlayerID } from '../../shared/src';

type CounterImmunityMetadata = {
  readonly unconditional?: boolean;
  readonly counterSourceColors?: readonly string[];
};

export interface FutureSpellCastAdjustments {
  readonly grantsFlashTiming: boolean;
  readonly counterImmunity?: CounterImmunityMetadata;
  readonly castedPermanentEntersWithCounters?: Record<string, number>;
}

const COLOR_SYMBOLS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeCardTypes(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeCounterSourceColors(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    const parts = String(raw || '')
      .split(/(?:,|\/|\bor\b|\band\b)+/i)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const lower = part.toLowerCase();
      const normalized = ['W', 'U', 'B', 'R', 'G'].includes(part.toUpperCase())
        ? part.toUpperCase()
        : COLOR_SYMBOLS[lower];
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}

function normalizeCounterImmunity(value: unknown): CounterImmunityMetadata | undefined {
  if (!value || value === false) return undefined;

  if (value === true) {
    return { unconditional: true };
  }

  if (Array.isArray(value)) {
    const colors = normalizeCounterSourceColors(value);
    return colors.length > 0 ? { counterSourceColors: colors } : undefined;
  }

  if (typeof value !== 'object') return undefined;

  const raw = value as Record<string, unknown>;
  const counterSourceColors = normalizeCounterSourceColors(
    raw.counterSourceColors ??
      raw.sourceColors ??
      raw.onlyAgainstSourceColors ??
      raw.cantBeCounteredBySourceColors
  );
  const unconditional =
    Boolean(raw.unconditional) ||
    Boolean(raw.cantBeCountered);

  if (!unconditional && counterSourceColors.length === 0) {
    return undefined;
  }

  return {
    ...(unconditional ? { unconditional: true } : {}),
    ...(counterSourceColors.length > 0 ? { counterSourceColors } : {}),
  };
}

function normalizeEntryCounters(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const out: Record<string, number> = {};
  for (const [counterName, amountRaw] of Object.entries(value as Record<string, unknown>)) {
    const amount = Number(amountRaw || 0);
    if (!counterName || !Number.isFinite(amount) || amount === 0) continue;
    out[counterName] = (out[counterName] || 0) + amount;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeCounterImmunity(
  left?: CounterImmunityMetadata,
  right?: CounterImmunityMetadata,
): CounterImmunityMetadata | undefined {
  if (!left) return right;
  if (!right) return left;

  const mergedColors = Array.from(
    new Set([...(left.counterSourceColors || []), ...(right.counterSourceColors || [])])
  );
  const merged: CounterImmunityMetadata = {
    ...(left.unconditional || right.unconditional ? { unconditional: true } : {}),
    ...(mergedColors.length > 0 ? { counterSourceColors: mergedColors } : {}),
  };

  return merged.unconditional || (merged.counterSourceColors && merged.counterSourceColors.length > 0)
    ? merged
    : undefined;
}

function mergeEntryCounters(
  left?: Record<string, number>,
  right?: Record<string, number>,
): Record<string, number> | undefined {
  if (!left) return right ? { ...right } : undefined;
  if (!right) return { ...left };

  const out: Record<string, number> = { ...left };
  for (const [counterName, amount] of Object.entries(right)) {
    out[counterName] = (out[counterName] || 0) + Number(amount || 0);
  }
  return out;
}

function sanitizeEffectIdPart(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCardLikeTypeLine(cardLike: any): string {
  return String(
    cardLike?.type_line ||
      cardLike?.typeLine ||
      cardLike?.card?.type_line ||
      cardLike?.card?.typeLine ||
      ''
  )
    .toLowerCase()
    .trim();
}

function getCardLikeTypes(cardLike: any): string[] {
  const explicit = normalizeCardTypes(cardLike?.cardTypes);
  const typeLine = getCardLikeTypeLine(cardLike);
  const inferred = [
    'artifact',
    'battle',
    'creature',
    'enchantment',
    'instant',
    'kindred',
    'land',
    'planeswalker',
    'sorcery',
  ].filter(type => typeLine.includes(type));
  const all = [...explicit, ...inferred];
  return Array.from(new Set(all));
}

function getFutureSpellEffects(state: GameState): FutureSpellEffect[] {
  const rawEffects = Array.isArray((state as any).futureSpellEffects)
    ? ((state as any).futureSpellEffects as any[])
    : [];
  const normalized: FutureSpellEffect[] = [];

  for (const rawEffect of rawEffects) {
    if (!rawEffect || typeof rawEffect !== 'object') continue;

    const controllerId = String((rawEffect as any).controllerId || '').trim() as PlayerID;
    if (!controllerId) continue;

    const counterImmunity = normalizeCounterImmunity((rawEffect as any).counterImmunity);
    const castedPermanentEntersWithCounters = normalizeEntryCounters((rawEffect as any).castedPermanentEntersWithCounters);
    const cardTypes = normalizeCardTypes((rawEffect as any).cardTypes);

    normalized.push({
      id: String((rawEffect as any).id || '').trim() || `future-spell-${controllerId}-${normalized.length + 1}`,
      controllerId,
      ...(String((rawEffect as any).sourceId || '').trim() ? { sourceId: String((rawEffect as any).sourceId).trim() } : {}),
      ...(String((rawEffect as any).sourceName || '').trim() ? { sourceName: String((rawEffect as any).sourceName).trim() } : {}),
      duration: 'this_turn',
      scope: (rawEffect as any).scope === 'next_qualifying_spell' ? 'next_qualifying_spell' : 'all_qualifying_spells',
      ...(cardTypes.length > 0 ? { cardTypes } : {}),
      ...((rawEffect as any).timingPermission === 'as_though_flash' ? { timingPermission: 'as_though_flash' as const } : {}),
      ...(counterImmunity ? { counterImmunity } : {}),
      ...(castedPermanentEntersWithCounters ? { castedPermanentEntersWithCounters } : {}),
    });
  }

  return normalized;
}

function summarizeFutureSpellEffects(effects: readonly FutureSpellEffect[]): FutureSpellCastAdjustments {
  let grantsFlashTiming = false;
  let counterImmunity: CounterImmunityMetadata | undefined;
  let castedPermanentEntersWithCounters: Record<string, number> | undefined;

  for (const effect of effects) {
    if (effect.timingPermission === 'as_though_flash') {
      grantsFlashTiming = true;
    }
    counterImmunity = mergeCounterImmunity(counterImmunity, normalizeCounterImmunity(effect.counterImmunity));
    castedPermanentEntersWithCounters = mergeEntryCounters(
      castedPermanentEntersWithCounters,
      normalizeEntryCounters(effect.castedPermanentEntersWithCounters)
    );
  }

  return {
    grantsFlashTiming,
    ...(counterImmunity ? { counterImmunity } : {}),
    ...(castedPermanentEntersWithCounters ? { castedPermanentEntersWithCounters } : {}),
  };
}

function futureSpellEffectMatchesCard(effect: FutureSpellEffect, cardLike: any): boolean {
  const effectCardTypes = normalizeCardTypes(effect.cardTypes);
  if (effectCardTypes.length === 0) return true;

  const cardTypes = getCardLikeTypes(cardLike);
  return effectCardTypes.every(type => cardTypes.includes(type));
}

function futureSpellEffectMatchesStackItem(effect: FutureSpellEffect, stackItem: any): boolean {
  const stackController = String(
    stackItem?.controller || stackItem?.controllerId || stackItem?.owner || stackItem?.ownerId || ''
  ).trim();
  if (!stackController || stackController !== String(effect.controllerId || '').trim()) {
    return false;
  }

  return futureSpellEffectMatchesCard(effect, stackItem?.card || stackItem);
}

export function addFutureSpellEffect(
  state: GameState,
  effect: Omit<FutureSpellEffect, 'id'> & { readonly id?: string },
): GameState {
  const existing = getFutureSpellEffects(state);
  const nextId = String(effect.id || '').trim() || [
    'future-spell',
    sanitizeEffectIdPart(effect.controllerId),
    sanitizeEffectIdPart(effect.sourceId || effect.sourceName || 'effect'),
    String(existing.length + 1),
  ]
    .filter(Boolean)
    .join('-');

  const nextEffect: FutureSpellEffect = {
    id: nextId,
    controllerId: effect.controllerId,
    ...(effect.sourceId ? { sourceId: effect.sourceId } : {}),
    ...(effect.sourceName ? { sourceName: effect.sourceName } : {}),
    duration: 'this_turn',
    scope: effect.scope,
    ...(normalizeCardTypes(effect.cardTypes).length > 0 ? { cardTypes: normalizeCardTypes(effect.cardTypes) } : {}),
    ...(effect.timingPermission === 'as_though_flash' ? { timingPermission: 'as_though_flash' as const } : {}),
    ...(normalizeCounterImmunity(effect.counterImmunity) ? { counterImmunity: normalizeCounterImmunity(effect.counterImmunity) } : {}),
    ...(normalizeEntryCounters(effect.castedPermanentEntersWithCounters)
      ? { castedPermanentEntersWithCounters: normalizeEntryCounters(effect.castedPermanentEntersWithCounters) }
      : {}),
  };

  return {
    ...(state as any),
    futureSpellEffects: [...existing, nextEffect],
  } as GameState;
}

export function clearFutureSpellEffects(state: GameState): GameState {
  if (!Array.isArray((state as any).futureSpellEffects) || ((state as any).futureSpellEffects as any[]).length === 0) {
    return state;
  }

  return {
    ...(state as any),
    futureSpellEffects: [],
  } as GameState;
}

export function previewFutureSpellCastAdjustments(
  state: GameState,
  controllerId: string,
  cardLike: any,
): FutureSpellCastAdjustments {
  const matchingEffects = getFutureSpellEffects(state).filter(
    effect => String(effect.controllerId || '').trim() === String(controllerId || '').trim() && futureSpellEffectMatchesCard(effect, cardLike)
  );

  return summarizeFutureSpellEffects(matchingEffects);
}

export function consumeFutureSpellCastAdjustments(
  state: GameState,
  controllerId: string,
  cardLike: any,
): { readonly state: GameState; readonly adjustments: FutureSpellCastAdjustments } {
  const effects = getFutureSpellEffects(state);
  const matchingEffects = effects.filter(
    effect => String(effect.controllerId || '').trim() === String(controllerId || '').trim() && futureSpellEffectMatchesCard(effect, cardLike)
  );
  const consumedEffectIds = new Set(
    matchingEffects
      .filter(effect => effect.scope === 'next_qualifying_spell')
      .map(effect => String(effect.id || '').trim())
      .filter(Boolean)
  );

  return {
    state:
      consumedEffectIds.size > 0
        ? ({
            ...(state as any),
            futureSpellEffects: effects.filter(effect => !consumedEffectIds.has(String(effect.id || '').trim())),
          } as GameState)
        : state,
    adjustments: summarizeFutureSpellEffects(matchingEffects),
  };
}

export function getStateGrantedCounterImmunityForSpell(
  state: GameState,
  stackItem: any,
): CounterImmunityMetadata | undefined {
  const matchingEffects = getFutureSpellEffects(state).filter(
    effect => effect.scope === 'all_qualifying_spells' && normalizeCounterImmunity(effect.counterImmunity) && futureSpellEffectMatchesStackItem(effect, stackItem)
  );

  return summarizeFutureSpellEffects(matchingEffects).counterImmunity;
}