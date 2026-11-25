import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  parseExtendedDiscardCost,
  stripExtendedDiscardCostClauses,
  substituteActivationX,
} from '../src/socket/interaction-handlers/activationCostXAndDiscardClauses.js';
import type { PlayerID } from '../../shared/src';

describe('outcome sweep round 3: activation costs', () => {
  it('substitutes the announced X into cost and effect text', () => {
    expect(substituteActivationX('{x}{u}, {t}, discard two cards', 2)).toBe('{2}{u}, {t}, discard two cards');
    expect(substituteActivationX('return X target creatures', 1)).toBe('return 1 target creatures');
    expect(substituteActivationX('{X}', undefined)).toBe('{X}');
  });

  it('parses and strips "discard your hand" and "discard a card with mana value X"', () => {
    expect(parseExtendedDiscardCost('{R}, Discard your hand, Sacrifice this creature')).toEqual({ kind: 'hand' });
    expect(parseExtendedDiscardCost('{X}, Discard a card with mana value X')).toEqual({ kind: 'manaValue', countWord: 'a', typed: undefined, manaValue: 'x' });
    expect(parseExtendedDiscardCost('{2}, discard a card with mana value 3')).toMatchObject({ kind: 'manaValue', manaValue: 3 });
    expect(parseExtendedDiscardCost('Discard a card')).toBeNull();
    expect(stripExtendedDiscardCostClauses('{1}, discard a card with mana value 1').replace(/\{[^}]+\}/g, ' ').replace(/[\s,]+/g, ' ').trim()).toBe('');
    expect(stripExtendedDiscardCostClauses('{R}, Discard your hand, Sacrifice this creature')).not.toMatch(/discard/i);
  });

  it('defers a flagged tutor search to resolution (Navigation Orb split search)', () => {
    const gameId = 't_round3_deferred_tutor';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.importDeckResolved(p1, [
      { id: 'plains_1', name: 'Plains', type_line: 'Basic Land \u2014 Plains', oracle_text: '({T}: Add {W}.)' },
      { id: 'gate_1', name: 'Azorius Guildgate', type_line: 'Land \u2014 Gate', oracle_text: '' },
      { id: 'bear_1', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '' },
    ] as any);
    (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 } };
    (game.state as any).battlefield = [{
      id: 'orb_1', controller: p1, owner: p1, tapped: false, counters: {},
      card: {
        id: 'orb_card_1', name: 'Navigation Orb', type_line: 'Artifact', zone: 'battlefield',
        oracle_text: '{2}, {T}, Sacrifice this artifact: Search your library for up to two basic land cards and/or Gate cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      },
    }];

    game.applyEvent({
      type: 'activateTutorAbility', playerId: p1, permanentId: 'orb_1', abilityId: 'orb_1-ability-0',
      cardName: 'Navigation Orb', stackId: 'orb_stack_1', searchOnResolution: true,
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.searchOnResolution).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);

    (game as any).resolveTopOfStack();
    const steps = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(steps).toHaveLength(1);
    expect(String(steps[0]?.type)).toBe('library_search');
    expect(steps[0]?.splitDestination).toBe(true);
    expect(steps[0]?.persistLibrarySearchResolve).toBe(true);
    expect(steps[0]?.maxSelections).toBe(2);
    expect((steps[0]?.availableCards || []).map((card: any) => card.id).sort()).toEqual(['gate_1', 'plains_1']);
  });
});
