import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { nextTurn, nextStep, shouldPerformDrawStepTurnAction } from '../src/state/modules/turn.js';
import { tryAutoStartGameFromPreGame } from '../src/socket/pregame-auto-start.js';
import type { PlayerID } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

function sampleDeck(prefix: string) {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `${prefix}_card_${i}`,
    name: `${prefix} Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
}

function keepAllHands(game: ReturnType<typeof createInitialGameState>, playerIds: PlayerID[]) {
  const state = game.state as any;
  state.mulliganState = state.mulliganState || {};
  for (const pid of playerIds) {
    state.mulliganState[pid] = { hasKeptHand: true, mulligansTaken: 0 };
  }
}

describe('pre-game start and first draw', () => {
  it('nextTurn from pre_game keeps the randomized starting player', () => {
    const g = createInitialGameState('pregame_random_start');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent({ type: 'join', playerId: p3, name: 'P3' });

    g.importDeckResolved(p1, sampleDeck('p1'));
    g.importDeckResolved(p2, sampleDeck('p2'));
    g.importDeckResolved(p3, sampleDeck('p3'));
    keepAllHands(g, [p1, p2, p3]);

    (g.state as any).phase = 'pre_game';
    (g.state as any).step = 'PRE_GAME';
    (g.state as any).turnPlayer = p2;
    (g.state as any).startingPlayerId = p2;

    nextTurn(g as any);

    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
    expect(g.state.turnPlayer).toBe(p2);
    expect((g.state as any).turnNumber).toBe(1);
  });

  it('multiplayer starting player draws on turn 1; two-player starting player skips', () => {
    const g = createInitialGameState('pregame_draw_rules');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent({ type: 'join', playerId: p3, name: 'P3' });

    g.importDeckResolved(p1, sampleDeck('p1'));
    g.importDeckResolved(p2, sampleDeck('p2'));
    g.importDeckResolved(p3, sampleDeck('p3'));

    (g.state as any).turnNumber = 1;
    (g.state as any).startingPlayerId = p1;

    expect(shouldPerformDrawStepTurnAction(g as any, p1)).toBe(true);

    const g2 = createInitialGameState('pregame_draw_rules_2p');
    g2.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g2.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (g2.state as any).turnNumber = 1;
    (g2.state as any).startingPlayerId = p1;

    expect(shouldPerformDrawStepTurnAction(g2 as any, p1)).toBe(false);
    expect(shouldPerformDrawStepTurnAction(g2 as any, p2)).toBe(true);
  });

  it('draw step advances hand size for multiplayer first turn', () => {
    const g = createInitialGameState('pregame_mp_first_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent({ type: 'join', playerId: p3, name: 'P3' });

    g.importDeckResolved(p1, sampleDeck('p1'));
    g.importDeckResolved(p2, sampleDeck('p2'));
    g.importDeckResolved(p3, sampleDeck('p3'));

    (g.state as any).phase = 'pre_game';
    (g.state as any).step = 'PRE_GAME';
    (g.state as any).turnPlayer = p1;
    (g.state as any).startingPlayerId = p1;
    keepAllHands(g, [p1, p2, p3]);

    nextTurn(g as any);
    nextStep(g as any); // UNTAP -> UPKEEP
    const handBeforeDraw = g.state.zones?.[p1]?.handCount ?? 0;
    nextStep(g as any); // UPKEEP -> DRAW (draws for 3+ players on turn 1)

    expect(g.state.step).toBe(GameStep.DRAW);
    const handAfterDraw = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handAfterDraw).toBe(handBeforeDraw + 1);
  });

  it('auto-starts via tryAutoStartGameFromPreGame when all hands are kept', async () => {
    const g = createInitialGameState('pregame_auto_start');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    g.importDeckResolved(p1, sampleDeck('p1'));
    g.importDeckResolved(p2, sampleDeck('p2'));
    keepAllHands(g, [p1, p2]);

    (g.state as any).phase = 'pre_game';
    (g.state as any).step = 'PRE_GAME';
    (g.state as any).turnPlayer = p1;
    (g.state as any).startingPlayerId = p1;

    const io = { to: () => ({ emit: () => undefined }) } as any;
    const started = await tryAutoStartGameFromPreGame(io, g, 'pregame_auto_start', 'test');

    expect(started).toBe(true);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect([p1, p2]).toContain(g.state.turnPlayer);
    expect((g.state as any).startingPlayerId).toBe(g.state.turnPlayer);
    expect((g.state.players as any[]).map((p: any) => p.id).sort()).toEqual([p1, p2].sort());
  });
});
