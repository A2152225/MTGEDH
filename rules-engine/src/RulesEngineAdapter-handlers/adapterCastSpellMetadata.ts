// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: cast-spell metadata helpers (payment, counters, flash, immunity).
// Public entry symbols: getCastMetadataValue, normalizeManaPaymentRecord, normalizeColorSymbols,
// normalizeCounterImmunityMetadata, buildCastSpellMetadata, deriveSelfEntryCounterMetadata,
// normalizeTypePhrase, typeLineContainsChosenType, deriveTappedSourceCounterImmunity,
// mergeCastSpellMetadata, appendFlashType, mergeEntryCounterMaps.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { deriveSelfEntryCountersFromOracleIR } from '../oracleIRSelfEntryCounters';
import type { ManaPaymentRecord } from '../types/costs';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterCastSpellMetadataHost = any;

export function getCastMetadataValue(action: any, sourceCard: any, field: string): any {
    if (action && action[field] !== undefined) return action[field];
    if (action?.card && action.card[field] !== undefined) return action.card[field];
    if (sourceCard && sourceCard[field] !== undefined) return sourceCard[field];
    return undefined;
  }

export function normalizeManaPaymentRecord(value: unknown): ManaPaymentRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const source = value as Record<string, unknown>;
    const normalized: Record<keyof ManaPaymentRecord, number> = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    };
    let used = false;

    for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless', 'generic'] as const) {
      const amount = Number(source[key]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      normalized[key] = amount;
      used = true;
    }

    return used ? (normalized as ManaPaymentRecord) : undefined;
  }

export function normalizeColorSymbols(value: unknown): readonly string[] | undefined {
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
        const normalized =
          lower === 'w' || lower === 'white'
            ? 'W'
            : lower === 'u' || lower === 'blue'
              ? 'U'
              : lower === 'b' || lower === 'black'
                ? 'B'
                : lower === 'r' || lower === 'red'
                  ? 'R'
                  : lower === 'g' || lower === 'green'
                    ? 'G'
                    : undefined;
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
      }
    }

    return out.length > 0 ? out : undefined;
  }

export function normalizeCounterImmunityMetadata(
    rawValue: unknown,
    directCantBeCountered: unknown,
    directCounterSourceColors: readonly string[] | undefined,
  ):
    | { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] }
    | undefined {
    const unconditional =
      Boolean(directCantBeCountered) ||
      rawValue === true ||
      Boolean((rawValue as any)?.unconditional) ||
      Boolean((rawValue as any)?.cantBeCountered);

    const nestedCounterSourceColors = Array.isArray(rawValue)
      ? this.normalizeColorSymbols(rawValue)
      : this.normalizeColorSymbols(
          (rawValue as any)?.counterSourceColors ??
            (rawValue as any)?.sourceColors ??
            (rawValue as any)?.onlyAgainstSourceColors ??
            (rawValue as any)?.cantBeCounteredBySourceColors
        );
    const counterSourceColors = directCounterSourceColors ?? nestedCounterSourceColors;

    if (!unconditional && (!counterSourceColors || counterSourceColors.length === 0)) {
      return undefined;
    }

    return {
      ...(unconditional ? { unconditional: true } : {}),
      ...(counterSourceColors && counterSourceColors.length > 0
        ? { counterSourceColors }
        : {}),
    };
  }

export function buildCastSpellMetadata(action: any, sourceCard: any): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    const explicitEntryCounters = this.getCastMetadataValue(action, sourceCard, 'entersBattlefieldWithCounters');
    const derivedEntryCounters = this.deriveSelfEntryCounterMetadata(action, sourceCard);
    const mergedEntryCounters = this.mergeEntryCounterMaps(explicitEntryCounters, derivedEntryCounters);
    if (mergedEntryCounters) {
      metadata.entersBattlefieldWithCounters = mergedEntryCounters;
    }

    const manaPayment = this.normalizeManaPaymentRecord(this.getCastMetadataValue(action, sourceCard, 'manaPayment'));
    if (manaPayment) {
      metadata.manaPayment = manaPayment;
    }

    const manaSpentTotalValue = this.getCastMetadataValue(action, sourceCard, 'manaSpentTotal');
    const manaSpentTotal = Number(manaSpentTotalValue);
    if (Number.isFinite(manaSpentTotal)) {
      metadata.manaSpentTotal = Math.max(0, manaSpentTotal);
    }

    const manaSpentColors = this.normalizeColorSymbols(this.getCastMetadataValue(action, sourceCard, 'manaSpentColors'));
    if (manaSpentColors && manaSpentColors.length > 0) {
      metadata.manaSpentColors = manaSpentColors;
    }

    const manaSpentSymbolsValue = this.getCastMetadataValue(action, sourceCard, 'manaSpentSymbols');
    if (Array.isArray(manaSpentSymbolsValue)) {
      metadata.manaSpentSymbols = [...manaSpentSymbolsValue];
    } else if (manaSpentSymbolsValue && typeof manaSpentSymbolsValue === 'object') {
      metadata.manaSpentSymbols = { ...(manaSpentSymbolsValue as Record<string, unknown>) };
    }

    const directCounterSourceColors = this.normalizeColorSymbols(
      this.getCastMetadataValue(action, sourceCard, 'cantBeCounteredBySourceColors')
    );
    const counterImmunity = this.normalizeCounterImmunityMetadata(
      this.getCastMetadataValue(action, sourceCard, 'counterImmunity'),
      this.getCastMetadataValue(action, sourceCard, 'cantBeCountered'),
      directCounterSourceColors,
    );

    if (counterImmunity?.unconditional) {
      metadata.cantBeCountered = true;
    }
    if (counterImmunity?.counterSourceColors && counterImmunity.counterSourceColors.length > 0) {
      metadata.cantBeCounteredBySourceColors = counterImmunity.counterSourceColors;
    }
    if (counterImmunity) {
      metadata.counterImmunity = counterImmunity;
    }

    return metadata;
  }

export function deriveSelfEntryCounterMetadata(action: any, sourceCard: any): Record<string, number> | undefined {
    const cardName = String(action?.cardName || action?.card?.name || sourceCard?.name || '').trim();
    const rawOracleText = String(
      action?.oracleText || action?.card?.oracle_text || sourceCard?.oracle_text || ''
    ).trim();
    if (!rawOracleText) return undefined;

    const wasCastKicked = (() => {
      const explicitWasKicked = this.getCastMetadataValue(action, sourceCard, 'wasKicked');
      if (typeof explicitWasKicked === 'boolean') return explicitWasKicked;

      for (const field of ['kickerPaidCount', 'timesKicked', 'kickedTimes'] as const) {
        const rawValue = this.getCastMetadataValue(action, sourceCard, field);
        const numericValue = Number(rawValue);
        if (Number.isFinite(numericValue)) return numericValue > 0;
      }

      return false;
    })();

    const xValue = Number(action?.xValue);
    return deriveSelfEntryCountersFromOracleIR({
      oracleText: rawOracleText,
      cardName: cardName || undefined,
      xValue: Number.isFinite(xValue) ? xValue : undefined,
      wasKicked: wasCastKicked,
    });
  }

export function normalizeTypePhrase(value: unknown): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .trim();
  }

export function typeLineContainsChosenType(typeLine: unknown, chosenType: unknown): boolean {
    const normalizedTypeLine = this.normalizeTypePhrase(typeLine);
    const normalizedChosenType = this.normalizeTypePhrase(chosenType);
    if (!normalizedTypeLine || !normalizedChosenType) return false;
    const escapedChosenType = normalizedChosenType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${escapedChosenType}(?=$|\\s)`, 'i').test(normalizedTypeLine);
  }

export function deriveTappedSourceCounterImmunity(
    state: GameState,
    action: any,
    castCard: any,
  ):
    | { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] }
    | undefined {
    const tappedPermanentIds = Array.isArray(action?.tappedPermanents)
      ? action.tappedPermanents.map((id: any) => String(id || '').trim()).filter(Boolean)
      : [];
    if (tappedPermanentIds.length === 0) return undefined;

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const battlefieldById = new Map(
      battlefield
        .map((permanent: any) => [String(permanent?.id || '').trim(), permanent] as const)
        .filter(([id]) => Boolean(id))
    );

    const controllerId = String(action?.playerId || '').trim();
    const typeLine = String(castCard?.type_line || '');
    const typeLineLower = typeLine.toLowerCase();
    const isLegendarySpell = /(^|[^a-z])legendary(?=$|[^a-z])/i.test(typeLineLower);
    const isCreatureSpell = /(^|[^a-z])creature(?=$|[^a-z])/i.test(typeLineLower);
    const isInstantOrSorcerySpell =
      /(^|[^a-z])instant(?=$|[^a-z])/i.test(typeLineLower) ||
      /(^|[^a-z])sorcery(?=$|[^a-z])/i.test(typeLineLower);

    for (const permanentId of tappedPermanentIds) {
      const source = battlefieldById.get(permanentId);
      if (!source) continue;

      const sourceControllerId = String(source?.controller || source?.controllerId || '').trim();
      if (sourceControllerId && controllerId && sourceControllerId !== controllerId) continue;

      const sourceName = String(source?.card?.name || source?.name || '').trim().toLowerCase();
      if (!sourceName) continue;

      if (sourceName === 'delighted halfling' && isLegendarySpell) {
        return { unconditional: true };
      }

      if (sourceName === 'boseiju, who shelters all' && isInstantOrSorcerySpell) {
        return { unconditional: true };
      }

      if (sourceName === 'cavern of souls' && isCreatureSpell) {
        const chosenCreatureType = String(source?.chosenCreatureType || source?.card?.chosenCreatureType || '').trim();
        if (chosenCreatureType && this.typeLineContainsChosenType(typeLine, chosenCreatureType)) {
          return { unconditional: true };
        }
      }
    }

    return undefined;
  }

export function mergeCastSpellMetadata(
    baseMetadata: Record<string, unknown>,
    extraCounterImmunity?: { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] },
  ): Record<string, unknown> {
    if (!extraCounterImmunity) return baseMetadata;

    const existingCounterSourceColors = this.normalizeColorSymbols(baseMetadata.cantBeCounteredBySourceColors);
    const existingCounterImmunity = this.normalizeCounterImmunityMetadata(
      baseMetadata.counterImmunity,
      baseMetadata.cantBeCountered,
      existingCounterSourceColors,
    );

    const mergedCounterSourceColors = Array.from(
      new Set([
        ...(existingCounterImmunity?.counterSourceColors || []),
        ...(extraCounterImmunity.counterSourceColors || []),
      ])
    );
    const mergedCounterImmunity = this.normalizeCounterImmunityMetadata(
      {
        unconditional: Boolean(existingCounterImmunity?.unconditional) || Boolean(extraCounterImmunity.unconditional),
        counterSourceColors: mergedCounterSourceColors,
      },
      false,
      mergedCounterSourceColors,
    );
    if (!mergedCounterImmunity) return baseMetadata;

    return {
      ...baseMetadata,
      ...(mergedCounterImmunity.unconditional ? { cantBeCountered: true } : {}),
      ...(mergedCounterImmunity.counterSourceColors && mergedCounterImmunity.counterSourceColors.length > 0
        ? { cantBeCounteredBySourceColors: mergedCounterImmunity.counterSourceColors }
        : {}),
      counterImmunity: mergedCounterImmunity,
    };
  }

export function appendFlashType(cardTypes: readonly string[], grantsFlashTiming: boolean): string[] {
    const normalized = Array.isArray(cardTypes) ? [...cardTypes] : [];
    if (!grantsFlashTiming || normalized.includes('flash')) {
      return normalized;
    }
    return [...normalized, 'flash'];
  }

export function mergeEntryCounterMaps(
    left: unknown,
    right: Record<string, number> | undefined,
  ): Record<string, number> | undefined {
    const leftCounters =
      left && typeof left === 'object' && !Array.isArray(left)
        ? Object.fromEntries(
            Object.entries(left as Record<string, unknown>)
              .map(([counterName, amountRaw]) => [counterName, Number(amountRaw || 0)])
              .filter(([counterName, amount]) => Boolean(counterName) && Number.isFinite(amount) && amount !== 0)
          )
        : undefined;
    if (!leftCounters && !right) return undefined;
    if (!leftCounters) return right ? { ...right } : undefined;
    if (!right) return { ...leftCounters };

    const merged: Record<string, number> = { ...leftCounters };
    for (const [counterName, amount] of Object.entries(right)) {
      const numericAmount = Number(amount || 0);
      if (!Number.isFinite(numericAmount) || numericAmount === 0) continue;
      merged[counterName] = (merged[counterName] || 0) + numericAmount;
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  }
