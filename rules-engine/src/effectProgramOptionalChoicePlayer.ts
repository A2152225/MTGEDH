import type { GameState } from '../../shared/src';
import { ChoiceEventType } from './choiceEventsTypes';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

/**
 * Optional ("may") Oracle steps are compiled into a yes/no OPTION_CHOICE before the
 * guarded step. The compiler only knows the program controller, but the player who
 * decides is the step's actor ("they may pay {2}", "that player may draw a card").
 * The actor is recorded in the payload as `optionalStepWho` and resolved here at
 * runtime, once trigger/target bindings are known.
 */
export function readOptionalStepChoiceWho(oracleStep: unknown): unknown | undefined {
  const who = (oracleStep as any)?.who;
  if (!who || typeof who !== 'object') return undefined;
  const kind = String((who as any).kind || '');
  if (!kind || kind === 'you') return undefined;
  return who;
}

export function resolveOptionalStepChoosingPlayerId(
  state: GameState,
  request: { readonly type: string; readonly playerId?: unknown; readonly payload?: unknown },
  getExecutionContext: () => OracleIRExecutionContext,
): string | undefined {
  if (String(request.type) !== ChoiceEventType.OPTION_CHOICE) return undefined;
  const who = (request.payload as any)?.optionalStepWho;
  if (!who) return undefined;
  const players = resolvePlayers(state, who, getExecutionContext()).map(id => String(id || '')).filter(Boolean);
  // Only redirect when the actor is a single, concrete player; group actors
  // ("each opponent may ...") keep the existing controller prompt.
  if (players.length !== 1) return undefined;
  return players[0] === String(request.playerId || '') ? undefined : players[0];
}