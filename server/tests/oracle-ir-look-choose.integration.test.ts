import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  resumeOracleIRStepWithChoiceFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR look-choose queue adapter', () => {
  it('queues library search when optional look-choose has matching cards', () => {
    const gameId = 'oracle_ir_look_choose_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: 'top-2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'library' },
      { id: 'top-3', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
      { id: 'top-4', name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'library' },
      { id: 'top-5', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
    ];

    (game as any).libraries.set(p1, library.map((card) => ({ ...card })));
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = library.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const step = {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 5 },
      selectorText: 'creature card',
      destination: 'hand',
      optional: true,
      restOrder: 'any',
      raw: 'Look at the top five cards of your library. You may put a creature card from among them into your hand. Put the rest on the bottom of your library in any order.',
    } as any;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'genesis-wave-1',
      sourceName: 'Genesis Wave',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, [step], irCtx, { allowOptional: false }, { controller: p1 });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const lookStep = steps.find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH);

    expect(lookStep).toBeTruthy();
    expect((lookStep as any)?.availableCards).toHaveLength(5);
    expect((lookStep as any)?.shuffleAfter).toBe(false);
    expect((lookStep as any)?.remainderDestination).toBe('bottom');
    expect(String((lookStep as any)?.oracleIrChoiceStepJson || '')).toContain('look_choose_from_top');

    const resumed = resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller: p1,
      sourceId: 'genesis-wave-1',
      sourceName: 'Genesis Wave',
      steps: [step],
      chosenObjectIds: ['top-2'],
    });

    expect(resumed?.appliedSteps.map((entry) => entry.kind)).toEqual(['look_choose_from_top']);
    const updatedPlayer = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((updatedPlayer.hand || []).map((card: any) => card.id)).toEqual(['top-2']);
    expect((updatedPlayer.library || []).map((card: any) => card.id)).toEqual(['top-1', 'top-3', 'top-4', 'top-5']);
  });
});
