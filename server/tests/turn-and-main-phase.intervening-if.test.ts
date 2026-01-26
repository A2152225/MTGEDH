import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: turn + main phase', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_turn_and_main_phase');
  });

  it("evaluates 'if it's your turn' and 'if it's not your turn'", () => {
    const g = createInitialGameState('t_intervening_if_turn_and_main_phase');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // p1 is the active/turn player
    (g.state as any).activePlayer = p1;
    (g.state as any).turnPlayer = p1;

    const yourTurn = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's your turn");
    expect(yourTurn.matched).toBe(true);
    expect(yourTurn.value).toBe(true);

    const notYourTurn = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's not your turn");
    expect(notYourTurn.matched).toBe(true);
    expect(notYourTurn.value).toBe(false);

    const oppTurn = evaluateInterveningIfClauseDetailed(g as any, String(p2), "if it's your turn");
    expect(oppTurn.matched).toBe(true);
    expect(oppTurn.value).toBe(false);

    const oppNotYourTurn = evaluateInterveningIfClauseDetailed(g as any, String(p2), "if it's not your turn");
    expect(oppNotYourTurn.matched).toBe(true);
    expect(oppNotYourTurn.value).toBe(true);
  });

  it("evaluates 'if it's an opponent's turn'", () => {
    const g = createInitialGameState('t_intervening_if_turn_and_main_phase');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Active player is p2
    (g.state as any).activePlayer = p2;

    const p1OppTurn = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's an opponent's turn");
    expect(p1OppTurn.matched).toBe(true);
    expect(p1OppTurn.value).toBe(true);

    const p2OppTurn = evaluateInterveningIfClauseDetailed(g as any, String(p2), "if it's an opponent's turn");
    expect(p2OppTurn.matched).toBe(true);
    expect(p2OppTurn.value).toBe(false);
  });

  it("evaluates 'if it's your main phase' when phase is tracked", () => {
    const g = createInitialGameState('t_intervening_if_turn_and_main_phase');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).activePlayer = p1;

    // Not in main -> false
    (g.state as any).phase = 'combat';
    const notMain = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's your main phase");
    expect(notMain.matched).toBe(true);
    expect(notMain.value).toBe(false);

    // In main -> true
    (g.state as any).phase = 'main';
    const inMain = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's your main phase");
    expect(inMain.matched).toBe(true);
    expect(inMain.value).toBe(true);

    // Opponent controller (not their turn) -> false, even if phase is main
    const opp = evaluateInterveningIfClauseDetailed(g as any, String(p2), "if it's your main phase");
    expect(opp.matched).toBe(true);
    expect(opp.value).toBe(false);
  });

  it('stays conservative (null) when active player/phase are missing', () => {
    const g = createInitialGameState('t_intervening_if_turn_and_main_phase');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    delete (g.state as any).activePlayer;
    delete (g.state as any).turnPlayer;
    delete (g.state as any).phase;

    const yourTurn = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's your turn");
    expect(yourTurn.matched).toBe(true);
    expect(yourTurn.value).toBe(null);

    const oppTurn = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's an opponent's turn");
    expect(oppTurn.matched).toBe(true);
    expect(oppTurn.value).toBe(null);

    const yourMain = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if it's your main phase");
    expect(yourMain.matched).toBe(true);
    expect(yourMain.value).toBe(null);
  });
});
