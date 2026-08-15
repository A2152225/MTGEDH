import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';

const HOPE_ORACLE =
  'Lifelink\nAt the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.';
const HOPE_EFFECT = 'Each opponent mills X cards, where X is the amount of life you gained this turn';

describe('Hope Estheim end step mill', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  it('queues on the controller\'s end step only', () => {
    const hope = {
      id: 'hope_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'hope_card',
        name: 'Hope Estheim',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text: HOPE_ORACLE,
      },
    };
    const ctx = {
      state: {
        battlefield: [hope],
        players: [{ id: 'p1' }, { id: 'p2' }],
        lifeGainedThisTurn: {},
      },
    } as any;

    const onYourTurn = getEndStepTriggers(ctx, 'p1');
    const onOpponentTurn = getEndStepTriggers(ctx, 'p2');
    expect(onYourTurn.some((t) => t.permanentId === hope.id)).toBe(true);
    expect(onOpponentTurn.some((t) => t.permanentId === hope.id)).toBe(false);
    expect(onYourTurn.find((t) => t.permanentId === hope.id)?.effect).toMatch(/each opponent mills/i);
  });

  it('mills each opponent for life gained this turn', () => {
    const game = createInitialGameState('hope_estheim_mill');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);

    const makeLibrary = (prefix: string) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: `${prefix}_lib_${i}`,
        name: `${prefix} Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    (game.state as any).players = [
      { id: p1, name: 'P1' },
      { id: p2, name: 'P2' },
      { id: p3, name: 'P3' },
    ];
    (game.state as any).lifeGainedThisTurn = { [p1]: 2 };
    (game.state as any).zones = {
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p2'), libraryCount: 5 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p3'), libraryCount: 5 },
    };

    const ctx = game as any;
    (ctx as any).libraries = new Map([
      [p2, [...(game.state as any).zones[p2].library]],
      [p3, [...(game.state as any).zones[p3].library]],
    ]);

    const trigger = {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
      description: HOPE_EFFECT,
    };

    executeTriggerEffect(
      ctx,
      p1,
      'Hope Estheim',
      trigger.description,
      trigger,
    );

    expect((game.state as any).zones[p2].graveyard).toHaveLength(2);
    expect((game.state as any).zones[p3].graveyard).toHaveLength(2);
    expect((ctx as any).libraries.get(p2)).toHaveLength(3);
    expect((ctx as any).libraries.get(p3)).toHaveLength(3);
  });

  it('mills zero when no life was gained this turn', () => {
    const game = createInitialGameState('hope_estheim_mill_zero');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).lifeGainedThisTurn = { [p1]: 0 };
    (game.state as any).zones = {
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'c1', name: 'Card', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
      },
    };

    const ctx = game as any;
    (ctx as any).libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(ctx, p1, 'Hope Estheim', HOPE_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
    });

    expect((game.state as any).zones[p2].graveyard).toHaveLength(0);
  });

  it('mills zero when life-gained tracker has no controller key', () => {
    const game = createInitialGameState('hope_estheim_mill_missing_key');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).lifeGainedThisTurn = {};
    (game.state as any).zones = {
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'c1', name: 'Card', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
      },
    };

    const ctx = game as any;
    (ctx as any).libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(ctx, p1, 'Hope Estheim', HOPE_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
    });

    expect((game.state as any).zones[p2].graveyard).toHaveLength(0);
    expect((ctx as any).libraries.get(p2)).toHaveLength(1);
  });
});
