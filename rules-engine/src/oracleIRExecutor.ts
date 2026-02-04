import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { createTokens, createTokensByName, parseTokenCreationFromText } from './tokenCreation';
import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';

export interface OracleIRExecutionOptions {
  /**
   * If false (default), skips "may" steps because they require a player choice.
   * If true, applies optional steps as if the player chose "yes".
   */
  readonly allowOptional?: boolean;
}

export interface OracleIRExecutionContext {
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
}

export interface OracleIRExecutionResult {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly appliedSteps: readonly OracleEffectStep[];
  readonly skippedSteps: readonly OracleEffectStep[];
}

function quantityToNumber(qty: OracleQuantity): number | null {
  if (qty.kind === 'number') return qty.value;
  return null;
}

function resolvePlayers(
  state: GameState,
  selector: OraclePlayerSelector,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  switch (selector.kind) {
    case 'you':
      return [ctx.controllerId];
    case 'each_player':
      return state.players.map(p => p.id);
    case 'each_opponent':
      return state.players.filter(p => p.id !== ctx.controllerId).map(p => p.id);
    // Targeting not supported by this executor yet.
    case 'target_player':
    case 'target_opponent':
    case 'unknown':
    default:
      return [];
  }
}

function drawCardsForPlayer(state: GameState, playerId: PlayerID, count: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = [...((player as any).library || [])];
  const hand = [...((player as any).hand || [])];

  let drawn = 0;
  for (let i = 0; i < Math.max(0, count | 0); i++) {
    if (library.length === 0) {
      log.push(`${playerId} cannot draw (empty library)`);
      break;
    }
    const [card] = library.splice(0, 1);
    hand.push(card);
    drawn++;
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, library, hand } : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: drawn > 0 ? [`${playerId} draws ${drawn} card(s)`] : log,
  };
}

function adjustLife(state: GameState, playerId: PlayerID, delta: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const currentLife = typeof (player as any).life === 'number' ? (player as any).life : 0;
  const nextLife = currentLife + delta;
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, life: nextLife } : p));

  const verb = delta >= 0 ? 'gains' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} life`);

  return { state: { ...state, players: updatedPlayers as any }, log };
}

function addTokensToBattlefield(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext
): { state: GameState; log: string[] } {
  const log: string[] = [];

  const hintedName = tokenHint
    .replace(/\btoken(s)?\b/gi, '')
    .replace(/\b(creature|artifact|enchantment)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (hintedName) {
    const common = createTokensByName(
      hintedName,
      Math.max(1, amount | 0),
      controllerId,
      state.battlefield || [],
      ctx.sourceId,
      ctx.sourceName
    );
    if (common) {
      const tokensToAdd = common.tokens.map(t => t.token);
      return {
        state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
        log: [...common.log],
      };
    }
  }

  const tokenParse = parseTokenCreationFromText(clauseRaw);
  if (!tokenParse) {
    log.push('Token creation not recognized');
    return { state, log };
  }

  const count = Math.max(1, amount | 0);

  // If token name maps to a common token, use that path.
  const commonParsed = createTokensByName(
    tokenParse.characteristics.name,
    count,
    controllerId,
    state.battlefield || [],
    ctx.sourceId,
    ctx.sourceName
  );
  if (commonParsed) {
    const tokensToAdd = commonParsed.tokens.map(t => t.token);
    return {
      state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
      log: [...commonParsed.log],
    };
  }

  // Otherwise, create from characteristics.
  const created = createTokens(
    {
      characteristics: tokenParse.characteristics,
      count,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
    },
    state.battlefield || []
  );

  const tokensToAdd = created.tokens.map(t => t.token);
  return {
    state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
    log: [...created.log],
  };
}

/**
 * Best-effort executor for Oracle Effect IR.
 *
 * Purposefully conservative:
 * - Only applies steps that can be executed without player choices.
 * - Skips optional ("You may") steps unless allowOptional=true.
 * - Skips targeting-dependent steps for now.
 */
export function applyOracleIRStepsToGameState(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];

  let nextState = state;

  for (const step of steps) {
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
      skippedSteps.push(step);
      log.push(`Skipped optional step: ${step.raw}`);
      continue;
    }

    switch (step.kind) {
      case 'draw': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped draw (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped draw (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = drawCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'gain_life': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped life gain (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped life gain (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = adjustLife(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'lose_life': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped life loss (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped life loss (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = adjustLife(nextState, playerId, -amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'create_token': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped token creation (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length !== 1 || players[0] !== ctx.controllerId) {
          skippedSteps.push(step);
          log.push(`Skipped token creation (unsupported player selector): ${step.raw}`);
          break;
        }

        const r = addTokensToBattlefield(nextState, ctx.controllerId, amount, step.token, step.raw, ctx);
        nextState = r.state;
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      default:
        skippedSteps.push(step);
        log.push(`Skipped unsupported step: ${step.raw}`);
        break;
    }
  }

  return { state: nextState, log, appliedSteps, skippedSteps };
}
