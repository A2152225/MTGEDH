import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('Intervening-if: Bargain', () => {
  it('"if it was bargained" returns null when untracked', () => {
    const g: any = { state: {} };
    const source: any = { card: { name: 'Test' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was bargained', source)).toBe(null);
  });

  it('"if it was bargained" respects explicit boolean metadata', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was bargained', { wasBargained: true } as any)).toBe(true);
    // Without an explicit "resolved" marker, false is not replay-stable.
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was bargained', { wasBargained: false } as any)).toBe(null);

    // Deterministic false only when explicitly resolved.
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it was bargained', { bargainResolved: true, wasBargained: false } as any)
    ).toBe(false);
  });

  it('"if it was bargained" can evaluate from refs.stackItem when sourcePermanent is missing', () => {
    const g: any = { state: {} };
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it was bargained',
        undefined as any,
        { stackItem: { bargainResolved: true, wasBargained: false } } as any
      )
    ).toBe(false);
  });

  it('applyEvent(castSpell) persists wasBargained onto the new stack item', () => {
    const g = createInitialGameState('bargain_apply_event');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'bargain_spell_1',
        name: 'Test Bargain Spell',
        type_line: 'Sorcery',
        oracle_text: 'Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)',
        mana_cost: '{1}{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent({
      type: 'castSpell',
      playerId: p1,
      cardId: 'bargain_spell_1',
      targets: [],
      bargainResolved: true,
      wasBargained: true,
    } as any);

    expect(g.state.stack.length).toBe(1);
    const stackItem = g.state.stack[0] as any;
    expect(stackItem.wasBargained).toBe(true);
    expect(stackItem.card?.wasBargained).toBe(true);
    expect(evaluateInterveningIfClause(g as any, p1, 'if it was bargained', stackItem)).toBe(true);
  });

  it('applyEvent(castSpell) can persist explicit wasBargained=false', () => {
    const g = createInitialGameState('bargain_apply_event_false');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'bargain_spell_2',
        name: 'Test Bargain Spell 2',
        type_line: 'Instant',
        oracle_text: 'Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)',
        mana_cost: '{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent({
      type: 'castSpell',
      playerId: p1,
      cardId: 'bargain_spell_2',
      targets: [],
      bargainResolved: true,
      wasBargained: false,
    } as any);

    expect(g.state.stack.length).toBe(1);
    const stackItem = g.state.stack[0] as any;
    expect(stackItem.wasBargained).toBe(false);
    expect(stackItem.card?.wasBargained).toBe(false);
    expect(evaluateInterveningIfClause(g as any, p1, 'if it was bargained', stackItem)).toBe(false);
  });
});
