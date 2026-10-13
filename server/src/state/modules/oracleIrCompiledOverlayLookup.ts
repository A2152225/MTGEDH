import type { OracleIRCompilerEnvelope } from '../../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { lookupCompiledOracleIROverlaySync } from '../../services/oracleIrCompiledOverlayStore.js';
import { lookupLocalCardOracleIdByNameSync } from '../../services/localCardLookup.js';

export interface OracleCardLookupKeys {
  readonly cardId?: string;
  readonly cardName?: string;
}

export interface CollectOracleEffectStepsOptions {
  readonly compiledOverlay?: OracleIRCompilerEnvelope | null;
  readonly overlayOptions?: import('../../../../rules-engine/src/oracleIRCompilerEnvelope.js').ResolveOracleIRWithOverlayOptions;
  readonly cardId?: string;
  readonly cardName?: string;
}

function looksLikeOracleCardId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readNestedString(value: unknown, keys: readonly string[]): string {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  return String(current || '').trim();
}

function readOracleCardIdFromRecord(value: unknown): string {
  if (!value || typeof value !== 'object') return '';

  const direct = readNestedString(value, ['oracle_id'])
    || readNestedString(value, ['oracleId']);
  if (direct) return direct;

  const nestedCardId = readNestedString(value, ['card', 'oracle_id'])
    || readNestedString(value, ['card', 'oracleId'])
    || readNestedString(value, ['card', 'id']);
  if (nestedCardId && looksLikeOracleCardId(nestedCardId)) {
    return nestedCardId;
  }

  const rawId = readNestedString(value, ['id']);
  return looksLikeOracleCardId(rawId) ? rawId : '';
}

function readCardNameFromRecord(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return readNestedString(value, ['name'])
    || readNestedString(value, ['card', 'name'])
    || readNestedString(value, ['sourceName']);
}

export function extractOracleCardLookupKeys(input: {
  readonly cardId?: string;
  readonly cardName?: string;
  readonly sourceName?: string;
  readonly card?: unknown;
  readonly effectiveCard?: unknown;
  readonly sourceItem?: unknown;
  readonly triggerItem?: unknown;
}): OracleCardLookupKeys {
  const explicitCardId = String(input.cardId || '').trim();
  const explicitCardName = String(input.cardName || input.sourceName || '').trim();

  const candidates = [
    input.effectiveCard,
    input.card,
    input.sourceItem,
    input.triggerItem,
  ].filter(Boolean);

  let cardId = explicitCardId;
  let cardName = explicitCardName;

  for (const candidate of candidates) {
    if (!cardId) {
      cardId = readOracleCardIdFromRecord(candidate);
    }
    if (!cardName) {
      cardName = readCardNameFromRecord(candidate);
    }
  }

  if (!cardId && cardName) {
    const localOracleId = lookupLocalCardOracleIdByNameSync(cardName);
    if (localOracleId && looksLikeOracleCardId(localOracleId)) {
      cardId = localOracleId;
    }
  }

  return {
    ...(cardId ? { cardId } : {}),
    ...(cardName ? { cardName } : {}),
  };
}

export function buildOracleOverlayCollectOptions(input: {
  readonly cardId?: string;
  readonly cardName?: string;
  readonly sourceName?: string;
  readonly card?: unknown;
  readonly effectiveCard?: unknown;
  readonly sourceItem?: unknown;
  readonly triggerItem?: unknown;
}): CollectOracleEffectStepsOptions {
  return extractOracleCardLookupKeys(input);
}
export function resolveCompiledOverlayForCard(
  options?: CollectOracleEffectStepsOptions,
): OracleIRCompilerEnvelope | null {
  if (options?.compiledOverlay) {
    return options.compiledOverlay;
  }

  const cardId = String(options?.cardId || '').trim();
  const cardName = String(options?.cardName || '').trim();
  if (!cardId && !cardName) {
    return null;
  }

  return lookupCompiledOracleIROverlaySync({
    cardId: cardId || undefined,
    name: cardName || undefined,
  });
}
