import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

const BAUBLE_TEXT = '{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.';

function seed(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.importDeckResolved(p1, [
    { id: 'forest_1', name: 'Forest', type_line: 'Basic Land \u2014 Forest', oracle_text: '({T}: Add {G}.)' },
    { id: 'bear_1', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '' },
  ] as any);
  (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 } };
  (game.state as any).energy = { [p1]: 3 };
  (game.state as any).battlefield = [{
    id: 'bauble_1', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'bauble_card_1', name: 'Wayfarer\u2019s Bauble', type_line: 'Artifact', zone: 'battlefield', oracle_text: BAUBLE_TEXT },
  }];
  return { game, p1 };
}

describe('outcome sweep round 4: resolve-time tutor search and energy replay', () => {
  it('replays an AI legacy tutor activation as a stack item that searches on resolution', () => {
    const gameId = 't_round4_ai_legacy_tutor';
    const { game, p1 } = seed(gameId);
    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'bauble_1',
      abilityId: 'bauble_1-ability-0',
      cardName: 'Wayfarer\u2019s Bauble',
      abilityType: 'tutor',
      abilityText: BAUBLE_TEXT,
      activatedAbilityText: BAUBLE_TEXT,
      usesStack: true,
      searchParams: {
        filter: { types: ['land'], supertypes: ['basic'] },
        searchCriteria: 'basic land card',
        maxSelections: 1,
        destination: 'battlefield',
        entersTapped: true,
      },
      searchOnResolution: true,
      isAI: true,
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ abilityType: 'tutor', searchOnResolution: true });
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);

    (game as any).resolveTopOfStack();
    const steps = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(steps).toHaveLength(1);
    expect(String(steps[0]?.type)).toBe('library_search');
    expect(steps[0]?.destination).toBe('battlefield');
    expect((steps[0]?.availableCards || []).map((card: any) => card.id)).toEqual(['forest_1']);
  });

  it('replays energy paid for a battlefield activation cost', () => {
    const gameId = 't_round4_energy_replay';
    const { game, p1 } = seed(gameId);
    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'bauble_1',
      abilityId: 'bauble_1-ability-0',
      cardName: 'Energy Engine',
      abilityText: 'Draw a card.',
      activatedAbilityText: '{2}, Pay {E}{E}: Draw a card.',
      usesStack: true,
      energyPaidForCost: 2,
    } as any);
    expect((game.state as any).energy[p1]).toBe(1);
  });
});
