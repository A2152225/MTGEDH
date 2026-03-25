import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { COMMON_TOKENS, createTokens, createTokensByName, parseTokenCreationFromText } from './tokenCreation';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { attachExistingBattlefieldPermanentToTarget } from './oracleIRExecutorZoneOps';
import { getCardManaValue, quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly createdTokenIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector';
  readonly options?: {
    readonly classification?: 'ambiguous';
  };
};

export type TokenStepHandlerResult = StepApplyResult | StepSkipResult;

type TokenStepRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
};

function getOwnerIdFromCard(card: any): string {
  return String(
    card?.ownerId ??
      card?.owner ??
      card?.card?.ownerId ??
      card?.card?.owner ??
      ''
  ).trim();
}

function resolveTokenControllersFromMovedCards(runtime?: TokenStepRuntime): readonly PlayerID[] {
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const seen = new Set<string>();
  const out: PlayerID[] = [];
  for (const card of movedCards) {
    const ownerId = getOwnerIdFromCard(card);
    if (!ownerId || seen.has(ownerId)) continue;
    seen.add(ownerId);
    out.push(ownerId as PlayerID);
  }
  return out;
}

function resolveTokenAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): number | null {
  const numericAmount = quantityToNumber(step.amount);
  if (numericAmount !== null) return numericAmount;
  if (step.amount.kind !== 'x') return null;

  const whereMatch = String(step.raw || '').match(/\bwhere\s+x\s+is\s+(.+)$/i);
  if (!whereMatch) return null;

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  if (!controllerId) return null;

  const whereRaw = `X is ${String(whereMatch[1] || '').trim()}`;
  const evaluated = evaluateModifyPtWhereX(
    state,
    controllerId,
    whereRaw,
    undefined,
    ctx,
    {
      lastMovedCards: Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [],
    } as any
  );
  if (evaluated !== null) return evaluated;

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length !== 1) return null;

  const normalized = String(whereRaw || '').trim().toLowerCase();
  const movedCard = moved[0] as any;
  const readFinite = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) power$/.test(normalized)) {
    return readFinite(movedCard?.power ?? movedCard?.card?.power);
  }
  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) toughness$/.test(normalized)) {
    return readFinite(movedCard?.toughness ?? movedCard?.card?.toughness);
  }
  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) mana value$/.test(normalized)) {
    const manaValue = getCardManaValue(movedCard);
    return manaValue === null ? null : manaValue;
  }

  return null;
}

function addTokensToBattlefield(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; createdTokenIds: string[] } {
  const hasOverrides = Boolean(entersTapped) || (withCounters && Object.keys(withCounters).length > 0);

  const normalizeTokenLookupText = (value: string): string =>
    String(value || '')
      .toLowerCase()
      .replace(/\b(?:white|blue|black|red|green|colorless)\b/g, ' ')
      .replace(/\btoken(s)?\b/g, ' ')
      .replace(/\b(?:creature|artifact|enchantment)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const resolveCommonTokenKey = (name: string): string | null => {
    const raw = String(name || '').trim();
    if (!raw) return null;
    if ((COMMON_TOKENS as any)[raw]) return raw;
    const normalized = normalizeTokenLookupText(raw);
    const key = Object.keys(COMMON_TOKENS).find(k => normalizeTokenLookupText(k) === normalized);
    return key || null;
  };

  const hintedName = tokenHint
    .replace(/\btoken(s)?\b/gi, '')
    .replace(/\b(creature|artifact|enchantment)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (hintedName) {
    const commonKey = resolveCommonTokenKey(hintedName);
    if (commonKey) {
      const count = Math.max(1, amount | 0);
      const result = hasOverrides
        ? createTokens(
            {
              characteristics: { ...COMMON_TOKENS[commonKey], entersTapped: entersTapped || undefined },
              count,
              controllerId,
              sourceId: ctx.sourceId,
              sourceName: ctx.sourceName,
              withCounters,
            },
            state.battlefield || []
          )
        : createTokensByName(commonKey, count, controllerId, state.battlefield || [], ctx.sourceId, ctx.sourceName);

      if (result) {
        const tokensToAdd = result.tokens.map(token => token.token);
        return {
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...result.log],
          createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
        };
      }
    }
  }

  const tokenParse = parseTokenCreationFromText(clauseRaw);
  if (!tokenParse) {
    return { state, log: ['Token creation not recognized'], createdTokenIds: [] };
  }

  const count = Math.max(1, amount | 0);

  if (!hasOverrides) {
    const commonKey = resolveCommonTokenKey(tokenParse.characteristics.name);
    if (commonKey) {
      const commonParsed = createTokensByName(
        commonKey,
        count,
        controllerId,
        state.battlefield || [],
        ctx.sourceId,
        ctx.sourceName
      );
      if (commonParsed) {
        const tokensToAdd = commonParsed.tokens.map(token => token.token);
        return {
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...commonParsed.log],
          createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
        };
      }
    }
  }

  const created = createTokens(
    {
      characteristics: {
        ...tokenParse.characteristics,
        entersTapped: entersTapped ?? tokenParse.characteristics.entersTapped,
      },
      count,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      withCounters,
    },
    state.battlefield || []
  );

  const tokensToAdd = created.tokens.map(token => token.token);
  return {
    state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
    log: [...created.log],
    createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
  };
}

function scheduleTokenCleanup(
  state: GameState,
  controllerId: PlayerID,
  sourceName: string | undefined,
  sourceId: string | undefined,
  tokenIds: readonly string[],
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile'
): { state: GameState; log: string[] } {
  const normalizedTokenIds = tokenIds.map(id => String(id || '').trim()).filter(Boolean);
  if (normalizedTokenIds.length === 0) {
    return { state, log: [] };
  }

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const effect =
    action === 'exile'
      ? normalizedTokenIds.length === 1
        ? 'Exile that token.'
        : 'Exile those tokens.'
      : normalizedTokenIds.length === 1
        ? 'Sacrifice that token.'
        : 'Sacrifice those tokens.';

  const delayedTrigger = createDelayedTrigger(
    String(sourceId || sourceName || 'oracle-ir'),
    String(sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      targets: [...normalizedTokenIds],
      eventDataSnapshot: {
        sourceId: sourceId ? String(sourceId).trim() : undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: normalizedTokenIds.length === 1 ? normalizedTokenIds[0] : undefined,
        chosenObjectIds: normalizedTokenIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [
      `Scheduled delayed ${action} for ${normalizedTokenIds.length} token(s) at ${timing.replace(/_/g, ' ')}`,
    ],
  };
}

export function applyCreateTokenStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): TokenStepHandlerResult {
  const amount = resolveTokenAmount(state, step, ctx, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped token creation (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players =
    step.who.kind === 'owner_of_moved_cards'
      ? resolveTokenControllersFromMovedCards(runtime)
      : resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const allCreatedTokenIds: string[] = [];
  for (const playerId of players) {
    const result = addTokensToBattlefield(
      nextState,
      playerId,
      amount,
      step.token,
      step.raw,
      ctx,
      step.entersTapped,
      step.withCounters
    );
    nextState = result.state;
    log.push(...result.log);
    allCreatedTokenIds.push(...result.createdTokenIds);

    if (result.createdTokenIds.length > 0 && step.battlefieldAttachedTo) {
      if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
        return {
          applied: false,
          message: `Skipped token creation (unsupported attachment selector): ${step.raw}`,
          reason: 'unsupported_player_selector',
        };
      }

      const attachmentTargetText = String((step.battlefieldAttachedTo as any)?.text || '').trim().toLowerCase();
      const priorMovedIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
        ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      const attachmentTargetId =
        attachmentTargetText === 'that creature' || attachmentTargetText === 'it'
          ? priorMovedIds.length === 1
            ? priorMovedIds[0]
            : ''
          : '';

      if (!attachmentTargetId) {
        return {
          applied: false,
          message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
          reason: 'unsupported_player_selector',
        };
      }

      for (const tokenId of result.createdTokenIds) {
        const attachResult = attachExistingBattlefieldPermanentToTarget(nextState, tokenId, attachmentTargetId);
        if (attachResult.kind === 'impossible') {
          return {
            applied: false,
            message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
            reason: 'unsupported_player_selector',
          };
        }
        nextState = attachResult.state;
        log.push(...attachResult.log);
      }
    }

    if (result.createdTokenIds.length > 0 && step.atNextEndStep) {
      const scheduled = scheduleTokenCleanup(
        nextState,
        playerId,
        ctx.sourceName,
        ctx.sourceId,
        result.createdTokenIds,
        DelayedTriggerTiming.NEXT_END_STEP,
        step.atNextEndStep
      );
      nextState = scheduled.state;
      log.push(...scheduled.log);
    }

    if (result.createdTokenIds.length > 0 && step.atEndOfCombat) {
      const scheduled = scheduleTokenCleanup(
        nextState,
        playerId,
        ctx.sourceName,
        ctx.sourceId,
        result.createdTokenIds,
        DelayedTriggerTiming.END_OF_COMBAT,
        step.atEndOfCombat
      );
      nextState = scheduled.state;
      log.push(...scheduled.log);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    createdTokenIds: allCreatedTokenIds,
  };
}
