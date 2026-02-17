import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { TriggerEvent } from '../src/triggeredAbilities';
import {
  processTriggers,
  processTriggersAutoOracle,
  checkCombatDamageToPlayerTriggers,
  checkDrawTriggers,
} from '../src/actions/triggersHandler';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'p1c1' }, { id: 'p1c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [{ id: 'p2c1' }, { id: 'p2c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p3',
        name: 'P3',
        seat: 2,
        life: 40,
        library: [{ id: 'p3c1' }, { id: 'p3c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: 'pre_game' as any,
    active: true,
    activePlayerIndex: 0 as any,
    ...overrides,
  } as any;
}

describe('triggersHandler Oracle automation', () => {
  it('keeps legacy behavior when autoExecuteOracle is disabled', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a1',
        sourceId: 'src1',
        sourceName: 'Test Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target opponent loses 1 life.',
      } as any,
    ];

    const result = processTriggers(start, TriggerEvent.ATTACKS, abilities, { targetOpponentId: 'p3' });
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect(p3.life).toBe(40);
    expect((result.state.stack || []).length).toBe(1);
  });

  it('auto-executes target_opponent effect when autoExecuteOracle is enabled', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a2',
        sourceId: 'src2',
        sourceName: 'Test Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target opponent loses 1 life.',
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      { targetOpponentId: 'p3' },
      { autoExecuteOracle: true }
    );
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(result.oracleExecutions).toBe(1);
    expect(result.oracleStepsSkipped).toBe(0);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
    expect((result.state.stack || []).length).toBe(1);
  });

  it('reports skipped oracle steps for unsupported deterministic trigger execution', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a2-skip',
        sourceId: 'src2-skip',
        sourceName: 'Skip Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target player loses 1 life.',
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      undefined,
      { autoExecuteOracle: true }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleExecutions).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect((result.oracleStepsSkipped || 0) > 0).toBe(true);
    expect(p1.life).toBe(40);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(40);
    expect(result.logs.some(x => x.includes('[triggers] Oracle auto-execution: executions=1'))).toBe(true);
  });

  it('processTriggersAutoOracle resolves relational each_of_those_opponents from event data', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a3',
        sourceId: 'breeches-1',
        sourceName: 'Breeches, Brazen Plunderer',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
        effect:
          "Exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      } as any,
    ];

    const result = processTriggersAutoOracle(start, TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER, abilities, {
      opponentsDealtDamageIds: ['p2'],
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
    expect(p3.exile || []).toHaveLength(0);
  });

  it('processTriggers uses resolutionEventData to recheck intervening-if during auto Oracle execution', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a4',
        sourceId: 'if-src',
        sourceName: 'If Source',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Draw a card.',
        interveningIfClause: 'you control an artifact',
        hasInterveningIf: true,
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      {
        sourceControllerId: 'p1',
        battlefield: [{ id: 'a', controllerId: 'p1', types: ['Artifact'] }],
      },
      {
        autoExecuteOracle: true,
        resolutionEventData: {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'c', controllerId: 'p1', types: ['Creature'] }],
        },
      }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(result.triggersAdded).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect(p1.hand || []).toHaveLength(0);
    expect(result.logs.some(x => x.includes('intervening-if false'))).toBe(true);
  });

  it('checkCombatDamageToPlayerTriggers derives opponentsDealtDamageIds from assignments', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'breeches-1',
          controller: 'p1',
          card: {
            name: 'Breeches, Brazen Plunderer',
            oracle_text:
              'Whenever this creature deals combat damage to a player, each of those opponents loses 1 life.',
          },
        } as any,
      ],
    });

    const result = checkCombatDamageToPlayerTriggers(start, 'p1', [
      { attackerId: 'a1', defendingPlayerId: 'p2', damage: 2 },
      { attackerId: 'a2', defendingPlayerId: 'p3', damage: 3 },
    ]);

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(39);
  });

  it('checkDrawTriggers binds "that player" to the drawing opponent in opponent-draw context', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'draw-trigger-1',
          controller: 'p1',
          card: {
            name: 'Draw Trigger Source',
            oracle_text: 'Whenever an opponent draws a card, that player loses 1 life.',
          },
        } as any,
      ],
    });

    const result = checkDrawTriggers(start, 'p2', true);

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p1.life).toBe(40);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(40);
  });
});
