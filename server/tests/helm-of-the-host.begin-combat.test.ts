import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { resolveTopOfStack } from '../src/state/modules/stack';
import type { PlayerID } from '../../shared/src';

function setupToMain1(g: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  g.applyEvent({ type: 'nextTurn' });

  const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
    id: `card_${i}`,
    name: `Test Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  g.importDeckResolved(p1, sampleDeck);
  g.importDeckResolved(p2, sampleDeck.map(card => ({ ...card, id: `p2_${card.id}` })));

  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
}

describe('Helm of the Host beginning-of-combat trigger', () => {
  it('creates a nonlegendary token copy with haste', () => {
    const g = createInitialGameState('helm_of_the_host_begin_combat');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const equippedCreatureId = 'legendary-merfolk';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        attachedEquipment: ['helm_1'],
        isEquipped: true,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'legendary_merfolk_card',
          name: 'Legendary Merfolk Test',
          type_line: 'Legendary Creature — Merfolk Wizard',
          oracle_text: 'Ward {1}',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'helm_1',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state as any).stack || [];
    expect(stack.some((item: any) => item.type === 'triggered_ability' && item.source === 'helm_1')).toBe(true);

    resolveTopOfStack(g as any);

    const tokenCopies = (g.state.battlefield as any[]).filter(
      permanent => permanent.isToken && permanent.card?.name === 'Legendary Merfolk Test'
    );

    expect(tokenCopies).toHaveLength(1);

    const tokenCopy = tokenCopies[0] as any;
    expect(String(tokenCopy.card?.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(String(tokenCopy.card?.oracle_text || '').toLowerCase()).toContain('haste');
    expect(tokenCopy.summoningSickness).toBe(false);
  });
});