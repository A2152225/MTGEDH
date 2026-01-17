import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';

describe('Intervening-if ETB triggers', () => {
  it('does not put Acclaimed Contender ETB trigger on the stack when "another Knight" condition is false', () => {
    const g = createInitialGameState('t_intervening_if_contender_false');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library. You may reveal a Knight, Aura, Equipment, or legendary artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
      },
      tapped: false,
    };

    // Put the creature on the battlefield (ETB triggers check after it has entered).
    (g.state.battlefield as any).push(contender);

    // Trigger ETB processing.
    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stack = (g.state.stack || []) as any[];
    const trigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender');
    expect(trigger).toBeUndefined();
  });

  it('does not retroactively trigger if the intervening-if condition becomes true after ETB', () => {
    const g = createInitialGameState('t_intervening_if_contender_false_then_true');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library.',
      },
      tapped: false,
    };

    // ETB with no "another Knight" => no trigger.
    (g.state.battlefield as any).push(contender);
    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stackAfterEtb = (g.state.stack || []) as any[];
    expect(stackAfterEtb.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender')).toBe(
      false
    );

    // If we gain "another Knight" later, the already-missed intervening-if trigger does not retroactively appear.
    const otherKnight = {
      id: 'knight_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'knight_card',
        name: 'Silver Knight',
        type_line: 'Creature — Human Knight',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(otherKnight);

    const stackAfterGainingKnight = (g.state.stack || []) as any[];
    expect(
      stackAfterGainingKnight.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender')
    ).toBe(false);
  });

  it('puts Acclaimed Contender ETB trigger on the stack when "another Knight" condition is true', () => {
    const g = createInitialGameState('t_intervening_if_contender_true');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const otherKnight = {
      id: 'knight_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'knight_card',
        name: 'Silver Knight',
        type_line: 'Creature — Human Knight',
        oracle_text: '',
      },
      tapped: false,
    };

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library.',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(otherKnight);
    (g.state.battlefield as any).push(contender);

    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stack = (g.state.stack || []) as any[];
    const trigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender');
    expect(trigger).toBeDefined();
    expect(String(trigger?.description || '')).toMatch(/if you control another knight/i);
  });
});
