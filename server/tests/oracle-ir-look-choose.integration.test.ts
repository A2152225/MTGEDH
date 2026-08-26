import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  resumeOracleIRStepWithChoiceFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

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

describe('oracle IR look-search census merges', () => {
  it('parses Memory Deluge into look_select_top with where-X mana spent and random library rest', () => {
    const steps = collectSpellResolutionEffectSteps(
      'Look at the top X cards of your library, where X is the amount of mana spent to cast this spell. Put two of them into your hand and the rest on the bottom of your library in a random order.\nFlashback {5}{U}{U}',
      'Memory Deluge',
    );
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'look_select_top',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        whereX: { kind: 'where', raw: 'the amount of mana spent to cast this spell' },
        choose: { kind: 'number', value: 2 },
        destination: 'hand',
        restDestination: 'library',
        restRandomOrder: true,
      }),
    ]);
  });

  it('parses Genesis Wave into optional look_choose_from_top permanents to battlefield, rest graveyard', () => {
    const steps = collectSpellResolutionEffectSteps(
      'Reveal the top X cards of your library. You may put any number of permanent cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that were not put onto the battlefield into your graveyard.',
      'Genesis Wave',
    );
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'look_choose_from_top',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        selectorText: expect.stringMatching(/any number of permanent cards? with mana value x or less/i),
        destination: 'battlefield',
        reveal: true,
        optional: true,
        nonMatchRest: 'graveyard',
      }),
    ]);
  });

  it('parses Siphon Insight into look_choose_from_top exile from target opponent with play-from-exile grant in raw', () => {
    const steps = collectSpellResolutionEffectSteps(
      "Look at the top two cards of target opponent's library. Exile one of them face down and put the other on the bottom of that library. You may play the exiled card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.\nFlashback {1}{U}{B}",
      'Siphon Insight',
    );
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'look_choose_from_top',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 2 },
        selectorText: 'one of them',
        destination: 'exile',
        nonMatchRest: 'library_bottom',
      }),
    ]);
    expect(String(steps[0]?.raw || '')).toMatch(/you may play the exiled card/i);
    expect(String(steps[0]?.raw || '')).toMatch(/face down/i);
  });
});
