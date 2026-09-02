import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { processOpponentSpellCastTriggersForCast } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerProcessing.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const LAVINIA_ORACLE =
  "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls.\nWhenever an opponent casts a spell, if no mana was spent to cast it, counter that spell.";

const VEXING_BAUBLE_ORACLE =
  'Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.\n{1}, {T}, Sacrifice this artifact: Draw a card.';

function makeOpponentCastGame(opts: {
  controllerId: string;
  casterId: string;
  manaSpentTotal: number;
  oracleText: string;
  cardName: string;
}) {
  return {
    seq: 1,
    state: {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'perm_watch',
          controller: opts.controllerId,
          card: {
            id: 'watch_card',
            name: opts.cardName,
            type_line: opts.cardName.includes('Lavinia') ? 'Legendary Creature — Human Soldier' : 'Artifact',
            oracle_text: opts.oracleText,
          },
        },
      ],
      stack: [
        {
          id: 'stack_spell',
          type: 'spell',
          controller: opts.casterId,
          manaSpentTotal: opts.manaSpentTotal,
          card: { id: 'spell_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
        },
      ],
    },
  };
}

describe('Zero-mana-spent opponent-cast counter', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('queues Lavinia when an opponent spends no mana, and stamps the triggering spell', () => {
    const game = makeOpponentCastGame({
      controllerId: 'p1',
      casterId: 'p2',
      manaSpentTotal: 0,
      oracleText: LAVINIA_ORACLE,
      cardName: 'Lavinia, Azorius Renegade',
    });
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p2',
      { id: 'spell_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
      'hand',
      'stack_spell',
    );
    const trigger = (game.state.stack || []).find((item: any) => item?.type === 'triggered_ability');
    expect(trigger?.sourceName).toBe('Lavinia, Azorius Renegade');
    expect(trigger?.triggeringStackItemId).toBe('stack_spell');
    expect(String(trigger?.effect || '')).toMatch(/counter that spell/i);
  });

  it('does not queue Lavinia when the opponent paid mana', () => {
    const game = makeOpponentCastGame({
      controllerId: 'p1',
      casterId: 'p2',
      manaSpentTotal: 2,
      oracleText: LAVINIA_ORACLE,
      cardName: 'Lavinia, Azorius Renegade',
    });
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p2',
      { id: 'spell_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
      'hand',
      'stack_spell',
    );
    expect((game.state.stack || []).some((item: any) => item?.type === 'triggered_ability')).toBe(false);
  });

  it('does not queue Lavinia when the controller casts', () => {
    const game = makeOpponentCastGame({
      controllerId: 'p1',
      casterId: 'p1',
      manaSpentTotal: 0,
      oracleText: LAVINIA_ORACLE,
      cardName: 'Lavinia, Azorius Renegade',
    });
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p1',
      { id: 'spell_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
      'hand',
      'stack_spell',
    );
    expect((game.state.stack || []).some((item: any) => item?.type === 'triggered_ability')).toBe(false);
  });

  it('queues Vexing Bauble for any player’s unpaid spell, including the controller', () => {
    const game = makeOpponentCastGame({
      controllerId: 'p1',
      casterId: 'p1',
      manaSpentTotal: 0,
      oracleText: VEXING_BAUBLE_ORACLE,
      cardName: 'Vexing Bauble',
    });
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p1',
      { id: 'spell_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
      'hand',
      'stack_spell',
    );
    const trigger = (game.state.stack || []).find((item: any) => item?.type === 'triggered_ability');
    expect(trigger?.sourceName).toBe('Vexing Bauble');
    expect(trigger?.triggeringStackItemId).toBe('stack_spell');
  });

  it('counters the triggering stack spell via Oracle IR', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'zero_mana_spent_counter_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).stack = [
      {
        id: 'stack_free',
        type: 'spell',
        controller: p2,
        manaSpentTotal: 0,
        card: { id: 'vision_1', name: 'Ancestral Vision', type_line: 'Sorcery' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Lavinia, Azorius Renegade',
      effectText: 'counter that spell',
      triggerItem: {
        id: 'trig_lavinia_1',
        source: 'lavinia_1',
        triggeringStackItemId: 'stack_free',
      },
    });

    expect(outcome.handled).toBe(true);
    expect((game.state as any).stack.some((item: any) => item?.id === 'stack_free')).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
