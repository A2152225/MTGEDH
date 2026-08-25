/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Shared special-target result types, normalize helpers, and exile ops.
 * Public: SpecialTargetStepResult, normalizeRaw, normalizeTargetText, collectBoundIds,
 * exileBattlefieldPermanents, millToExile, exileContextualCardsFromCtx, exileSourceWithCounter.
 */
import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, resolveZoneCardIdFromPermanent } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { collectContextualCardsLedgerFirst } from './oracleIRLedgerCardAccess';

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

export function readContextualCardsFromCtx(ctx: OracleIRExecutionContext): any[] {
  return collectContextualCardsLedgerFirst(ctx) as any[];
}

export function readContextualAndExiledCardsFromCtx(ctx: OracleIRExecutionContext): any[] {
  const fromLedger = collectContextualCardsLedgerFirst(ctx);
  if (fromLedger.length > 0) return fromLedger as any[];
  return [
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
  ];
}

export function readContextualCardsFromRuntime(
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

export function normalizeClause(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeTargetText(step: TargetedOracleEffectStep): string {
  const target = step.target;
  const rawTarget =
    typeof target === 'object' && target !== null && 'kind' in target && target.kind === 'raw'
      ? String(target.text || '')
      : '';
  return normalizeClause(rawTarget.replace(/^exile\s+/i, '').trim());
}

export function normalizeRaw(step: OracleEffectStep): string {
  return normalizeClause(String(step.raw || ''));
}

export function collectBoundIds(ctx: OracleIRExecutionContext): string[] {
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

export function readPower(perm: any): number | undefined {
  for (const value of [perm?.effectivePower, perm?.basePower, perm?.card?.power, perm?.power]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function typeLineHasSubtype(perm: any, subtype: string): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  return new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
}

export function exileBattlefieldPermanents(
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

export function exileControllerPermanentsMatching(
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

export function exileOneContextualFaceDownRestToLibraryBottom(
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

export function exileOneContextualRestToLibraryTop(
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

export function exileContextualCardsFromCtx(
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

export function exileSourceWithCounter(
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

export function millToExile(
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
