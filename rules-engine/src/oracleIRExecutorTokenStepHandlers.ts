import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { COMMON_TOKENS, createTokens, createTokensByName, parseTokenCreationFromText } from './tokenCreation';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
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

function addTokensToBattlefield(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  const hasOverrides = Boolean(entersTapped) || (withCounters && Object.keys(withCounters).length > 0);

  const resolveCommonTokenKey = (name: string): string | null => {
    const raw = String(name || '').trim();
    if (!raw) return null;
    if ((COMMON_TOKENS as any)[raw]) return raw;
    const lower = raw.toLowerCase();
    const key = Object.keys(COMMON_TOKENS).find(k => k.toLowerCase() === lower);
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
        };
      }
    }
  }

  const tokenParse = parseTokenCreationFromText(clauseRaw);
  if (!tokenParse) {
    return { state, log: ['Token creation not recognized'] };
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
  };
}

export function applyCreateTokenStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext
): TokenStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped token creation (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
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
  }

  return { applied: true, state: nextState, log };
}
