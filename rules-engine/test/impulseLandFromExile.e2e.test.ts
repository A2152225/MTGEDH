import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { RulesEngineAdapter } from '../src/RulesEngineAdapter';

function makeE2EState(overrides: Partial<GameState> = {}): GameState {
  const base: any = {
    id: 'impulse-land-e2e',
    format: 'standard',
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        battlefield: [],
        exile: [],
        commandZone: [],
        counters: {},
        hasLost: false,
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ],
    turnOrder: ['p1'],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 5,
    turnNumber: 5,
    phase: 'precombatMain',
    step: 'main',
    stack: [],
    battlefield: [],
    commandZone: {},
    startingLife: 20,
    allowUndos: false,
    turnTimerEnabled: false,
    turnTimerSeconds: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    spectators: [],
    status: 'inProgress',
  };

  return { ...base, ...overrides } as any;
}

describe('Impulse exile land (E2E)', () => {
  it('allows playing an impulse-exiled land from exile via playLand and consumes permission', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until end of turn, you may play that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeE2EState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 20,
          hand: [],
          library: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest' }],
          graveyard: [],
          battlefield: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      landsPlayedThisTurn: { p1: 0 } as any,
    } as any);

    const exec = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test Source' });

    const p1AfterExec: any = exec.state.players.find(p => p.id === 'p1');
    expect(p1AfterExec.exile).toHaveLength(1);
    expect(p1AfterExec.exile[0].id).toBe('land1');
    expect(p1AfterExec.exile[0].canBePlayedBy).toBe('p1');

    const pfe = (exec.state as any).playableFromExile?.p1;
    expect(pfe).toBeTruthy();
    expect(pfe.land1).toBe(5);

    const adapter = new RulesEngineAdapter();
    adapter.initializeGame(exec.state.id, exec.state);

    const played = adapter.executeAction(exec.state.id, {
      type: 'playLand',
      playerId: 'p1',
      fromZone: 'exile',
      cardId: 'land1',
    });

    const next: any = played.next;
    const p1AfterPlay = next.players.find((p: any) => p.id === 'p1');

    expect(p1AfterPlay.exile.find((c: any) => c.id === 'land1')).toBeUndefined();
    expect(next.battlefield.some((perm: any) => perm.id === 'land1' && perm.controller === 'p1')).toBe(true);
    expect(next.landsPlayedThisTurn?.p1).toBe(1);
    expect(next.playableFromExile?.p1?.land1).toBeUndefined();
  });
});
