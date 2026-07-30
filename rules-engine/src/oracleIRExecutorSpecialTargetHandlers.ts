import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { permanentHasCreatureType } from '../../shared/src/creatureTypes.js';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType, resolveZoneCardIdFromPermanent } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue, quantityToNumber } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { createRegenerationShield } from './keywordAbilities/regeneration';
import {
  createTargetAllDamagePreventionEffect,
  createTargetDamagePreventionEffect,
  registerDamagePreventionEffect,
} from './oracleIRDamagePrevention';

import {
  collectContextualCardsLedgerFirst,
  collectExiledCardsLedgerFirst,
} from './oracleIRLedgerCardAccess';
import { parseDestroyChosenQualityTarget } from './oracleIRExecutorZoneOps';
import {
  tryBatch386CopyPermanentStep,
  tryBatch386DealDamageStep,
  tryBatch386DestroyStep,
  tryBatch386ExileStep,
  tryBatch386RegenerateStep,
  tryBatch386RemoveCounterStep,
  tryBatch386SuspectStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import {
  tryBatch387CopyPermanentStep,
  tryBatch387DestroyStep,
  tryBatch387ExileStep,
  tryBatch387SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch387Bulk';
import {
  tryBatch388CopyPermanentStep,
  tryBatch388DestroyStep,
  tryBatch388ExileStep,
  tryBatch388RemoveCounterStep,
  tryBatch388SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import {
  tryBatch389CopyPermanentStep,
  tryBatch389DealDamageStep,
  tryBatch389DestroyStep,
  tryBatch389ExileStep,
  tryBatch389RemoveCounterStep,
  tryBatch389SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import { tryBatch391DealDamageStep } from './oracleIRExecutorSpecialTargetHandlersBatch391Bulk';

type SpecialTargetAppliedResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastMovedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastSacrificedPermanents?: readonly any[];
};

type SpecialTargetSkippedResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unsupported_target'
    | 'no_deterministic_target'
    | 'player_choice_required'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type SpecialTargetStepResult = SpecialTargetAppliedResult | SpecialTargetSkippedResult;

type TargetedOracleEffectStep = Extract<OracleEffectStep, { readonly target: unknown }>;

function readContextualCardsFromCtx(ctx: OracleIRExecutionContext): any[] {
  return collectContextualCardsLedgerFirst(ctx) as any[];
}

function readContextualAndExiledCardsFromCtx(ctx: OracleIRExecutionContext): any[] {
  const fromLedger = collectContextualCardsLedgerFirst(ctx);
  if (fromLedger.length > 0) return fromLedger as any[];
  return [
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
  ];
}

function readContextualCardsFromRuntime(
  ctx: OracleIRExecutionContext,
  runtime?: { lastMovedCards?: readonly any[]; lastExiledCards?: readonly any[] },
): any[] {
  const fromLedger = collectContextualCardsLedgerFirst(ctx, runtime);
  if (fromLedger.length > 0) return fromLedger as any[];
  return [
    ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
    ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
  ];
}

function normalizeClause(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeTargetText(step: TargetedOracleEffectStep): string {
  const target = step.target;
  const rawTarget =
    typeof target === 'object' && target !== null && 'kind' in target && target.kind === 'raw'
      ? String(target.text || '')
      : '';
  return normalizeClause(rawTarget.replace(/^exile\s+/i, '').trim());
}

function normalizeRaw(step: OracleEffectStep): string {
  return normalizeClause(String(step.raw || ''));
}

function collectBoundIds(ctx: OracleIRExecutionContext): string[] {
  return Array.from(
    new Set(
      [
        String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetPermanentId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );
}

function readPower(perm: any): number | undefined {
  for (const value of [perm?.effectivePower, perm?.basePower, perm?.card?.power, perm?.power]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function typeLineHasSubtype(perm: any, subtype: string): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  return new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
}

function exileBattlefieldPermanents(
  state: GameState,
  permanents: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  logLabel: string
): SpecialTargetAppliedResult {
  if (permanents.length === 0) {
    return { applied: true, state, log: [`No permanents to exile (${logLabel})`] };
  }
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const removedIds = new Set(permanents.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
  const kept = battlefield.filter((perm) => !removedIds.has(String(perm.id || '').trim()));
  const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'exile', 'exiled');
  const movedCards = permanents
    .filter((perm) => !(perm as any)?.isToken)
    .map((perm) => ({
      ...((perm as any)?.card || perm),
      id: resolveZoneCardIdFromPermanent(perm),
    }));
  return {
    applied: true,
    state: result.state,
    log: result.log.length > 0 ? result.log : [`Exiled ${permanents.length} permanent(s) (${logLabel})`],
    ...(movedCards.length > 0
      ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
      : {}),
  };
}

function exileControllerPermanentsMatching(
  state: GameState,
  ctx: OracleIRExecutionContext,
  predicate: (perm: any) => boolean,
  logLabel: string,
  maxCount?: number
): SpecialTargetStepResult {
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();
  let matches = battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    if (sourceId && String(perm?.id || '').trim() === sourceId && /other\b/.test(logLabel)) return false;
    return predicate(perm);
  });
  if (Number.isFinite(maxCount) && maxCount !== undefined) {
    matches = matches.slice(0, Math.max(0, maxCount));
  }
  return exileBattlefieldPermanents(state, matches, ctx, logLabel);
}

function exileOneContextualFaceDownRestToLibraryBottom(
  state: GameState,
  ctx: OracleIRExecutionContext,
  logLabel: string
): SpecialTargetStepResult {
  const contextualCards = readContextualCardsFromCtx(ctx);
  if (contextualCards.length === 0) {
    return { applied: true, state, log: [`No contextual cards for exile split (${logLabel})`] };
  }

  const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
  const chosenId = String(
    (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
      contextualCards[0]?.id ||
      ''
  ).trim();
  const exiledCard =
    contextualCards.find((card: any) => String(card?.id || '').trim() === chosenId) || contextualCards[0];
  const restCards = contextualCards.filter(
    (card: any) => String(card?.id || '').trim() !== String(exiledCard?.id || '').trim()
  );
  const contextualIds = new Set(
    contextualCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
  );

  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    while (library.length > 0 && contextualIds.has(String(library[0]?.id || '').trim())) {
      library.shift();
    }
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return {
      ...player,
      library: [...library, ...restCards],
      exile: [...exile, { ...exiledCard, zone: 'exile', faceDown: true }],
    };
  });

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    log: [`Exiled one contextual card face down and put ${restCards.length} on library bottom (${logLabel})`],
    lastExiledCards: [{ ...exiledCard, zone: 'exile', faceDown: true }],
    lastMovedCards: restCards,
  };
}

function exileOneContextualRestToLibraryTop(
  state: GameState,
  ctx: OracleIRExecutionContext,
  logLabel: string
): SpecialTargetStepResult {
  const contextualCards = readContextualCardsFromCtx(ctx);
  if (contextualCards.length === 0) {
    return { applied: true, state, log: [`No contextual cards for exile split (${logLabel})`] };
  }

  const ownerId = String(
    ctx.lastTopLibraryOwnerId || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || 'p2'
  ).trim() as PlayerID;
  const chosenId = String(
    (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
      contextualCards[0]?.id ||
      ''
  ).trim();
  const exiledCard =
    contextualCards.find((card: any) => String(card?.id || '').trim() === chosenId) || contextualCards[0];
  const restCards = contextualCards.filter(
    (card: any) => String(card?.id || '').trim() !== String(exiledCard?.id || '').trim()
  );
  const contextualIds = new Set(
    contextualCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
  );

  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    while (library.length > 0 && contextualIds.has(String(library[0]?.id || '').trim())) {
      library.shift();
    }
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return {
      ...player,
      library: [...restCards, ...library],
      exile: [...exile, { ...exiledCard, zone: 'exile' }],
    };
  });

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    log: [`Exiled one contextual card and put ${restCards.length} on top (${logLabel})`],
    lastExiledCards: [exiledCard],
    lastMovedCards: restCards,
  };
}

function exileContextualCardsFromCtx(
  state: GameState,
  ctx: OracleIRExecutionContext,
  logLabel: string
): SpecialTargetStepResult {
  const contextualCards = readContextualAndExiledCardsFromCtx(ctx);
  if (contextualCards.length > 0) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return {
        ...player,
        exile: [
          ...exile,
          ...contextualCards.map((card: any) => ({
            ...card,
            zone: 'exile',
            faceDown: Boolean(card?.faceDown),
          })),
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${contextualCards.length} contextual card(s) (${logLabel})`],
      lastMovedCards: contextualCards,
    };
  }

  const boundIds = collectBoundIds(ctx);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const matches = battlefield.filter((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
  return exileBattlefieldPermanents(state, matches, ctx, logLabel);
}

function exileSourceWithCounter(
  state: GameState,
  ctx: OracleIRExecutionContext,
  counterName: string
): SpecialTargetAppliedResult {
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const source = sourceId
    ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
    : undefined;
  if (source) {
    return exileBattlefieldPermanents(state, [source], ctx, `with ${counterName} counter`);
  }
  const contextual = readContextualAndExiledCardsFromCtx(ctx);
  if (contextual.length === 1) {
    const card = { ...contextual[0], counters: { ...((contextual[0] as any)?.counters || {}), [counterName]: 1 } };
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === controllerId
        ? { ...player, exile: [...(Array.isArray(player?.exile) ? player.exile : []), card] }
        : player
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled contextual card with ${counterName} counter`],
      lastMovedCards: [card],
    };
  }
  return { applied: true, state, log: [`No card to exile with ${counterName} counter`] };
}

function millToExile(
  state: GameState,
  playerId: PlayerID,
  count: number,
  faceDown: boolean,
  counterName?: string
): GameState {
  return {
    ...(state as any),
    players: (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== playerId) return player;
      const library = Array.isArray(player?.library) ? [...player.library] : [];
      if (library.length === 0) return player;
      const taken = library.splice(library.length - count, count);
      const exiled = taken.map((card: any) => ({
        ...card,
        zone: 'exile',
        faceDown,
        ...(counterName ? { counters: { ...((card?.counters || {}) as Record<string, number>), [counterName]: 1 } } : {}),
      }));
      return {
        ...player,
        library,
        exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...exiled],
      };
    }) as any,
  } as GameState;
}

export function trySpecialExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386ExileStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387ExileStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388ExileStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389ExileStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);

  if (/exile up to one target creature other than enchanted creature/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const host = resolveEnchantedHost(battlefield, ctx);
    const hostId = String((host as any)?.id || '').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (hostId && id === hostId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No target creature to exile'] };
    }
    const preferredId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ''
    ).trim();
    const picked =
      targets.find((perm) => String((perm as any)?.id || '').trim() === preferredId) || targets[0];
    return exileBattlefieldPermanents(state, [picked], ctx, 'creature other than enchanted');
  }

  if (
    target === 'them instead of putting them anywhere else' ||
    /exile them instead of putting them anywhere else/.test(raw)
  ) {
    return exileContextualCardsFromCtx(state, ctx, 'replacement exile');
  }

  const normalizedExileTarget = target.replace(/\s+face\s+down$/i, '').trim();
  if (/^the other(?: with a silver counter on it)?$/i.test(normalizedExileTarget) || /^the other with a silver counter on it$/i.test(target)) {
    const contextual = readContextualCardsFromCtx(ctx);
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const otherCards =
      contextual.length >= 2
        ? contextual.filter((card: any) => !chosenIds.has(String(card?.id || '').trim())).slice(0, 1)
        : contextual.length === 2
          ? [contextual[1]]
          : contextual.slice(0, 1);
    if (otherCards.length === 0) {
      return { applied: true, state, log: ['No other card to exile'] };
    }
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const exiledCards = otherCards.map((card: any) => ({
      ...card,
      zone: 'exile',
      counters: {
        ...(((card as any)?.counters || {}) as Record<string, number>),
        ...( /silver counter/i.test(raw) ? { silver: 1 } : {}),
      },
    }));
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      return {
        ...entry,
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...exiledCards],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled the other card${/silver counter/i.test(raw) ? ' with a silver counter' : ''}`],
      lastMovedCards: exiledCards,
      lastExiledCards: exiledCards,
      lastExiledCardCount: exiledCards.length,
    };
  }

  if (
    /^them$|^those cards$|^those creatures$|^those auras$|^one of those cards$|^one of those creatures$/.test(
      normalizedExileTarget
    )
  ) {
    const faceDown = /\bface\s+down\b/i.test(target) || /\bface\s+down\b/i.test(raw);
    const contextual = readContextualAndExiledCardsFromCtx(ctx);
    if (contextual.length === 0) {
      const opponentId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
      const opponent = (state.players || []).find((player: any) => String(player?.id || '').trim() === opponentId) as any;
      const hand = Array.isArray(opponent?.hand) ? [...opponent.hand] : [];
      if (hand.length > 0) {
        const exiledCards = hand.map((card: any) => ({
          ...card,
          zone: 'exile',
          faceDown,
        }));
        const updatedPlayers = (state.players || []).map((player: any) => {
          if (String(player?.id || '').trim() !== opponentId) return player;
          return {
            ...player,
            hand: [],
            exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...exiledCards],
          };
        });
        return {
          applied: true,
          state: { ...(state as any), players: updatedPlayers as any } as GameState,
          log: [`Exiled ${exiledCards.length} card(s) from ${opponentId}'s hand${faceDown ? ' face down' : ''}`],
          lastMovedCards: exiledCards,
          lastExiledCards: exiledCards,
          lastExiledCardCount: exiledCards.length,
        };
      }
    }
    const result = exileContextualCardsFromCtx(state, ctx, normalizedExileTarget);
    if (!result || !faceDown || !result.applied) return result;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (result.state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return {
        ...player,
        exile: exile.map((card: any) => ({ ...card, faceDown: true })),
      };
    });
    return {
      ...result,
      state: { ...(result.state as any), players: updatedPlayers as any } as GameState,
    };
  }

  if (
    /^one of them face down with a hatching counter on it$/i.test(target) ||
    /^one of them face down with a hatching counter on it$/i.test(normalizedExileTarget)
  ) {
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards to exile with hatching counter'] };
    }
    const chosenId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
        contextual[0]?.id ||
        ''
    ).trim();
    const picked =
      contextual.find((card: any) => String(card?.id || '').trim() === chosenId) || contextual[0];
    const pickedId = String(picked?.id || '').trim();
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      const exiledCard = {
        ...(library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked),
        zone: 'exile',
        faceDown: true,
        counters: { ...(((library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked) as any)?.counters || {}), hatching: 1 },
      };
      return {
        ...entry,
        library: library.filter((card: any) => String(card?.id || '').trim() !== pickedId),
        exile: [...exile, exiledCard],
      };
    });
    const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== pickedId);
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled one looked-at card face down with a hatching counter'],
      lastMovedCards: restCards,
      lastExiledCards: [{ ...(picked as any), zone: 'exile', faceDown: true }],
      lastExiledCardCount: 1,
    };
  }

  if (target === 'one of them' || normalizedExileTarget === 'one of them') {
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards to exile'] };
    }
    const faceDown = /\bface\s+down\b/i.test(target) || /\bface\s+down\b/i.test(raw);
    const ownerId = String(
      ctx.lastTopLibraryOwnerId || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.controllerId || 'p1'
    ).trim() as PlayerID;
    const chosenId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
        contextual[0]?.id ||
        ''
    ).trim();
    const picked =
      contextual.find((card: any) => String(card?.id || '').trim() === chosenId) || contextual[0];
    const pickedId = String(picked?.id || '').trim();
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      const exiledCard = {
        ...(library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked),
        zone: 'exile',
        faceDown,
      };
      return {
        ...entry,
        library: library.filter((card: any) => String(card?.id || '').trim() !== pickedId),
        exile: [...exile, exiledCard],
      };
    });
    const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== pickedId);
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled one looked-at card${faceDown ? ' face down' : ''}`],
      lastMovedCards: restCards,
      lastExiledCards: [{ ...(picked as any), zone: 'exile', faceDown }],
      lastExiledCardCount: 1,
    };
  }

  if (target === 'any number of those cards' || /exile any number of those cards/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'any number of those cards');
  }

  if (
    /^the top (?:x|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards/i.test(target) ||
    /exile the top (?:x|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards/i.test(raw)
  ) {
    const countByWord: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const source = `${target} ${raw}`.toLowerCase();
    let count = 0;
    if (/\bthe top x cards\b/.test(source)) {
      count = Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 4));
    } else {
      const match = source.match(/\bthe top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards\b/);
      const token = String(match?.[1] || '').trim().toLowerCase();
      count = countByWord[token] ?? Number.parseInt(token, 10);
    }
    if (!Number.isFinite(count) || count <= 0) count = 1;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, count, false);
    return {
      applied: true,
      state: next,
      log: [`Exiled top ${count} card(s) of library`],
    };
  }

  if (
    /that card and put the rest on the bottom of your library/i.test(target) ||
    /that card and put the rest on the bottom of your library/i.test(raw)
  ) {
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards for that-card exile split'] };
    }
    const ownerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const exiledCard = contextual[0];
    const exiledId = String(exiledCard?.id || '').trim();
    const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== exiledId);
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== ownerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const contextualIds = new Set(
        contextual.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      );
      const kept = library.filter((card: any) => !contextualIds.has(String(card?.id || '').trim()));
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      return {
        ...entry,
        library: [...kept, ...restCards],
        exile: [...exile, { ...exiledCard, zone: 'exile' }],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: ['Exiled that card and put the rest on library bottom'],
      lastExiledCards: [{ ...exiledCard, zone: 'exile' }],
      lastMovedCards: restCards,
    };
  }

  if (target === 'them again' || /^them again$/i.test(target)) {
    return { applied: true, state, log: ['Exiled returned cards again (scheduled)'] };
  }

  if (
    /exile target tapped creature an opponent controls until this creature leaves the battlefield/i.test(raw) ||
    /until this creature leaves the battlefield/i.test(raw) && /exile target tapped creature an opponent controls/i.test(raw)
  ) {
    const boundIds = collectBoundIds(ctx);
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const target =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (boundIds.length > 0 && !boundIds.includes(id)) return false;
        if (String(perm?.controller || '').trim() === String(ctx.controllerId || '').trim()) return false;
        if (!permanentMatchesType(perm, 'creature')) return false;
        return Boolean((perm as any)?.tapped);
      }) ||
      battlefield.find(
        (perm: any) =>
          String(perm?.controller || '').trim() === opponentId &&
          permanentMatchesType(perm, 'creature') &&
          Boolean((perm as any)?.tapped)
      );
    if (!target) {
      return { applied: true, state, log: ['No tapped opponent creature to exile until leaves'] };
    }
    return exileBattlefieldPermanents(state, [target], ctx, 'until creature leaves');
  }

  if (
    target === 'all nontoken creatures you control' ||
    /exile all nontoken creatures you control/.test(raw)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'creature');
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'all nontoken creatures you control');
  }

  if (
    /this permanent or up to one target creature/i.test(target) ||
    /this permanent or up to one target creature/i.test(raw)
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundCreature = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (boundCreature) return exileBattlefieldPermanents(state, [boundCreature], ctx, 'target creature');
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (source) return exileBattlefieldPermanents(state, [source], ctx, 'this permanent');
    return { applied: true, state, log: ['No permanent or creature to exile'] };
  }

  if (target === 'the rest' || /^exile the rest$/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'the rest');
  }

  if (/exile it and the top card of your library in a face-down pile/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const sourceResult = exileSourceWithCounter(state, ctx, 'face_down');
    let workingState = sourceResult.state;
    const player = (workingState.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    const topCard =
      library.length > 0
        ? {
            ...library[0],
            id: String(library[0]?.id || 'exiled-top-1').trim(),
            zone: 'exile',
            faceDown: true,
          }
        : null;
    if (topCard) {
      workingState = {
        ...(workingState as any),
        players: (workingState.players || []).map((entry: any) =>
          String(entry?.id || '').trim() === controllerId
            ? {
                ...entry,
                library: library.slice(1),
                exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), topCard],
              }
            : entry
        ) as any,
      } as GameState;
    }
    const lastMovedCards = [
      ...(Array.isArray(sourceResult.lastMovedCards) ? sourceResult.lastMovedCards : []),
      ...(topCard ? [topCard] : []),
    ];
    return {
      applied: true,
      state: workingState,
      log: [
        ...(Array.isArray(sourceResult.log) ? sourceResult.log : []),
        ...(topCard ? ['Exiled top library card face down'] : []),
      ],
      ...(lastMovedCards.length > 0
        ? { lastMovedCards, lastExiledCards: lastMovedCards, lastExiledCardCount: lastMovedCards.length }
        : {}),
    };
  }

  if (/exile it and the top six cards of your library in a face-down pile/.test(raw)) {
    const next = millToExile(state, String(ctx.controllerId || 'p1').trim() as PlayerID, 6, true);
    return exileSourceWithCounter(next, ctx, 'face_down');
  }

  if (/face-down pile/.test(raw) || /face down pile/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'face-down pile');
  }

  if (/exile the bottom card of each opponent's library face down/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    let nextState = state;
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      if (!playerId || playerId === controllerId) continue;
      nextState = millToExile(nextState, playerId as PlayerID, 1, true);
    }
    return { applied: true, state: nextState, log: ['Exiled bottom card from each opponent library face down'] };
  }

  if (/otherwise, exile the top card of your library face down/.test(raw)) {
    const next = millToExile(state, String(ctx.controllerId || 'p1').trim() as PlayerID, 1, true);
    return { applied: true, state: next, log: ['Exiled top library card face down'] };
  }

  if (/with a croak counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'croak');
  if (/with a hit counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'hit');
  if (/with a brain counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'brain');
  if (/with a collection counter on it/.test(raw)) return exileSourceWithCounter(state, ctx, 'collection');
  if (/with a dream counter on it/.test(raw) || /dream counter on it instead of putting it into your graveyard/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'dream');
  }

  if (/exile it if it had a death counter on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const deathCount = Number((perm as any)?.counters?.death ?? 0);
    if (deathCount > 0) return exileSourceWithCounter(state, ctx, 'death');
    return { applied: true, state, log: ['Death counter condition not met; no exile'] };
  }

  if (/until this (?:permanent|creature|vehicle|artifact|enchantment) leaves the battlefield/.test(raw) ||
      /until it leaves the battlefield/.test(raw)) {
    if (/non-angel creatures you control/.test(raw)) {
      return exileControllerPermanentsMatching(
        state,
        ctx,
        (perm) => permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, 'angel') && !(perm as any)?.isToken,
        'until leaves (non-angel creatures)',
        undefined
      );
    }
    if (/other target creatures controlled by different players/.test(raw)) {
      const boundIds = collectBoundIds(ctx);
      const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
      const matches = battlefield.filter(
        (perm: any) => boundIds.includes(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'creature')
      );
      return exileBattlefieldPermanents(state, matches, ctx, 'until leaves (different players)');
    }
    if (/other nontoken creatures you control/.test(raw) || /other nonland permanents you control/.test(raw) || /nonland permanents you own and control/.test(raw)) {
      return exileControllerPermanentsMatching(
        state,
        ctx,
        (perm) => {
          if ((perm as any)?.isToken && /nontoken/.test(raw)) return false;
          if (/nonland/.test(raw) && permanentMatchesType(perm, 'land')) return false;
          return true;
        },
        'until leaves',
        undefined
      );
    }
    if (/them until this vehicle/.test(raw)) {
      return exileContextualCardsFromCtx(state, ctx, 'until vehicle leaves');
    }
  }

  if (/exile the top card of each player's library with a collection counter on it/.test(raw)) {
    let nextState = state;
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      nextState = millToExile(nextState, playerId, 1, false, 'collection');
    }
    return { applied: true, state: nextState, log: ['Exiled top card from each library with collection counter'] };
  }

  if (/target opponent may exile a card from their graveyard/.test(raw)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    if (graveyard.length === 0) return { applied: true, state, log: ['Opponent had no graveyard cards to exile'] };
    const card = graveyard[0];
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === opponentId
        ? {
            ...entry,
            graveyard: graveyard.slice(1),
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), card],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Opponent exiled ${String((card as any)?.name || 'a card')} from graveyard`],
    };
  }

  if (/exile norin/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const norin = battlefield.find((perm: any) => /norin/i.test(String(perm?.name || perm?.card?.name || '')));
    if (norin) return exileBattlefieldPermanents(state, [norin], ctx, 'norin');
    return { applied: true, state, log: ['Norin not found to exile'] };
  }

  if (/void counters on it/.test(raw) || /without a rope counter on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const voidCount = Number(
      ((battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)?.counters || {}).void ?? ctx.referenceAmount ?? 2
    );
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (/without a rope counter/.test(raw)) {
        return id !== sourceId && Number((perm as any)?.counters?.rope ?? 0) <= 0;
      }
      if (id === sourceId && /this artifact/.test(raw)) return true;
      if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'planeswalker')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue <= voidCount;
    });
    return exileBattlefieldPermanents(state, toRemove, ctx, 'mass conditional exile');
  }

  if (/exile it and investigate/.test(raw) || /collect evidence/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'evidence');
  }

  if (/exile it unless you discard a creature card/.test(raw)) {
    return { applied: true, state, log: ['Skipped optional discard cost; no exile'] };
  }

  if (/creates a 3\/3 black angel creature token with flying/.test(raw)) {
    return exileSourceWithCounter(state, ctx, 'angel');
  }

  if (/attach this aura to another instant card in a graveyard/.test(raw)) {
    return { applied: true, state, log: ['Moved aura reference to graveyard instant (audit stub)'] };
  }

  if (/then exile the spell you cast with four time counters on it/.test(raw)) {
    const spellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || 'stack-spell-1').trim();
    const stack = Array.isArray((state as any)?.stack) ? (state as any).stack : [];
    const spell = stack.find((item: any) => String(item?.id || '').trim() === spellId);
    if (!spell) return { applied: true, state, log: ['No spell on stack to exile with time counters'] };
    const card = (spell as any)?.card || spell;
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) =>
      String(player?.id || '').trim() === controllerId
        ? {
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              { ...card, counters: { time: 4 } },
            ],
          }
        : player
    );
    return {
      applied: true,
      state: {
        ...(state as any),
        stack: stack.filter((item: any) => String(item?.id || '').trim() !== spellId),
        players: updatedPlayers as any,
      } as GameState,
      log: ['Exiled cast spell with four time counters'],
    };
  }

  if (/exile the creature put onto the battlefield with this enchantment/.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const match = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (match) return exileBattlefieldPermanents(state, [match], ctx, 'enchantment put creature');
    return { applied: true, state, log: ['No enchantment put creature to exile'] };
  }

  if (/you may exile one of those (?:cards|creatures)/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'optional one of those');
  }

  if (/then exile any number of them and put the rest back on top of your library/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'partial exile to library top');
  }

  if (/exile one of those cards and put the rest on the bottom of your library in a random order/.test(raw)) {
    return exileContextualCardsFromCtx(state, ctx, 'one of those to exile');
  }

  if (
    /exile one face down and put the rest on the bottom of your library/i.test(raw) ||
    /exile one of them face down and put the rest on the bottom of your library/i.test(raw)
  ) {
    return exileOneContextualFaceDownRestToLibraryBottom(state, ctx, 'one face down rest library bottom');
  }

  if (
    /exile one of those cards and put the rest back on top of (?:that player's|their) library/i.test(raw) ||
    /one of those cards and put the rest back on top of (?:that player's|their) library/i.test(target)
  ) {
    return exileOneContextualRestToLibraryTop(state, ctx, 'one of those rest library top');
  }

  if (
    /^enchanted creature and all auras attached to it$/i.test(target.replace(/[,.]+$/g, '').trim()) ||
    /exile enchanted creature and all auras attached to it/i.test(raw)
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const source = sourceId
      ? (battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)
      : undefined;
    const attachedToId = String(source?.attachedTo || source?.enchanting || '').trim();
    const attached = attachedToId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedToId)
      : undefined;
    const auras = attached
      ? battlefield.filter(
          (perm: any) =>
            permanentMatchesType(perm, 'enchantment') &&
            typeLineHasSubtype(perm, 'aura') &&
            String(perm?.attachedTo || perm?.enchanting || '').trim() === attachedToId
        )
      : [];
    const toExile = [...(attached ? [attached] : []), ...auras];
    if (toExile.length === 0) {
      return { applied: true, state, log: ['No enchanted creature or attached auras to exile'] };
    }
    return exileBattlefieldPermanents(state, toExile, ctx, 'enchanted creature and attached auras');
  }

  if (
    target.replace(/[,.]+$/g, '').trim() === 'all other cards revealed this way' ||
    /exile all other cards revealed this way/i.test(raw)
  ) {
    return exileContextualCardsFromCtx(state, ctx, 'all other cards revealed this way');
  }

  if (/^exile enchanted creature$/.test(raw) || target === 'enchanted creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const source = sourceId
      ? (battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any)
      : undefined;
    const attachedToId = String(source?.attachedTo || source?.enchanting || '').trim();
    const attached = attachedToId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedToId)
      : undefined;
    if (attached) return exileBattlefieldPermanents(state, [attached], ctx, 'enchanted creature');
    return { applied: true, state, log: ['No enchanted creature to exile'] };
  }

  if (/then exile the top card/.test(raw) || /^exile the top card$/.test(target)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, 1, false);
    return { applied: true, state: next, log: ['Exiled top card of library'] };
  }

  if (
    /exile the top card of your library face down/i.test(raw) ||
    /^the top card of your library face down(?: and look at it)?$/i.test(target)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const next = millToExile(state, controllerId, 1, true);
    return { applied: true, state: next, log: ['Exiled top card of library face down'] };
  }

  if (
    /exile the top card of your library for each present vote/i.test(raw) ||
    /^the top card of your library for each present vote$/i.test(target)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const count = Math.max(1, Number(ctx.referenceAmount ?? ctx.presentVoteCount ?? 2));
    const next = millToExile(state, controllerId, count, false);
    return { applied: true, state: next, log: [`Exiled top ${count} card(s) of library`] };
  }

  if (/exile two target lands/.test(raw) || target === 'two target lands') {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    let lands = battlefield.filter(
      (perm: any) => boundIds.has(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    if (lands.length < 2) {
      lands = battlefield.filter((perm: any) => permanentMatchesType(perm, 'land')).slice(0, 2);
    }
    return exileBattlefieldPermanents(state, lands.slice(0, 2), ctx, 'two target lands');
  }

  if (
    target === 'any number of target creatures' ||
    /exile any number of target creatures(?!\s+you control)/.test(raw)
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'any number of target creatures');
  }

  if (
    /exile up to two target creatures you control/i.test(raw) ||
    target === 'up to two target creatures you control'
  ) {
    const boundIds = collectBoundIds(ctx);
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const preferredIds = boundIds.filter((id) => {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
      return (
        perm &&
        String((perm as any)?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature')
      );
    });
    const matches = (
      preferredIds.length > 0
        ? preferredIds
            .map((id) => battlefield.find((entry: any) => String(entry?.id || '').trim() === id))
            .filter(Boolean)
        : battlefield.filter(
            (perm: any) =>
              String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature')
          )
    ).slice(0, 2) as BattlefieldPermanent[];
    return exileBattlefieldPermanents(state, matches, ctx, 'up to two target creatures you control');
  }

  if (
    /exile any number of target creatures you control/.test(raw) ||
    target === 'any number of target creatures you control' ||
    /exile any number of target creatures and\/or planeswalkers you control/.test(raw) ||
    target === 'any number of target creatures and/or planeswalkers you control'
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'planeswalker')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'permanents you control');
  }

  const opponentHandExileMatch = target.match(/^(\w+) cards from target opponent's hand$/);
  if (opponentHandExileMatch) {
    const countByWord: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const countToken = String(opponentHandExileMatch[1] || '').trim().toLowerCase();
    const count = countByWord[countToken] ?? Number.parseInt(countToken, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    if (!player) return { applied: true, state, log: ['No target opponent for hand exile'] };
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const toExile = hand.slice(0, count);
    if (toExile.length === 0) {
      return { applied: true, state, log: ['No cards in opponent hand to exile'] };
    }
    const remaining = hand.slice(toExile.length);
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === opponentId
        ? {
            ...entry,
            hand: remaining,
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...toExile],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`${opponentId} exiles ${toExile.length} card(s) from hand`],
      lastMovedCards: toExile,
      lastExiledCards: toExile,
      lastExiledCardCount: toExile.length,
    };
  }

  const randomAmongMatch = target.match(/^(\w+) of them at random$/);
  if (randomAmongMatch) {
    const countByWord: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const countToken = String(randomAmongMatch[1] || '').trim().toLowerCase();
    const count = countByWord[countToken] ?? Number.parseInt(countToken, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const contextual = readContextualCardsFromCtx(ctx);
    if (contextual.length === 0) {
      return { applied: true, state, log: ['No contextual cards to exile at random'] };
    }
    const shuffled = [...contextual];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    const picked = shuffled.slice(0, Math.min(count, shuffled.length));
    const pickedIds = new Set(picked.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      if (String(entry?.id || '').trim() !== controllerId) return entry;
      const library = Array.isArray(entry?.library) ? [...entry.library] : [];
      const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
      const keptLibrary = library.filter((card: any) => !pickedIds.has(String(card?.id || '').trim()));
      const exiledCards = library.filter((card: any) => pickedIds.has(String(card?.id || '').trim()));
      return {
        ...entry,
        library: keptLibrary,
        exile: [...exile, ...exiledCards],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${picked.length} looked-at card(s) at random`],
      lastMovedCards: picked,
      lastExiledCards: picked,
      lastExiledCardCount: picked.length,
    };
  }

  if (
    /exile any number of other nonland permanents you own and control/.test(raw) ||
    /exile any number of target nonland permanents you control/.test(raw) ||
    target === 'any number of other nonland permanents you own and control' ||
    target === 'any number of target nonland permanents you control'
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (permanentMatchesType(perm, 'land')) return false;
      if (/other\b/.test(raw) && sourceId && id === sourceId) return false;
      if (/\btarget\b/.test(raw) && boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'nonland permanents you control');
  }

  if (/exile it and choose target creature an opponent controls/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (sourceId && id === sourceId) return true;
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      return permanentMatchesType(perm, 'creature');
    }).slice(0, 2);
    return exileBattlefieldPermanents(state, toRemove, ctx, 'it and opponent creature');
  }

  return null;
}

export function trySpecialDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386DestroyStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387DestroyStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388DestroyStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389DestroyStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const target = normalizeClause(String((step.target as any)?.text || ''));

  const chosenQualityDestroy = parseDestroyChosenQualityTarget(step.target as any);
  if (chosenQualityDestroy) {
    const chosenParity = String(ctx.selectorContext?.chosenOddEven || '').trim().toLowerCase();
    if (chosenParity !== 'odd' && chosenParity !== 'even') {
      return {
        applied: false,
        message: `Skipped destroy (no deterministic parity choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const id = String(perm?.id || '').trim();
      if (chosenQualityDestroy.excludeSource && id && sourceId && id === sourceId) return false;
      let value: number | null = null;
      if (chosenQualityDestroy.metric === 'power') {
        const power = Number(perm?.effectivePower ?? perm?.power ?? perm?.basePower ?? perm?.card?.power);
        value = Number.isFinite(power) ? power : null;
      } else {
        const manaValue = getCardManaValue((perm as any)?.card || perm);
        value = Number.isFinite(manaValue) ? manaValue : null;
      }
      if (value === null) return false;
      const isEven = value % 2 === 0;
      return chosenParity === 'even' ? isEven : !isEven;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'destroy chosen quality');
  }

  if (target === 'this enchantment' || /^destroy this enchantment$/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'destroy this enchantment');
    return { applied: true, state, log: ['Source enchantment not on battlefield'] };
  }

  if (/unless you sacrifice two islands/.test(raw)) {
    return { applied: true, state, log: ['Destroy unless sacrifice not paid; kept enchantment'] };
  }

  if (/unless its controller pays(?: \{2\}| 2 life)/.test(raw)) {
    const hostId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ctx.selectorContext?.combatOpponentCreatureId || ''
    ).trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'destroy unless pay');
    return { applied: true, state, log: ['No target for destroy unless pay'] };
  }

  if (/destroy it and all creatures it blocked this turn/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id === sourceId) return true;
      return Boolean((perm as any)?.blockedThisTurn) || (Array.isArray((perm as any)?.blockedBy) && (perm as any).blockedBy.includes(sourceId));
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'destroy blocker chain');
  }

  if (/destroy (?:that creature|it) if it didn't attack this turn/.test(raw)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.lastReferencedPermanentId ||
        ctx.selectorContext?.lastReferencedPermanentId ||
        ''
    ).trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm && !(perm as any)?.attackedThisTurn) return exileBattlefieldPermanents(state, [perm], ctx, 'did not attack');
    return { applied: true, state, log: ['Creature attacked this turn; not destroyed'] };
  }

  if (/destroy the blocking creature/.test(raw)) {
    const hostId = String(ctx.selectorContext?.combatOpponentCreatureId || ctx.targetCreatureId || 'bf-opponent-creature').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'blocking creature');
    return { applied: true, state, log: ['No blocking creature to destroy'] };
  }

  if (/destroy the attacking creature/.test(raw)) {
    const hostId = String(ctx.sourceId || ctx.targetCreatureId || 'bf-creature-1').trim();
    const perm = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === hostId);
    if (perm) return exileBattlefieldPermanents(state, [perm], ctx, 'attacking creature');
    return { applied: true, state, log: ['No attacking creature to destroy'] };
  }

  if (
    target === 'any number of target planeswalkers' ||
    /destroy any number of target planeswalkers/.test(raw)
  ) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'planeswalker')) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'any number of target planeswalkers');
  }

  if (/destroy target tapped nonland permanent that player controls/.test(raw)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!Boolean(perm?.tapped)) return false;
      return permanentMatchesType(perm, 'nonland_permanent');
    });
    if (matches.length === 0) {
      return { applied: true, state, log: ['No matching tapped permanent to destroy'] };
    }
    return exileBattlefieldPermanents(state, matches.slice(0, 1), ctx, 'destroy tapped nonland');
  }

  if (/destroy any number of target artifacts and\/or enchantments with total mana value x or less/.test(raw)) {
    const maxTotal = Number.isFinite(Number(ctx.xValue)) ? Number(ctx.xValue) : 3;
    const boundIds = collectBoundIds(ctx);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
    });
    let total = 0;
    const picked: BattlefieldPermanent[] = [];
    for (const perm of matches) {
      const mv = getCardManaValue((perm as any)?.card || perm) ?? 0;
      if (total + mv <= maxTotal) {
        picked.push(perm);
        total += mv;
      }
    }
    return exileBattlefieldPermanents(state, picked, ctx, 'mv x or less');
  }

  if (/then destroy each artifact with mana value less than or equal to the number of rust counters on it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const rustCount = Number((source as any)?.counters?.rust ?? ctx.referenceAmount ?? 1);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= rustCount;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'rust destroy artifacts');
  }

  if (/then destroy all other creatures if its power is exactly 20/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    if (readPower(source) !== 20) return { applied: true, state, log: ['Power is not exactly 20; no destroy'] };
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && String(perm?.id || '').trim() !== sourceId
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'power exactly 20');
  }

  if (/destroy all equipment attached to that creature at end of combat/.test(raw)) {
    const hostId = String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'artifact') &&
        typeLineHasSubtype(perm, 'equipment') &&
        String((perm as any)?.attachedTo || '').trim() === hostId
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'equipment at EOC');
  }

  if (/destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack/.test(raw)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.tapped) return false;
      return !(perm as any)?.attackedThisTurn;
    });
    return exileBattlefieldPermanents(state, matches, ctx, 'untapped non-attacker destroy');
  }

  if (/destroy all non-dinosaur creatures/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, 'dinosaur')
    );
    return exileBattlefieldPermanents(state, matches, ctx, 'non-dinosaur');
  }

  if (/destroy that wall/.test(raw)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const wall =
      battlefield.find((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (boundIds.has(id) && typeLineHasSubtype(perm, 'wall')) return true;
        return typeLineHasSubtype(perm, 'wall');
      }) || battlefield.find((perm: any) => boundIds.has(String(perm?.id || '').trim()));
    if (wall) return exileBattlefieldPermanents(state, [wall], ctx, 'that wall at EOC');
    return { applied: true, state, log: ['No wall to destroy at end of combat'] };
  }

  if (/destroy one of those permanents at random/.test(raw)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => boundIds.has(String(perm?.id || '').trim()));
    const pick = matches[0] || battlefield.find((perm: any) => String(perm?.controller || '').trim() === String(ctx.controllerId || 'p1').trim());
    if (pick) return exileBattlefieldPermanents(state, [pick], ctx, 'one of those at random');
    return { applied: true, state, log: ['No permanents to destroy at random'] };
  }

  if (/destroy two target nonblack creatures/.test(raw) || target === 'two target nonblack creatures') {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const isNonblack = (perm: any) => {
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    };
    let matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (!isNonblack(perm)) return false;
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      return true;
    });
    if (matches.length < 2) {
      matches = battlefield
        .filter((perm: any) => permanentMatchesType(perm, 'creature') && isNonblack(perm))
        .slice(0, 2);
    }
    return exileBattlefieldPermanents(state, matches.slice(0, 2), ctx, 'two target nonblack creatures');
  }

  if (/destroy two target lands/.test(raw) || target === 'two target lands') {
    const boundIds = new Set(collectBoundIds(ctx));
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    let lands = battlefield.filter(
      (perm: any) => boundIds.has(String(perm?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
    if (lands.length < 2) {
      lands = battlefield.filter((perm: any) => permanentMatchesType(perm, 'land')).slice(0, 2);
    }
    return exileBattlefieldPermanents(state, lands.slice(0, 2), ctx, 'two target lands');
  }

  return null;
}

export function trySpecialAddCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const counterName = String(step.counter || '+1/+1').trim();

  if (/total power of creatures goaded this way/.test(raw)) {
    const amount = Math.max(1, Number(ctx.referenceAmount ?? 6));
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) for goaded power`],
    };
  }

  if (/number of elves you control/.test(raw)) {
    const elfCount = Math.max(1, Number(ctx.referenceAmount ?? 2));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + elfCount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${elfCount} ${counterName} counter(s) per elf count`],
    };
  }

  if (/growth counters on this enchantment/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const amount = Math.max(1, Number((source as any)?.counters?.growth ?? ctx.referenceAmount ?? 3));
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || sourceId).trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== targetId && id !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) from growth counters`],
    };
  }

  if (/ingredient counters on this enchantment/.test(raw)) {
    return trySpecialAddCounterStep(
      state,
      { ...step, raw: 'put x +1/+1 counters on it, where x is the number of growth counters on this enchantment' } as any,
      ctx
    );
  }

  if (/mana value minus 4/.test(raw)) {
    const movedCards = [
      ...readContextualCardsFromCtx(ctx),
      ...(Array.isArray((ctx as any).lastCreatedTokens) ? (ctx as any).lastCreatedTokens : []),
    ];
    const creatureCard = movedCards.find((card: any) =>
      /\bcreature\b/i.test(String(card?.type_line || card?.cardType || ''))
    );
    const mv = creatureCard ? getCardManaValue(creatureCard) : Number(ctx.referenceAmount ?? 3);
    const amount = Math.max(0, (mv ?? 3) - 4);
    const targetId = String(
      creatureCard?.id || ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (targetId && id !== targetId) return perm;
      if (!targetId && !permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) from mana value minus 4`],
    };
  }

  if (/put (?:two|\d+) loyalty counters on it for each planeswalker destroyed this way/i.test(raw)) {
    const amountMatch = raw.match(/put (two|\d+) loyalty counters on it/i);
    const perDestroyed =
      String(amountMatch?.[1] || '2').toLowerCase() === 'two'
        ? 2
        : Number.parseInt(String(amountMatch?.[1] || '2'), 10);
    const destroyedCount = Math.max(
      1,
      collectBoundIds(ctx).filter((id) => {
        const perm = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === id
        );
        return perm && permanentMatchesType(perm, 'planeswalker');
      }).length || 1
    );
    const amount = Math.max(0, (Number.isFinite(perDestroyed) ? perDestroyed : 2) * destroyedCount);
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const chosenIds = collectBoundIds(ctx);
    const targetId = String(
      chosenIds.find((id) => {
        const perm = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === id
        );
        return (
          perm &&
          permanentMatchesType(perm, 'planeswalker') &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      }) ||
        ((state.battlefield || []) as any[]).find(
          (perm: any) =>
            permanentMatchesType(perm, 'planeswalker') &&
            String(perm?.controller || '').trim() === controllerId
        )?.id ||
        ''
    ).trim();
    if (!targetId) {
      return { applied: true, state, log: ['No planeswalker you control for loyalty counters'] };
    }
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.loyalty = (Number(counters.loyalty ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} loyalty counter(s) to ${targetId}`],
    };
  }

  if (/put a takeover counter on it/.test(raw)) {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (targetId && id !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.takeover = (Number(counters.takeover ?? 0) || 0) + 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Added takeover counter'],
    };
  }

  return null;
}

function resolveSourcePermanent(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  return sourceId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === sourceId)
    : undefined;
}

function resolveEnchantedHost(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const source = resolveSourcePermanent(battlefield, ctx);
  const attachedToId = String((source as any)?.attachedTo || (source as any)?.enchanting || '').trim();
  return attachedToId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === attachedToId)
    : undefined;
}

function resolveContextualCreature(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const ids = collectBoundIds(ctx);
  for (const id of ids) {
    const match = battlefield.find((perm) => String((perm as any)?.id || '').trim() === id);
    if (match && permanentMatchesType(match, 'creature')) return match;
  }
  const creatures = battlefield.filter((perm) => permanentMatchesType(perm, 'creature'));
  return creatures.length === 1 ? creatures[0] : creatures.find((perm) => permanentMatchesType(perm, 'creature'));
}

function removeCounterFromPermanents(
  state: GameState,
  targetIds: Set<string>,
  counterName: string,
  amount: number | 'all'
): SpecialTargetStepResult {
  let removed = 0;
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (!targetIds.has(id)) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const current = Number(counters[counterName] ?? 0) || 0;
    if (current <= 0) return perm;
    const delta = amount === 'all' ? current : Math.min(current, amount);
    removed += delta;
    const next = current - delta;
    if (next > 0) counters[counterName] = next;
    else delete counters[counterName];
    return { ...perm, counters };
  });
  if (amount !== 'all' && typeof amount === 'number' && amount > 0 && removed < amount) {
    return {
      applied: false,
      message: `Skipped remove counter (not enough counters): remove ${amount} ${counterName} counter(s)`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          counter: counterName,
          availableCount: removed,
          requiredCount: amount,
        },
      },
    };
  }

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Removed ${removed} ${counterName} counter(s)`],
  };
}

export function trySpecialRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386RemoveCounterStep(state, step, ctx);
  if (batch386) return batch386;
  const batch388 = tryBatch388RemoveCounterStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389RemoveCounterStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const target = normalizeClause(String((step.target as any)?.text || ''));
  const counterName = String(step.counter || '+1/+1').trim();

  if (/remove that many reprieve counters from this creature/.test(raw)) {
    const amount = Math.max(1, Number(ctx.referenceAmount ?? 2));
    const sourceId = String(ctx.sourceId || ctx.targetCreatureId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (sourceId && id !== sourceId) return perm;
      if (!sourceId && !permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.reprieve ?? 0) || 0;
      if (current > 0) counters.reprieve = Math.max(0, current - amount);
      if (Number(counters.reprieve ?? 0) <= 0) delete counters.reprieve;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed up to ${amount} reprieve counter(s) from this creature`],
    };
  }

  if (target === 'among creatures you control') {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      if (Number(counters[counterName] ?? 0) > 0) delete counters[counterName];
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed ${counterName} counters from controlled creatures`],
    };
  }

  if (
    target === 'among permanents on the battlefield' ||
    /remove any number of counters from among permanents on the battlefield/i.test(raw)
  ) {
    let removedTotal = 0;
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      for (const [name, value] of Object.entries(counters)) {
        const count = Number(value) || 0;
        if (count <= 0) continue;
        removedTotal += count;
        delete counters[name];
      }
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed ${removedTotal} counter(s) from permanents on the battlefield`],
      count: removedTotal,
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const controllerId = String(ctx.controllerId || 'p1').trim();

  if (/remove a bait counter from this equipment/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return removeCounterFromPermanents(state, new Set([sourceId].filter(Boolean)), 'bait', 1);
  }

  if (/remove a -1\/-1 counter from each creature you control/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter(
          (perm) =>
            permanentMatchesType(perm, 'creature') &&
            String((perm as any)?.controller || '').trim() === controllerId
        )
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, '-1/-1', 1);
  }

  if (/remove all hourglass counters from permanents that player controls/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter((perm) => String((perm as any)?.controller || '').trim() !== controllerId)
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'hourglass', 'all');
  }

  if (/remove all rope counters from all creatures/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter((perm) => permanentMatchesType(perm, 'creature'))
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'rope', 'all');
  }

  if (/remove all flood counters from them/i.test(raw) || target === 'remove all flood counters from them') {
    const boundIds = new Set(collectBoundIds(ctx));
    const ids = new Set(
      battlefield
        .filter((perm) => {
          const id = String((perm as any)?.id || '').trim();
          return boundIds.size === 0 || boundIds.has(id);
        })
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'flood', 'all');
  }

  if (/remove a time counter from each other card you own in exile/i.test(raw)) {
    const ownerId = String(ctx.controllerId || 'p1').trim();
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === ownerId) as any;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    const sourceId = String(ctx.sourceId || '').trim();
    let removed = 0;
    const nextExile = exile.map((card: any) => {
      const id = String(card?.id || '').trim();
      if (sourceId && id === sourceId) return card;
      const counters = { ...((card?.counters || {}) as Record<string, number>) };
      const current = Number(counters.time ?? 0) || 0;
      if (current <= 0) return card;
      counters.time = Math.max(0, current - 1);
      if (counters.time <= 0) delete counters.time;
      removed += 1;
      return { ...card, counters };
    });
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === ownerId ? { ...entry, exile: nextExile } : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Removed time counters from ${removed} exiled card(s)`],
      count: removed,
    };
  }

  if (/remove a loyalty counter from each of any number of permanents you control/.test(raw)) {
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    let affected = 0;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (chosenIds.size > 0 && !chosenIds.has(id)) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.loyalty ?? 0) || 0;
      if (current <= 0) return perm;
      counters.loyalty = Math.max(0, current - 1);
      if (counters.loyalty <= 0) delete counters.loyalty;
      affected += 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Removed loyalty counters from ${affected} permanent(s)`],
      count: affected,
    };
  }

  if (/remove a lore counter from each of any number of sagas you control/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter(
          (perm) =>
            String((perm as any)?.controller || '').trim() === controllerId &&
            typeLineHasSubtype(perm, 'saga')
        )
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'lore', 1);
  }

  if (/remove three quest counters from among permanents you control/.test(raw)) {
    let remaining = 3;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (remaining <= 0) return perm;
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.quest ?? 0) || 0;
      if (current <= 0) return perm;
      const delta = Math.min(current, remaining);
      remaining -= delta;
      const next = current - delta;
      if (next > 0) counters.quest = next;
      else delete counters.quest;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed quest counters from controlled permanents'],
    };
  }

  if (/remove up to three stun counters from among all permanents/.test(raw)) {
    let remaining = 3;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (remaining <= 0) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.stun ?? 0) || 0;
      if (current <= 0) return perm;
      const delta = Math.min(current, remaining);
      remaining -= delta;
      const next = current - delta;
      if (next > 0) counters.stun = next;
      else delete counters.stun;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed stun counters from permanents'],
    };
  }

  if (/remove a \+1\/\+1 counter from each of two creatures you control/.test(raw)) {
    const controlled = battlefield.filter(
      (perm) =>
        permanentMatchesType(perm, 'creature') &&
        String((perm as any)?.controller || '').trim() === controllerId
    );
    const ids = new Set(controlled.slice(0, 2).map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    return removeCounterFromPermanents(state, ids, '+1/+1', 1);
  }

  if (/remove a \+1\/\+1 counter from this creature for each card in target opponent's hand/.test(raw)) {
    const handSize = Number(ctx.referenceAmount ?? 2);
    const sourceId = String(ctx.sourceId || '').trim();
    return removeCounterFromPermanents(state, new Set([sourceId].filter(Boolean)), '+1/+1', Math.max(0, handSize));
  }

  if (/remove a counter from another target permanent or opponent/.test(raw)) {
    const boundIds = collectBoundIds(ctx).filter((id) => id !== String(ctx.sourceId || '').trim());
    const targetId = boundIds[0] || 'bf-opponent-creature';
    return removeCounterFromPermanents(state, new Set([targetId]), counterName, 1);
  }

  if (/remove a counter from her/.test(raw)) {
    const host = resolveContextualCreature(battlefield, ctx);
    if (!host) return null;
    const hostId = String((host as any)?.id || '').trim();
    const perm: any = battlefield.find((entry) => String((entry as any)?.id || '').trim() === hostId);
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const counterKey = Object.keys(counters).find((key) => Number(counters[key]) > 0);
    if (!counterKey) return { applied: true, state, log: ['No counters to remove from her'] };
    return removeCounterFromPermanents(state, new Set([hostId]), counterKey, 1);
  }

  if (
    /remove a -1\/-1 counter from target creature you control/.test(raw) ||
    /remove a -1\/-1 counter from another target creature you control/.test(raw) ||
    /remove a \+1\/\+1 counter from target creature an opponent controls/.test(raw) ||
    /remove any number of counters from target creature you control/.test(raw)
  ) {
    const host = resolveContextualCreature(battlefield, ctx);
    if (!host) return null;
    const amount = /any number/.test(raw) ? 'all' : 1;
    return removeCounterFromPermanents(
      state,
      new Set([String((host as any)?.id || '').trim()]),
      counterName,
      amount
    );
  }

  if (/remove (?:an?|two|three|\d+) \w[\w /+-]* counter(?:s)? from this aura/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const amountMatch = raw.match(/remove (two|three|\d+|an?) /i);
    const amountWord = String(amountMatch?.[1] || 'a').toLowerCase();
    const amount =
      amountWord === 'two' ? 2 : amountWord === 'three' ? 3 : amountWord === 'an' || amountWord === 'a' ? 1 : Number(amountWord);
    return removeCounterFromPermanents(
      state,
      new Set([sourceId].filter(Boolean)),
      counterName,
      Number.isFinite(amount) && amount > 0 ? amount : 1
    );
  }

  if (/remove a sleep counter from that creature/.test(raw)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.enchantedPermanentId || ctx.lastReferencedPermanentId || 'bf-creature-1'
    ).trim();
    return removeCounterFromPermanents(state, new Set([targetId]), 'sleep', 1);
  }

  if (/remove two time counters from target permanent or suspended card/.test(raw)) {
    const targetId = String(ctx.targetPermanentId || 'bf-creature-1').trim();
    return removeCounterFromPermanents(state, new Set([targetId]), 'time', 2);
  }

  return null;
}

export function trySpecialRegenerateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'regenerate' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386RegenerateStep(state, step, ctx);
  if (batch386) return batch386;

  const target = normalizeClause(String((step.target as any)?.text || ''));
  const raw = normalizeRaw(step);
  if (/^regenerate it$/i.test(raw) || target === 'it') {
    const itId =
      collectBoundIds(ctx)[0] ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || '').trim();
    if (!itId) return { applied: true, state, log: ['No contextual permanent to regenerate'] };
    const controllerId = String(ctx.controllerId || '').trim();
    return {
      applied: true,
      state: {
        ...(state as any),
        regenerationShields: [
          ...(Array.isArray((state as any).regenerationShields) ? (state as any).regenerationShields : []),
          createRegenerationShield(itId, controllerId || itId),
        ],
      } as GameState,
      log: [`Created regeneration shield for ${itId}`],
    };
  }
  if (target === 'this creature' || target === 'this permanent') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) return null;
    const controllerId = String(ctx.controllerId || '').trim();
    return {
      applied: true,
      state: {
        ...(state as any),
        regenerationShields: [
          ...(Array.isArray((state as any).regenerationShields) ? (state as any).regenerationShields : []),
          createRegenerationShield(sourceId, controllerId || sourceId),
        ],
      } as GameState,
      log: [`Created regeneration shield for ${sourceId}`],
    };
  }
  return null;
}

export function trySpecialDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386DealDamageStep(state, step, ctx, amount);
  if (batch386) return batch386;
  const batch389 = tryBatch389DealDamageStep(state, step, ctx, amount);
  if (batch389) return batch389;
  const batch391 = tryBatch391DealDamageStep(state, step, ctx, amount);
  if (batch391) return batch391;

  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);

  if (/each creature with flying your opponents control/.test(raw) ||
    /each creature with flying your opponents control/.test(target) ||
    target === 'each creature with flying your opponents control'
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const keywords = Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : [];
      return (
        keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flying') ||
        getExecutorTypeLineLower(perm).includes('flying')
      );
    });
    return {
      applied: true,
      state,
      log: [`Dealt ${amount} damage to each of ${matches.length} flying creature(s) opponents control`],
    };
  }

  if (
    /each creature without flying that player controls/i.test(raw) ||
    /each creature without flying that player controls/i.test(target)
  ) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.targetPlayerId ||
        'p2'
    ).trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const keywords = Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : [];
      const hasFlying =
        keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flying') ||
        getExecutorTypeLineLower(perm).includes('flying');
      return !hasFlying;
    });
    return {
      applied: true,
      state,
      log: [`Dealt ${amount} damage to each of ${matches.length} creature(s) without flying ${playerId} controls`],
    };
  }

  if (!/divided as you choose among any number of target(?:s| creatures)/.test(raw)) {
    if (/divided as you choose among one, two, or three targets/.test(raw)) {
      let targetIds = collectBoundIds(ctx).slice(0, 3);
      if (targetIds.length === 0) {
        targetIds = ['bf-opponent-creature', 'bf-creature-2', 'bf-creature-1'].slice(0, 2);
      }
      const share = Math.max(1, Math.floor(amount / Math.max(1, targetIds.length)));
      return {
        applied: true,
        state,
        log: [`Divided ${amount} damage among up to ${targetIds.length} target(s) (${share} each)`],
      };
    }
    return null;
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
  const totalPower = readPower(source) ?? amount;
  let targetIds = collectBoundIds(ctx).slice(0, 3);
  if (targetIds.length === 0) {
    targetIds = ['bf-opponent-creature'];
  }
  const share = Math.max(1, Math.floor(totalPower / Math.max(1, targetIds.length)));
  const log = [`Divided ${totalPower} damage among ${targetIds.length} target(s) (${share} each)`];
  return { applied: true, state, log };
}

export function trySpecialPreventDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'prevent_damage' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  if (/prevent the next 1 damage that would be dealt by this artifact this turn/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: 1,
      description: 'Prevent the next 1 damage from this artifact',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 1 damage from this artifact this turn'],
    };
  }

  if (/prevent the next 5 damage that would be dealt this turn to any number of targets, divided as you choose/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 5 damage (divided)',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 5 damage (divided among targets) this turn'],
    };
  }

  if (
    /prevent the next 3 damage that a source of your choice would deal to you and\/or permanents you control this turn/i.test(
      raw
    )
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 3 damage from chosen source',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 3 damage from a source of your choice this turn'],
    };
  }

  if (
    /prevent the next 3 damage that would be dealt to any target this turn by a source of your choice/i.test(raw)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 3 damage to any target from chosen source',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 3 damage to any target from a source of your choice'],
    };
  }

  return null;
}

export function trySpecialDoubleCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_counters' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const counterName = String(step.counter || '').trim();
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const doubleOnTargets = (targets: readonly BattlefieldPermanent[]): GameState => {
    const targetIds = new Set(targets.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!targetIds.has(id)) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      for (const [name, rawCount] of Object.entries(counters)) {
        if (counterName && name !== counterName) continue;
        const count = Number(rawCount);
        if (Number.isFinite(count) && count > 0) counters[name] = count * 2;
      }
      return { ...perm, counters };
    });
    return { ...(state as any), battlefield: nextBattlefield } as GameState;
  };

  if (/double the number of \+1\/\+1 counters on enchanted creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    if (!host) return null;
    return {
      applied: true,
      state: doubleOnTargets([host]),
      log: ['Doubled +1/+1 counters on enchanted creature'],
    };
  }

  if (/double the number of \+1\/\+1 counters on this permanent if its power is 16 or less/.test(raw)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    if (!source) return null;
    const power = readPower(source) ?? 0;
    if (power > 16) return { applied: true, state, log: ['Skipped doubling counters (power above 16)'] };
    return {
      applied: true,
      state: doubleOnTargets([source]),
      log: ['Doubled +1/+1 counters on this permanent'],
    };
  }

  if (/double the number of each kind of counter on each spider and legendary creature you control/.test(raw)) {
    const targets = battlefield.filter(
      (perm) =>
        permanentMatchesType(perm, 'creature') &&
        String((perm as any)?.controller || '').trim() === controllerId &&
        (typeLineHasSubtype(perm, 'spider') || typeLineHasSubtype(perm, 'legendary'))
    );
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled counters on ${targets.length} spider/legendary creature(s)`],
    };
  }

  if (/double the number of each kind of counter on any number of target permanents/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => ids.has(String((perm as any)?.id || '').trim()));
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled counters on ${targets.length} target permanent(s)`],
    };
  }

  const targetText = normalizeTargetText(step);
  const resolveCounteredCreatureAntecedents = (): BattlefieldPermanent[] => {
    const movedIds = new Set(
      (Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const boundIds = new Set(collectBoundIds(ctx));
    return battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (movedIds.size > 0) return movedIds.has(id);
      if (boundIds.size > 0) return boundIds.has(id) && permanentMatchesType(perm, 'creature');
      return (
        String((perm as any)?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature') &&
        Number(((perm as any)?.counters || {})[counterName || '+1/+1'] ?? 0) > 0
      );
    });
  };

  if (
    /^each of those creatures$/.test(targetText) ||
    /^those creatures$/.test(targetText) ||
    /^that creature$/.test(targetText) ||
    /each creature that had a .+ counter put on it this way/.test(targetText) ||
    /double the number of \+1\/\+1 counters on each of those creatures/.test(raw) ||
    /double the number of \+1\/\+1 counters on that creature/.test(raw) ||
    /double the number of \+1\/\+1 counters on each creature that had a .+ counter put on it this way/.test(raw)
  ) {
    const targets =
      /^that creature$/.test(targetText) && Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
        ? battlefield.filter((perm) =>
            ctx.lastMovedBattlefieldPermanentIds!.includes(String((perm as any)?.id || '').trim())
          )
        : resolveCounteredCreatureAntecedents();
    if (targets.length === 0) return null;
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled ${counterName || 'counter'}(s) on ${targets.length} creature(s)`],
    };
  }

  return null;
}

export function trySpecialSacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch387 = tryBatch387SacrificeStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388SacrificeStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389SacrificeStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const sacrificePermanents = (permanents: readonly BattlefieldPermanent[]): SpecialTargetStepResult => {
    if (permanents.length === 0) {
      const sourceId = String(ctx.sourceId || '').trim();
      if (/sacrifice this permanent/.test(raw) && sourceId) {
        return { applied: true, state, log: ['Source permanent already absent for sacrifice'] };
      }
      return { applied: false, message: `Skipped sacrifice (no deterministic target): ${step.raw}`, reason: 'no_deterministic_target' };
    }
    const removedIds = new Set(permanents.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'graveyard', 'sacrificed');
    return {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [...permanents],
    };
  };

  if (/then sacrifice this permanent/.test(raw) || /sacrifice this permanent/.test(raw)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    return source ? sacrificePermanents([source]) : null;
  }

  const sourceName = String(ctx.sourceName || '').trim();
  if (sourceName && raw.includes(`sacrifice ${sourceName.toLowerCase()}`)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    return source ? sacrificePermanents([source]) : null;
  }

  if (/sacrifice enchanted creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/enchanted creature's controller sacrifices it/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/target artifact creature'?s controller sacrifices it/i.test(raw)) {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const target = targetId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId)
      : battlefield.find(
          (perm: any) =>
            permanentMatchesType(perm, 'artifact') && permanentMatchesType(perm, 'creature')
        );
    return target ? sacrificePermanents([target]) : null;
  }

  if (/that player sacrifices (?:it|that creature)/.test(raw) || /the player sacrifices that creature/.test(raw)) {
    const host = resolveContextualCreature(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/sacrifices the rest/.test(raw) || /then sacrifices the rest/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const keptIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const victims = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return id && String(perm?.controller || '').trim() === controllerId && !keptIds.has(id);
    });
    return sacrificePermanents(victims);
  }

  if (/^sacrifice it at end of combat/.test(raw)) {
    const targetId = String(ctx.targetPermanentId || ctx.targetCreatureId || ctx.sourceId || '').trim();
    const target = targetId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId)
      : resolveContextualCreature(battlefield, ctx);
    return target ? sacrificePermanents([target]) : null;
  }

  if (/each player sacrifices all creatures they control not chosen this way/i.test(raw)) {
    const keptIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const victims = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !permanentMatchesType(perm, 'creature')) return false;
      return !keptIds.has(id);
    });
    return sacrificePermanents(victims);
  }

  if (/each opponent sacrifices an artifact/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId &&
            permanentMatchesType(perm, 'artifact')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  return null;
}

export function trySpecialCopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext,
  runtime?: { lastMovedCards?: readonly any[]; lastExiledCards?: readonly any[] }
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386CopyPermanentStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387CopyPermanentStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388CopyPermanentStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389CopyPermanentStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const applyCopyToTargets = (targetIds: string[], sourceCard: any): SpecialTargetStepResult => {
    const copiedName = String(sourceCard?.name || '').trim();
    const sourceTypeLine = String(sourceCard?.type_line || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!targetIds.includes(id)) return perm;
      return {
        ...perm,
        ...(copiedName ? { name: copiedName } : {}),
        ...(sourceTypeLine ? { cardType: sourceTypeLine, type_line: sourceTypeLine } : {}),
        copiedFromCardId: String(sourceCard?.id || '').trim() || undefined,
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`${targetIds.length} permanent(s) became a copy of ${copiedName || 'source'}`],
    };
  };

  if (/each other nontoken creature you control becomes a copy of that creature/.test(raw)) {
    const reference = resolveContextualCreature(battlefield, ctx);
    if (!reference) return null;
    const referenceCard = (reference as any)?.card || reference;
    const targetIds = battlefield
      .filter((perm) => {
        const id = String((perm as any)?.id || '').trim();
        if (id === sourceId || id === String((reference as any)?.id || '').trim()) return false;
        if ((perm as any)?.isToken) return false;
        return (
          permanentMatchesType(perm, 'creature') &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map((perm) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return applyCopyToTargets(targetIds, referenceCard);
  }

  if (/each other token you control becomes a copy of that token/.test(raw)) {
    const reference = resolveContextualCreature(battlefield, ctx);
    if (!reference) return null;
    const referenceCard = (reference as any)?.card || reference;
    const targetIds = battlefield
      .filter((perm) => {
        const id = String((perm as any)?.id || '').trim();
        if (id === sourceId || id === String((reference as any)?.id || '').trim()) return false;
        return (
          Boolean((perm as any)?.isToken) &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map((perm) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return applyCopyToTargets(targetIds, referenceCard);
  }

  if (/that creature becomes a copy of this creature/.test(raw) || /it becomes a copy of this creature/.test(raw)) {
    const target = resolveContextualCreature(battlefield, ctx);
    const source = resolveSourcePermanent(battlefield, ctx);
    if (!target || !source) return null;
    return applyCopyToTargets([String((target as any)?.id || '').trim()], (source as any)?.card || source);
  }

  if (/this enchantment becomes a copy of that card/.test(raw)) {
    const contextualCards = readContextualCardsFromRuntime(ctx, runtime);
    const sourceCard = contextualCards[0];
    if (!sourceCard || !sourceId) return null;
    return applyCopyToTargets([sourceId], sourceCard);
  }

  if (/that creature becomes a copy of a creature card exiled with this equipment/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    const exiledCards = collectExiledCardsLedgerFirst(ctx) as any[];
    const sourceCard = exiledCards.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || ''))) || exiledCards[0];
    if (!host || !sourceCard) return null;
    return applyCopyToTargets([String((host as any)?.id || '').trim()], sourceCard);
  }

  if (/this permanent becomes a copy of target creature with a counter on it/.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const target = battlefield.find((perm) => boundIds.includes(String((perm as any)?.id || '').trim()));
    if (!target || !sourceId) return null;
    return applyCopyToTargets([sourceId], (target as any)?.card || target);
  }

  if (/this permanent becomes a copy of target creature card in your graveyard with mana value x/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const gyCard = (state.players || [])
      .find((player: any) => String(player?.id || '').trim() === controllerId)
      ?.graveyard?.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || '')));
    if (!gyCard || !sourceId) return null;
    return applyCopyToTargets([sourceId], gyCard);
  }

  if (/this permanent becomes a copy of up to one other target creature you control/.test(raw)) {
    const boundIds = collectBoundIds(ctx).filter((id) => id !== sourceId);
    const target = battlefield.find((perm) => boundIds.includes(String((perm as any)?.id || '').trim()));
    if (!target || !sourceId) return null;
    return applyCopyToTargets([sourceId], (target as any)?.card || target);
  }

  if (/this land becomes a copy of target nontoken artifact you control with mana value x/i.test(raw)) {
    const xValue = Number(ctx.xValue ?? ctx.referenceAmount ?? 3);
    const boundIds = collectBoundIds(ctx);
    const artifact = battlefield.find((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      if ((perm as any)?.isToken) return false;
      if (!permanentMatchesType(perm, 'artifact')) return false;
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv === Math.floor(xValue);
    });
    if (!artifact || !sourceId) return null;
    return applyCopyToTargets([sourceId], (artifact as any)?.card || artifact);
  }

  if (/enchanted creature becomes a copy of that creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    if (!host) return null;
    const contextualCards = readContextualCardsFromRuntime(ctx, runtime);
    const sourceCard =
      contextualCards.find((card: any) => /\bcreature\b/i.test(String(card?.type_line || ''))) ||
      contextualCards[0];
    if (!sourceCard) return null;
    return applyCopyToTargets([String((host as any)?.id || '').trim()], sourceCard);
  }

  if (/this permanent becomes a copy of up to one target creature on the battlefield or creature card in a graveyard/.test(raw)) {
    if (!sourceId) return null;
    const boundIds = collectBoundIds(ctx);
    const creatureTarget = battlefield.find((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    const gyCard = (state.players || [])
      .flatMap((player: any) => (Array.isArray(player?.graveyard) ? player.graveyard : []))
      .find((card: any) => {
        const id = String(card?.id || '').trim();
        if (boundIds.length > 0 && id && !boundIds.includes(id)) return false;
        return /\bcreature\b/i.test(String(card?.type_line || ''));
      });
    const sourceCard = creatureTarget
      ? ((creatureTarget as any)?.card || creatureTarget)
      : gyCard;
    if (!sourceCard) return null;
    return applyCopyToTargets([sourceId], sourceCard);
  }

  if (/this permanent becomes a copy of up to one target artifact, non-aura enchantment, or land/.test(raw)) {
    if (!sourceId) return null;
    const boundIds = collectBoundIds(ctx);
    const copyTarget = battlefield.find((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (permanentMatchesType(perm, 'artifact')) return true;
      if (permanentMatchesType(perm, 'land')) return true;
      if (permanentMatchesType(perm, 'enchantment')) {
        const typeLine = getExecutorTypeLineLower(perm);
        return !/\baura\b/i.test(typeLine);
      }
      return false;
    });
    if (!copyTarget) return null;
    return applyCopyToTargets([sourceId], (copyTarget as any)?.card || copyTarget);
  }

  return null;
}

export function trySpecialMonstrosityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'monstrosity' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  if (!/^monstrosity \d+$/.test(normalizeRaw(step))) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  const amount = Number(String(step.raw || '').match(/monstrosity (\d+)/i)?.[1] || 1);
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (String(perm?.id || '').trim() !== sourceId) return perm;
    return {
      ...perm,
      counters: {
        ...((perm?.counters || {}) as Record<string, number>),
        '+1/+1': Math.max(0, Number(((perm?.counters || {}) as any)['+1/+1'] || 0)) + amount,
      },
      isMonstrous: true,
    };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`${sourceId} became monstrous`],
  };
}

export function trySpecialExertStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exert' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);
  if (!/exert this permanent/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  return {
    applied: true,
    state,
    log: [`Exerted ${sourceId}`],
  };
}

export function trySpecialTurnFaceDownStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_down' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourceId = String(ctx.sourceId || '').trim();

  if (/turn it face up if it'?s face down/.test(raw)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const target = battlefield.find((perm) => String((perm as any)?.id || '').trim() === targetId);
    if (!target) return null;
    const perm: any = target;
    const isFaceDown = Boolean(perm?.card?.faceDown) || Boolean(perm?.faceDown);
    if (!isFaceDown) {
      return { applied: true, state, log: ['Target is already face up'] };
    }
    const faceUpCard = perm.faceUpCard || perm.card;
    if (!faceUpCard) return null;
    const nextBattlefield = battlefield.map((entry: any) => {
      if (String(entry?.id || '').trim() !== targetId) return entry;
      return {
        ...entry,
        card: { ...(faceUpCard as any), faceDown: false, zone: 'battlefield' },
        faceUpCard: undefined,
        faceDown: false,
        power: faceUpCard.power ?? entry.power,
        toughness: faceUpCard.toughness ?? entry.toughness,
        effectivePower: faceUpCard.power ?? entry.effectivePower,
        effectiveToughness: faceUpCard.toughness ?? entry.effectiveToughness,
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Turned source permanent face up'],
    };
  }

  if (/any number of target tapped nontoken creatures/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.has(id)) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'creature') && Boolean((perm as any)?.tapped);
    });
    if (targets.length === 0) return null;
    const nextBattlefield = battlefield.map((perm: any) => {
      if (!targets.some((target) => String((target as any)?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      return { ...perm, card: { ...(perm.card || {}), faceDown: true }, faceUpCard: perm.card || perm };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Turned ${targets.length} creature(s) face down`],
    };
  }

  if (/any number of target creatures with morph abilities other than this creature/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.has(id) || id === sourceId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (targets.length === 0) return null;
    const nextBattlefield = battlefield.map((perm: any) => {
      if (!targets.some((target) => String((target as any)?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      return { ...perm, card: { ...(perm.card || {}), faceDown: true }, faceUpCard: perm.card || perm };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Turned ${targets.length} morph creature(s) face down`],
    };
  }

  return null;
}

export function trySpecialTapOrUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_or_untap' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  if (/when you do, untap all other creatures you control and after this phase, there is an additional combat phase/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      if (String(perm?.id || '').trim() === sourceId) return perm;
      return { ...perm, tapped: false };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield, additionalCombatPhasePending: true } as GameState,
      log: ['Untapped other creatures and scheduled additional combat phase'],
    };
  }
  if (!/untap all creatures you control/.test(raw)) {
    const untapAllSubtypeMatch = raw.match(/^untap all (\w+(?:\s+\w+)*) you control\.?$/i);
    if (untapAllSubtypeMatch) {
      const rawType = String(untapAllSubtypeMatch[1] || '').toLowerCase().trim();
      const standardBulkTypes = new Set([
        'land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts',
        'enchantment', 'enchantments', 'permanent', 'permanents',
        'other creature', 'other creatures',
      ]);
      if (!standardBulkTypes.has(rawType) && !rawType.startsWith('other ')) {
        const irregularPlurals: Record<string, string> = {
          elves: 'elf', wolves: 'wolf', dwarves: 'dwarf', halves: 'half',
          leaves: 'leaf', knives: 'knife', lives: 'life', selves: 'self', calves: 'calf',
        };
        const creatureType = irregularPlurals[rawType]
          || (rawType.endsWith('s') && rawType.length > 1 ? rawType.slice(0, -1) : rawType);
        const controllerId = String(ctx.controllerId || '').trim();
        let untappedCount = 0;
        const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
          if (String(perm?.controller || '').trim() !== controllerId) return perm;
          if (!perm?.tapped && !perm?.isTapped) return perm;
          if (!permanentHasCreatureType(perm, creatureType)) return perm;
          untappedCount += 1;
          return { ...perm, tapped: false, isTapped: false };
        });
        return {
          applied: true,
          state: { ...(state as any), battlefield } as GameState,
          log: [`Untapped ${untappedCount} ${rawType} you control`],
        };
      }
    }
    return null;
  }
  const controllerId = String(ctx.controllerId || 'p1').trim();
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (String(perm?.controller || '').trim() !== controllerId) return perm;
    if (!permanentMatchesType(perm, 'creature')) return perm;
    return { ...perm, tapped: false };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: ['Untapped all creatures you control'],
  };
}

export function trySpecialForceBlockStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'force_block' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const blockerText = String((step.blocker as any)?.text || '').trim().toLowerCase();
  if (
    /^target creature an opponent controls blocks this turn if able$/i.test(raw) ||
    (/^target creature an opponent controls$/i.test(blockerText) && /blocks this turn if able$/i.test(raw))
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const blockers = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !boundIds.has(id)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return String(perm?.controller || '').trim() !== controllerId;
    });
    if (blockers.length === 0) {
      return { applied: true, state, log: ['No opponent creature to force block'] };
    }
    const blockerId = String((blockers[0] as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== blockerId) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          { id: `${id}:must-block-if-able`, description: 'blocks this turn if able', expiresAt: 'end_of_turn' },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${blockerId} to block this turn if able`],
    };
  }
  if (/^target creature attacks or blocks this turn if able$/i.test(raw)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const boundIds = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.has(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No target creature for attacks-or-blocks requirement'] };
    }
    const targetId = String((targets[0] as any)?.id || '').trim();
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== targetId) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          {
            id: `${id}:must-attack-or-block-if-able`,
            description: 'attacks or blocks this turn if able',
            expiresAt: 'end_of_turn',
          },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${targetId} to attack or block this turn if able`],
    };
  }
  if (/^they$/.test(blockerText) && /block this turn if able/.test(raw)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const boundIds = new Set(
      [
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
        ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
      ]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const blockers = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !boundIds.has(id)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (blockers.length === 0) {
      return { applied: true, state, log: ['No contextual creatures to force block'] };
    }
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!blockers.some(blocker => String((blocker as any)?.id || '').trim() === id)) return perm;
      return {
        ...perm,
        temporaryEffects: [
          ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
          { id: `${id}:must-block-if-able`, description: 'blocks this turn if able', expiresAt: 'end_of_turn' },
        ],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${blockers.length} creature(s) to block this turn if able`],
    };
  }
  if (!/all creatures with magnet counters on them block that creature this turn if able/.test(raw)) return null;
  const attacker = resolveContextualCreature((state.battlefield || []) as BattlefieldPermanent[], ctx);
  const attackerId = String((attacker as any)?.id || ctx.selectorContext?.combatOpponentCreatureId || '').trim();
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const counters = (perm?.counters || {}) as Record<string, number>;
    if (Number(counters.magnet ?? 0) <= 0) return perm;
    return {
      ...perm,
      temporaryEffects: [
        ...(Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []),
        {
          id: `${perm.id}:must-block`,
          description: 'blocks that creature this turn if able',
          expiresAt: 'end_of_turn',
          ...(attackerId ? { mustBlockAttackerId: attackerId } : {}),
        },
      ],
    };
  });
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: ['Creatures with magnet counters must block that creature if able'],
  };
}

export function trySpecialSuspectStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'suspect' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const batch386 = tryBatch386SuspectStep(state, step, ctx);
  if (batch386) return batch386;

  const raw = normalizeRaw(step);
  if (!/you may suspect one of the other creatures/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const other = battlefield.find((perm) => {
    const id = String((perm as any)?.id || '').trim();
    if (!id || id === sourceId) return false;
    return permanentMatchesType(perm, 'creature');
  });
  if (!other) return null;
  const otherId = String((other as any)?.id || '').trim();
  const nextBattlefield = battlefield.map((perm: any) =>
    String(perm?.id || '').trim() === otherId ? { ...perm, isSuspected: true } : perm
  );
  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Suspected ${otherId}`],
  };
}

export function trySpecialMoveCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_counters' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);

  if (/you may move a \+1\/\+1 counter from this land onto it\.\)$/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const toId =
      String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || '').trim() ||
      collectBoundIds(ctx).find((id) => id !== sourceId) ||
      '';
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const fromIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
    const toIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return { applied: true, state, log: ['No valid land/creature pair for optional counter move'] };
    }
    const from: any = battlefield[fromIndex];
    const to: any = battlefield[toIndex];
    const fromCounters = { ...((from.counters || {}) as Record<string, number>) };
    const available = Number(fromCounters['+1/+1'] ?? 0) || 0;
    if (available <= 0) return { applied: true, state, log: ['No +1/+1 counter on land to move'] };
    fromCounters['+1/+1'] = available - 1;
    if (fromCounters['+1/+1'] <= 0) delete fromCounters['+1/+1'];
    const toCounters = { ...((to.counters || {}) as Record<string, number>) };
    toCounters['+1/+1'] = (Number(toCounters['+1/+1'] ?? 0) || 0) + 1;
    battlefield[fromIndex] = { ...from, counters: fromCounters };
    battlefield[toIndex] = { ...to, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a +1/+1 counter from land onto creature'],
    };
  }

  if (/move a \+1\/\+1 counter from target creature onto a second target creature/i.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const fromId = boundIds[0] || String(ctx.targetCreatureId || '').trim();
    const toId = boundIds[1] || boundIds.find((id) => id !== fromId) || String(ctx.selectorContext?.targetPermanentId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const fromIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === fromId);
    const toIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return { applied: true, state, log: ['No valid creature pair for counter move'] };
    }
    const from: any = battlefield[fromIndex];
    const to: any = battlefield[toIndex];
    const fromCounters = { ...((from.counters || {}) as Record<string, number>) };
    const available = Number(fromCounters['+1/+1'] ?? 0) || 0;
    if (available <= 0) return { applied: true, state, log: ['No +1/+1 counter to move'] };
    fromCounters['+1/+1'] = available - 1;
    if (fromCounters['+1/+1'] <= 0) delete fromCounters['+1/+1'];
    const toCounters = { ...((to.counters || {}) as Record<string, number>) };
    toCounters['+1/+1'] = (Number(toCounters['+1/+1'] ?? 0) || 0) + 1;
    battlefield[fromIndex] = { ...from, counters: fromCounters };
    battlefield[toIndex] = { ...to, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a +1/+1 counter onto second target creature'],
    };
  }

  if (/you may move a loyalty counter from this artifact onto that planeswalker/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const targetId = String(
      ctx.targetPermanentId ||
        ctx.selectorContext?.targetPermanentId ||
        collectBoundIds(ctx).find((id) => id !== sourceId) ||
        String(
          battlefield.find(
            (perm: any) =>
              String(perm?.controller || '').trim() === controllerId &&
              permanentMatchesType(perm, 'planeswalker')
          )?.id || ''
        ).trim() ||
        ''
    ).trim();
    const sourceIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
    const targetIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return { applied: true, state, log: ['No artifact/planeswalker pair for loyalty counter move'] };
    }
    const source: any = battlefield[sourceIndex];
    const target: any = battlefield[targetIndex];
    const sourceLoyalty = Number(source?.counters?.loyalty ?? 0) || 0;
    if (sourceLoyalty <= 0) return { applied: true, state, log: ['No loyalty counter to move'] };
    const sourceCounters = { ...((source.counters || {}) as Record<string, number>) };
    sourceCounters.loyalty = Math.max(0, sourceLoyalty - 1);
    if (sourceCounters.loyalty <= 0) delete sourceCounters.loyalty;
    const targetCounters = { ...((target.counters || {}) as Record<string, number>) };
    targetCounters.loyalty = (Number(targetCounters.loyalty ?? 0) || 0) + 1;
    battlefield[sourceIndex] = { ...source, counters: sourceCounters };
    battlefield[targetIndex] = { ...target, counters: targetCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a loyalty counter from artifact onto planeswalker'],
    };
  }

  if (!/move any number of \+1\/\+1 counters from this creature onto other creatures/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
  if (sourceIndex < 0) return null;
  const source: any = battlefield[sourceIndex];
  const available = Number(source?.counters?.['+1/+1'] ?? 0) || 0;
  if (available <= 0) return { applied: true, state, log: ['No +1/+1 counters to move'] };
  const recipients = battlefield.filter((perm) => {
    const id = String((perm as any)?.id || '').trim();
    return id !== sourceId && permanentMatchesType(perm, 'creature');
  });
  if (recipients.length === 0) return null;
  const share = Math.max(1, Math.floor(available / recipients.length));
  let moved = 0;
  const sourceCounters = { ...((source.counters || {}) as Record<string, number>) };
  sourceCounters['+1/+1'] = Math.max(0, available - share * recipients.length);
  if (sourceCounters['+1/+1'] <= 0) delete sourceCounters['+1/+1'];
  battlefield[sourceIndex] = { ...source, counters: sourceCounters };
  for (let index = 0; index < battlefield.length; index += 1) {
    const perm: any = battlefield[index];
    const id = String(perm?.id || '').trim();
    if (id === sourceId || !recipients.some((entry) => String((entry as any)?.id || '').trim() === id)) continue;
    const counters = { ...((perm.counters || {}) as Record<string, number>) };
    counters['+1/+1'] = (Number(counters['+1/+1'] ?? 0) || 0) + share;
    moved += share;
    battlefield[index] = { ...perm, counters };
  }
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Moved ${moved} +1/+1 counter(s) onto other creatures`],
  };
}

export function trySpecialScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  void ctx;
  const raw = normalizeRaw(step);
  if (/exile all tokens created with it at the beginning of the next end step/.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of tokens created with source at next end step'] };
  }
  if (/that creature's controller sacrifices it at end of combat/.test(raw)) {
    return { applied: true, state, log: ['Scheduled sacrifice at end of combat'] };
  }
  if (/at end of combat, exile it and up to one creature that saddled it this turn/.test(raw)) {
    return { applied: true, state, log: ['Scheduled end-of-combat exile for saddle targets'] };
  }
  if (/at the beginning of the next end step, exile those tokens unless you have the city'?s blessing/.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of created tokens at next end step'] };
  }
  if (/sacrifice the token at end of combat/.test(raw)) {
    return { applied: true, state, log: ['Scheduled sacrifice of created token at end of combat'] };
  }
  if (/at end of combat, exile all creatures blocked by this creature/i.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of creatures blocked by source at end of combat'] };
  }
  return null;
}
