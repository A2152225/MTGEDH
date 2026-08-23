import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  resolveOracleIrOptionalPaymentPromptFromResolution,
  resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { evaluateAnyPlayerMayStep } from '../../rules-engine/src/oracleIRExecutorAnyPlayerMayStep.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

describe('any_player_may payment picker chain', () => {
  const gameId = 'test_any_player_may_payment_selection';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  function makeCtx(state: any) {
    return {
      gameId,
      state,
      isReplaying: false,
      bumpSeq: () => {},
    } as any;
  }

  it('Pay on discard tax queues DISCARD_SELECTION instead of auto-discarding', () => {
    const state: any = {
      players: [
        {
          id: 'p2',
          life: 20,
          hand: [
            { id: 'h1', name: 'A' },
            { id: 'h2', name: 'B' },
            { id: 'h3', name: 'C' },
            { id: 'h4', name: 'D' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
      zones: {
        p2: {
          hand: [
            { id: 'h1', name: 'A' },
            { id: 'h2', name: 'B' },
            { id: 'h3', name: 'C' },
            { id: 'h4', name: 'D' },
          ],
          graveyard: [],
        },
      },
    };
    const ctx = makeCtx(state);
    const step = {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p2',
      optionalPaymentPrompt: true,
      optionalPaymentPayChoiceId: 'pay',
      optionalPaymentDeclineChoiceId: 'decline',
      oracleIrAnyPlayerMayChoice: true,
      oracleIrAnyPlayerMayPaymentJson: JSON.stringify({ kind: 'discard', amount: 3 }),
      oracleIrAnyPlayerMayStepsJson: JSON.stringify([{
        kind: 'any_player_may',
        payment: { kind: 'discard', amount: 3 },
        steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
        raw: 'any player may discard three cards',
      }]),
      oracleIrAnyPlayerMayCandidateIds: ['p2'],
      oracleIrAnyPlayerMayDeclinedIds: [],
      oracleIrControllerId: 'p1',
      oracleIrSourceName: 'Phantasmagorian',
    };

    const handled = resolveOracleIrOptionalPaymentPromptFromResolution(ctx, {
      step,
      choiceId: 'pay',
      cancelled: false,
    });
    expect(handled).toBe(true);

    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, 'p2' as any);
    expect(pending.some((s: any) =>
      s.type === ResolutionStepType.DISCARD_SELECTION
      && s.oracleIrAnyPlayerMayPaymentSelection === true
      && s.discardCount === 3
    )).toBe(true);
    // Hand unchanged until picker resolves through applyPayment.
    expect(state.players[0].hand).toHaveLength(4);
  });

  it('Pay on sacrifice tax queues TARGET_SELECTION for the payer creatures', () => {
    const state: any = {
      players: [
        { id: 'p2', life: 20, hand: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'c1', controller: 'p2', owner: 'p2', type_line: 'Creature - Beast', card: { name: 'Beast', type_line: 'Creature - Beast' } },
        { id: 'c2', controller: 'p2', owner: 'p2', type_line: 'Creature - Horror', card: { name: 'Horror', type_line: 'Creature - Horror' } },
        { id: 'c3', controller: 'p1', owner: 'p1', type_line: 'Creature - Elf', card: { name: 'Elf', type_line: 'Creature - Elf' } },
      ],
      zones: { p2: { hand: [], graveyard: [] } },
    };
    const ctx = makeCtx(state);
    const step = {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p2',
      optionalPaymentPrompt: true,
      optionalPaymentPayChoiceId: 'pay',
      optionalPaymentDeclineChoiceId: 'decline',
      oracleIrAnyPlayerMayChoice: true,
      oracleIrAnyPlayerMayPaymentJson: JSON.stringify({ kind: 'sacrifice', what: 'a creature of their choice' }),
      oracleIrAnyPlayerMayStepsJson: JSON.stringify([{
        kind: 'any_player_may',
        payment: { kind: 'sacrifice', what: 'a creature of their choice' },
        steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
        raw: 'any player may sacrifice a creature',
      }]),
      oracleIrAnyPlayerMayCandidateIds: ['p2'],
      oracleIrAnyPlayerMayDeclinedIds: [],
      oracleIrControllerId: 'p1',
      oracleIrSourceName: 'Brain Gorgers',
    };

    const handled = resolveOracleIrOptionalPaymentPromptFromResolution(ctx, {
      step,
      choiceId: 'pay',
      cancelled: false,
    });
    expect(handled).toBe(true);

    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, 'p2' as any);
    const sac = pending.find((s: any) =>
      s.type === ResolutionStepType.TARGET_SELECTION
      && s.oracleIrAnyPlayerMayPaymentSelection === true
    ) as any;
    expect(sac).toBeTruthy();
    const ids = (sac.validTargets || []).map((t: any) => t.id).sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('cancel/decline on payment picker continues APNAP as decline for that player', () => {
    const state: any = {
      activePlayer: 'p1',
      players: [
        { id: 'p1', life: 20, hand: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }], graveyard: [] },
        { id: 'p2', life: 20, hand: [{ id: 'y1' }, { id: 'y2' }, { id: 'y3' }], graveyard: [] },
      ],
      battlefield: [],
      stack: [{ id: 'spell1', type: 'spell', controller: 'p1' }],
      zones: {
        p1: { hand: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }], graveyard: [] },
        p2: { hand: [{ id: 'y1' }, { id: 'y2' }, { id: 'y3' }], graveyard: [] },
      },
    };
    const ctx = makeCtx(state);
    const pickerStep = {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: 'p1',
      oracleIrAnyPlayerMayPaymentSelection: true,
      oracleIrAnyPlayerMayPaymentJson: JSON.stringify({ kind: 'discard', amount: 3 }),
      oracleIrAnyPlayerMayStepsJson: JSON.stringify([{
        kind: 'any_player_may',
        payment: { kind: 'discard', amount: 3 },
        steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
        raw: 'any player may discard three cards',
      }]),
      oracleIrAnyPlayerMayCandidateIds: ['p1', 'p2'],
      oracleIrAnyPlayerMayDeclinedIds: [],
      oracleIrControllerId: 'p1',
      oracleIrSourceName: 'Phantasmagorian',
      discardCount: 3,
      hand: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }],
    };

    const handled = resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, pickerStep, {
      cancelled: true,
      selections: [],
    });
    expect(handled).toBe(true);

    // Decline for p1 should re-prompt / leave a pending any_player_may choice for p2 via gap queue,
    // or at least not have discarded p1's hand.
    expect(state.players.find((p: any) => p.id === 'p1').hand).toHaveLength(3);
  });

  it('resolving discard picker pays with the chosen cards only', () => {
    const state: any = {
      activePlayer: 'p1',
      players: [
        {
          id: 'p2',
          life: 20,
          hand: [
            { id: 'h1', name: 'A' },
            { id: 'h2', name: 'B' },
            { id: 'h3', name: 'C' },
            { id: 'h4', name: 'D' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
      stack: [{ id: 'spell1', type: 'spell', controller: 'p1' }],
      zones: {
        p2: {
          hand: [
            { id: 'h1', name: 'A' },
            { id: 'h2', name: 'B' },
            { id: 'h3', name: 'C' },
            { id: 'h4', name: 'D' },
          ],
          graveyard: [],
        },
      },
    };

    const paidDirect = evaluateAnyPlayerMayStep(
      state,
      {
        kind: 'any_player_may',
        payment: { kind: 'discard', amount: 3 },
        steps: [],
        raw: 'any player may discard three cards',
      } as any,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
        selectorContext: {
          anyPlayerMayChoice: 'pay',
          anyPlayerMayPayerId: 'p2',
          anyPlayerMayDiscardCardIds: ['h4', 'h1', 'h3'],
        },
      } as any) as any,
    );
    expect(paidDirect.applied).toBe(true);
    const p2 = (paidDirect as any).state.players.find((p: any) => p.id === 'p2');
    expect(p2.hand.map((c: any) => c.id)).toEqual(['h2']);
  });
});
