import type { GameState } from '../../shared/src';
import type { EngineResult } from './index';

type ActionExecutor = () => EngineResult<GameState>;

export interface RulesEngineAdapterActionDispatchHandlers {
  readonly passPriority: ActionExecutor;
  readonly castSpell: ActionExecutor;
  readonly playLand: ActionExecutor;
  readonly tapForMana: ActionExecutor;
  readonly activateAbility: ActionExecutor;
  readonly declareAttackers: ActionExecutor;
  readonly declareBlockers: ActionExecutor;
  readonly resolveStack: ActionExecutor;
  readonly advanceGame: ActionExecutor;
  readonly sacrifice: ActionExecutor;
  readonly searchLibrary: ActionExecutor;
  readonly payLife: ActionExecutor;
  readonly activateFetchland: ActionExecutor;
  readonly dealCombatDamage: ActionExecutor;
  readonly initializeGame: ActionExecutor;
  readonly drawInitialHand: ActionExecutor;
  readonly mulligan: ActionExecutor;
  readonly completeMulligan: ActionExecutor;
}

export function dispatchRulesEngineAction(args: {
  currentState: GameState;
  action: any;
  handlers: RulesEngineAdapterActionDispatchHandlers;
}): EngineResult<GameState> {
  const { currentState, action, handlers } = args;

  switch (action.type) {
    case 'passPriority':
      return handlers.passPriority();
    case 'castSpell':
      return handlers.castSpell();
    case 'playLand':
      return handlers.playLand();
    case 'tapForMana':
      return handlers.tapForMana();
    case 'activateAbility':
      return handlers.activateAbility();
    case 'declareAttackers':
      return handlers.declareAttackers();
    case 'declareBlockers':
      return handlers.declareBlockers();
    case 'resolveStack':
      return handlers.resolveStack();
    case 'advanceTurn':
    case 'advanceGame':
      return handlers.advanceGame();
    case 'sacrifice':
      return handlers.sacrifice();
    case 'searchLibrary':
      return handlers.searchLibrary();
    case 'payLife':
      return handlers.payLife();
    case 'activateFetchland':
      return handlers.activateFetchland();
    case 'dealCombatDamage':
      return handlers.dealCombatDamage();
    case 'initializeGame':
      return handlers.initializeGame();
    case 'drawInitialHand':
      return handlers.drawInitialHand();
    case 'mulligan':
      return handlers.mulligan();
    case 'completeMulligan':
      return handlers.completeMulligan();
    default:
      return { next: currentState, log: ['Unknown action type'] };
  }
}
