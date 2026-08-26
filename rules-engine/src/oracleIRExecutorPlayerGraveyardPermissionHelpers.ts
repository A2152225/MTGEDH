// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: graveyard/exile permission criteria, target resolvers, mana-cost parsers.
// Public entries: normalizePermissionSelectorText, resolveGraveyardPermissionTargets,
// parseSupportedManaCostString, resolveExilePermissionTargets, parseEnergyCostAmount,
// extractGrantedGraveyardKeywordFromRaw, resolvePrintedManaCostForGraveyardGrant,
// buildTemporaryGraveyardKeywordGrantStamps, mergeTemporaryGraveyardKeywordGrantStamps,
// findGraveyardOwnerIdForCard.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getChosenObjectIds } from './oracleIRExecutorPlayerSelectionOptions';
import { isCardExiledWithSource } from './oracleIRExecutorPlayerUtils';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  cardMatchesType,
  parseSimpleCardTypeFromText,
  type MoveZoneSingleTargetCriteria,
} from './oracleIRExecutorZoneOps';
import type { ManaCost } from './types/mana';
import { parseManaSymbols } from './types/numbers';

export function normalizePermissionSelectorText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildGraveyardPermissionCriteria(text: string): MoveZoneSingleTargetCriteria | null {
  const baseNormalized = normalizePermissionSelectorText(text)
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+from\s+(?:your|their|his or her|its owner's|its controller's)\s+graveyard$/i, '')
    .replace(/\binstant and sorcery\b/g, 'instant or sorcery')
    .trim();

  if (!baseNormalized) return null;

  if (baseNormalized === 'card of the other type' || baseNormalized === 'card of the other spell type') {
    return { cardType: 'instant' };
  }

  if (baseNormalized === 'spell' || baseNormalized === 'spells' || baseNormalized === 'card' || baseNormalized === 'cards') {
    return { cardType: 'any' };
  }

  if (/^legendary cards?$/i.test(baseNormalized)) {
    return { cardType: 'legendary_permanent' };
  }

  if (/^cards with retrace$/i.test(baseNormalized)) {
    return { cardType: 'any' };
  }

  if (
    /each permanent type/i.test(baseNormalized) ||
    /play a land and cast a permanent spell of each permanent type/i.test(baseNormalized)
  ) {
    return { cardType: 'permanent' };
  }

  const dualTypeCardsMatch = baseNormalized.match(/^([a-z]+) and ([a-z]+) cards?$/i);
  if (dualTypeCardsMatch) {
    const toTitle = (value: string) =>
      String(value || '')
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [toTitle(dualTypeCardsMatch[1]), toTitle(dualTypeCardsMatch[2])],
    };
  }

  const typeSpellsMatch = baseNormalized.match(/^([a-z][a-z' -]+)\s+spells?$/i);
  if (typeSpellsMatch) {
    const typeName = String(typeSpellsMatch[1] || '').trim();
    const parsedType = parseSimpleCardTypeFromText(typeName);
    if (parsedType && parsedType !== 'creature') {
      return { cardType: parsedType };
    }
    // "creature spell" names the card type itself and "Dragon creature spell" names a subtype plus
    // the card type; neither describes a creature type literally called "creature".
    const subtypeName = typeName.replace(/\s*\bcreature\b\s*$/i, '').trim();
    if (!subtypeName) return { cardType: 'creature' };
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [subtypeName.replace(/\b\w/g, (character) => character.toUpperCase())],
    };
  }

  if (baseNormalized === 'land' || baseNormalized === 'lands') return { cardType: 'land' };

  const normalized = baseNormalized
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!normalized) return null;

  const manaValueMatch = normalized.match(/^(.+?)\s+with mana value (\d+) or less$/i);
  if (manaValueMatch) {
    const rawBase = String(manaValueMatch[1] || '').trim().replace(/\s+spell$/i, '');
    const creatureTypeWithMvMatch = rawBase.match(/^([a-z][a-z' -]+)\s+creature$/i);
    const manaValueLte = parseInt(String(manaValueMatch[2] || '0'), 10) || 0;
    if (creatureTypeWithMvMatch && manaValueLte > 0) {
      return {
        cardType: 'creature',
        manaValueLte,
        creatureTypesAnyOf: [
          String(creatureTypeWithMvMatch[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      };
    }

    const cardType = parseSimpleCardTypeFromText(rawBase);
    if (!cardType || manaValueLte <= 0) return null;
    return { cardType, manaValueLte };
  }

  const creatureTypeMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeMatch) {
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [
        String(creatureTypeMatch[1] || '')
          .trim()
          .replace(/\b\w/g, c => c.toUpperCase()),
      ],
    };
  }

  const baseType = parseSimpleCardTypeFromText(normalized);
  if (baseType) return { cardType: baseType };

  if (normalized === 'card' || normalized === 'cards') return { cardType: 'any' };
  if (normalized === 'permanent spell' || normalized === 'permanent') return { cardType: 'permanent' };

  return null;
}

function buildExilePermissionCriteria(text: string): {
  readonly criteria: MoveZoneSingleTargetCriteria | null;
  readonly ownOnly: boolean;
} {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/\s+from\s+among\s+(?:the\s+)?cards?\s+/i, ' ')
    .replace(/\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i, '')
    .trim();

  const ownOnly = /\byou own\b/i.test(normalized);
  const selectorText = normalized
    .replace(/\byou own\b/i, '')
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!selectorText) return { criteria: { cardType: 'any' }, ownOnly };

  const direct = buildGraveyardPermissionCriteria(selectorText);
  if (direct) return { criteria: direct, ownOnly };

  const creatureTypeOnly = selectorText.match(/^([a-z][a-z' -]+)$/i);
  if (creatureTypeOnly) {
    return {
      criteria: {
        cardType: 'creature',
        creatureTypesAnyOf: [
          String(creatureTypeOnly[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      },
      ownOnly,
    };
  }

  return { criteria: null, ownOnly };
}

export function resolveGraveyardPermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' | 'grant_graveyard_keyword_ability' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { cards: [], reason: 'failed_to_apply' };

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const chosenIds = new Set(getChosenObjectIds(ctx));
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const contextualReference =
    /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  if (contextualReference) {
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId) return false;
      if (chosenIds.has(cardId)) return true;
      return selectorText === 'it' && sourceId && cardId === sourceId;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  if (selfReference) {
    const sourceName = String(ctx.sourceName || '').trim();
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (sourceId && cardId === sourceId) return true;
      if (cardId === 'gy-source-self') return true;
      if (sourceName && String(card?.name || '').trim() === sourceName) return true;
      return false;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const otherTypeMatch = selectorText.match(
    /^(?:up to one\s+)?target card of the other type(?: from your graveyard)?$/i
  );
  if (otherTypeMatch) {
    const otherType = String(ctx.selectorContext?.otherSpellType || ctx.otherSpellType || 'sorcery')
      .trim()
      .toLowerCase();
    const wantedType = otherType === 'instant' ? 'sorcery' : 'instant';
    const cards = graveyard.filter((card: any) => cardMatchesType(card, wantedType));
    if (cards.length === 0) return { cards: [], reason: 'failed_to_apply' };
    const chosenIds = new Set(getChosenObjectIds(ctx));
    const preferred = cards.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));
    return { cards: preferred.length > 0 ? preferred.slice(0, 1) : cards.slice(0, 1) };
  }

  const criteria = buildGraveyardPermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  return { cards: graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) };
}

export function resolveExilePermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const chosenIds = new Set(getChosenObjectIds(ctx));
  const contextualReference =
    /^(?:it|that card|that spell|the exiled card|the exiled spell|target .+?)$/.test(selectorText);
  if (contextualReference || /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText)) {
    const targetId = contextualReference
      ? Array.from(chosenIds)[0] || sourceId
      : sourceId;
    if (!targetId) return { cards: [], reason: 'failed_to_apply' };

    const matches: any[] = [];
    for (const owner of state.players as any[]) {
      const exile = Array.isArray(owner?.exile) ? owner.exile : [];
      for (const card of exile) {
        const cardId = String(card?.id || card?.cardId || '').trim();
        if (!cardId || cardId !== targetId) continue;
        matches.push(card);
      }
    }

    return matches.length > 0 ? { cards: matches } : { cards: [], reason: 'failed_to_apply' };
  }

  if (!sourceId && step.linkedToSource) return { cards: [], reason: 'failed_to_apply' };

  const { criteria, ownOnly } = buildExilePermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const owner of state.players as any[]) {
    const exile = Array.isArray(owner?.exile) ? owner.exile : [];
    for (const card of exile) {
      if (step.linkedToSource && !isCardExiledWithSource(card, sourceId)) continue;
      if (ownOnly && String(owner?.id || '').trim() !== playerId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      matches.push(card);
    }
  }

  return { cards: matches };
}

export function parseSupportedManaCostString(rawMana: string, xValue?: number): ManaCost | null {
  const symbols = parseManaSymbols(rawMana).filter(
    (symbol) => String(symbol || '').trim().toUpperCase() !== '{E}'
  );
  if (symbols.length === 0) return null;

  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;

  for (const symbol of symbols) {
    const upper = String(symbol || '').trim().toUpperCase();
    if (!upper) return null;
    if (upper === '{E}') continue;
    if (upper === '{X}') {
      const xAmount = Number(xValue);
      if (!Number.isFinite(xAmount)) return null;
      generic += Math.max(0, Math.floor(xAmount));
      continue;
    }
    if (/^\{\d+\}$/.test(upper)) {
      generic += parseInt(upper.slice(1, -1), 10);
      continue;
    }

    if (upper.includes('/')) {
      generic += 1;
      continue;
    }

    switch (upper) {
      case '{W}':
        white += 1;
        break;
      case '{U}':
        blue += 1;
        break;
      case '{B}':
        black += 1;
        break;
      case '{R}':
        red += 1;
        break;
      case '{G}':
        green += 1;
        break;
      case '{C}':
        colorless += 1;
        break;
      default:
        return null;
    }
  }

  return { generic, white, blue, black, red, green, colorless };
}

export function parseEnergyCostAmount(rawMana: string): number {
  return parseManaSymbols(rawMana).reduce((count, symbol) => count + (String(symbol || '').trim().toUpperCase() === '{E}' ? 1 : 0), 0);
}

const GRANTED_GRAVEYARD_CAST_KEYWORDS = ['flashback', 'escape', 'retrace', 'jump-start', 'harmonize'] as const;

export type GrantedGraveyardCastKeyword = (typeof GRANTED_GRAVEYARD_CAST_KEYWORDS)[number];

export type TemporaryGraveyardKeywordGrantStamp = {
  readonly playerId: string;
  readonly cardId: string;
  readonly keyword: string;
  readonly cost?: string;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly expiresAt: string;
  readonly turnApplied: number;
};

export function extractGrantedGraveyardKeywordFromRaw(raw: string): {
  readonly keyword: GrantedGraveyardCastKeyword;
  readonly explicitCost?: string;
} | null {
  const text = String(raw || '').replace(/\u2019/g, "'");
  const grantMatch = text.match(
    /\b(?:gains?|has|have)\s+"?(flashback|escape|retrace|jump-start|harmonize)\b(?:\s*(?:-|:)\s*((?:\{[^}]+\}\s*)+))?/i
  );
  if (grantMatch?.[1]) {
    const keyword = String(grantMatch[1] || '').trim().toLowerCase() as GrantedGraveyardCastKeyword;
    const explicitCost = String(grantMatch[2] || '').replace(/\s+/g, '').trim();
    return explicitCost ? { keyword, explicitCost } : { keyword };
  }

  const costMatch = text.match(
    /\b(flashback|escape|retrace|jump-start|harmonize)\s+cost\s+is\s+equal\s+to\b/i
  );
  if (!costMatch?.[1]) return null;
  return { keyword: String(costMatch[1] || '').trim().toLowerCase() as GrantedGraveyardCastKeyword };
}

export function resolvePrintedManaCostForGraveyardGrant(card: unknown): string {
  const anyCard = card as { mana_cost?: unknown; manaCost?: unknown } | null;
  return String(anyCard?.mana_cost || anyCard?.manaCost || '').trim();
}

export function buildTemporaryGraveyardKeywordGrantStamps(options: {
  readonly state: GameState;
  readonly playerId: PlayerID;
  readonly cards: readonly any[];
  readonly keyword: string;
  readonly resolveCost: (card: any) => string | undefined;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly expiresAt: string;
}): TemporaryGraveyardKeywordGrantStamp[] {
  const turnApplied = Number((options.state as any)?.turnNumber ?? (options.state as any)?.turn ?? 0) || 0;
  const stamps: TemporaryGraveyardKeywordGrantStamp[] = [];
  for (const card of options.cards) {
    const cardId = String((card as any)?.id ?? (card as any)?.cardId ?? '').trim();
    if (!cardId) continue;
    const cost = String(options.resolveCost(card) || '').trim();
    if (!cost) continue;
    stamps.push({
      playerId: String(options.playerId),
      cardId,
      keyword: options.keyword,
      cost,
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      ...(options.sourceName ? { sourceName: options.sourceName } : {}),
      expiresAt: options.expiresAt,
      turnApplied,
    });
  }
  return stamps;
}

export function mergeTemporaryGraveyardKeywordGrantStamps(
  state: GameState,
  entries: readonly TemporaryGraveyardKeywordGrantStamp[],
): GameState {
  if (entries.length === 0) return state;
  const nextStateAny: any = { ...(state as any) };
  const replacementKeys = new Set(entries.map((entry) =>
    `${entry.playerId}:${entry.cardId}:${entry.keyword}:${String(entry.sourceId || '')}`
  ));
  const existing = Array.isArray(nextStateAny.temporaryGraveyardKeywordGrants)
    ? nextStateAny.temporaryGraveyardKeywordGrants
    : [];
  nextStateAny.temporaryGraveyardKeywordGrants = [
    ...existing.filter((entry: any) =>
      !replacementKeys.has(`${String(entry?.playerId || '')}:${String(entry?.cardId || '')}:${String(entry?.keyword || '')}:${String(entry?.sourceId || '')}`)
    ),
    ...entries,
  ];
  return nextStateAny as GameState;
}

export function findGraveyardOwnerIdForCard(state: GameState, cardId: string): PlayerID | undefined {
  const wanted = String(cardId || '').trim();
  if (!wanted) return undefined;
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    if (graveyard.some((card: any) => String(card?.id ?? card?.cardId ?? '').trim() === wanted)) {
      return playerId as PlayerID;
    }
  }
  return undefined;
}
