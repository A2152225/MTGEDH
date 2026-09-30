import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const CHARBELCHER_EFFECT =
  'Reveal cards from the top of your library until you reveal a land card. Goblin Charbelcher deals damage equal to the number of nonland cards revealed this way to any target. If the revealed land card was a Mountain, Goblin Charbelcher deals double that damage instead. Put the revealed cards on the bottom of your library in any order.';

describe('Goblin Charbelcher live flow: the player orders the revealed cards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deals the damage, prompts BOTTOM_ORDER for the revealed cards, and applies the chosen order', () => {
    const gameId = 'charbelcher_bottom_order';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
      { id: 'card_shock', name: 'Shock', type_line: 'Instant' },
      { id: 'card_cancel', name: 'Cancel', type_line: 'Instant' },
      { id: 'card_swamp', name: 'Swamp', type_line: 'Basic Land - Swamp' },
      { id: 'card_untouched', name: 'Untouched', type_line: 'Sorcery' },
    ];
    player.hand = [];
    player.graveyard = [];
    (game.state as any).life = { ...(game.state as any).life, [p1]: 40, [p2]: 40 };
    (game.state as any).battlefield = [
      { id: 'belcher', owner: p1, controller: p1, card: { id: 'card_belcher', name: 'Goblin Charbelcher', type_line: 'Artifact' } },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(CHARBELCHER_EFFECT, 'Goblin Charbelcher'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'belcher',
        sourceName: 'Goblin Charbelcher',
        sourceObjectType: 'permanent',
        selectorContext: { targetPlayerId: p2 },
      } as any),
      { allowOptional: true },
      { controller: p1 },
    );

    const bottomStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.BOTTOM_ORDER);
    expect(bottomStep).toBeTruthy();
    const promptCards = ((bottomStep as any)?.cards || []) as Array<{ id?: string; name?: string }>;
    expect(promptCards.map((card) => card.id).sort()).toEqual(['card_bolt', 'card_cancel', 'card_shock', 'card_swamp']);

    const completed = ResolutionQueueManager.completeStep(gameId, String(bottomStep!.id), {
      stepId: String(bottomStep!.id),
      playerId: p1,
      selections: ['card_swamp', 'card_cancel', 'card_shock', 'card_bolt'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, completed, completed!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completed);

    const names = ((game.state as any).players.find((entry: any) => entry.id === p1)?.library || [])
      .map((card: any) => card.name);
    expect(names).toEqual(['Untouched', 'Swamp', 'Cancel', 'Shock', 'Lightning Bolt']);
    expect((game.state as any).life?.[p2]).toBe(37);
    ResolutionQueueManager.removeQueue(gameId);
  });
});