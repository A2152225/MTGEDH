import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

describe('Door of Destinies spell-cast charge counters', () => {
  const doorOracle =
    'As Door of Destinies enters the battlefield, choose a creature type.\n' +
    'Whenever you cast a spell of the chosen type, put a charge counter on Door of Destinies.\n' +
    'Creatures you control of the chosen type get +1/+1 for each charge counter on Door of Destinies.';

  it('detects only the chosen-type trigger with the charge-counter effect sentence', () => {
    const permanent = {
      id: 'door_1',
      controller: 'p1',
      chosenCreatureType: 'Merfolk',
      card: {
        name: 'Door of Destinies',
        type_line: 'Artifact',
        oracle_text: doorOracle,
      },
    };

    const triggers = detectSpellCastTriggers(permanent.card, permanent);
    expect(triggers.some((trigger) => trigger.spellCondition === 'any')).toBe(false);
    expect(triggers).toEqual([
      expect.objectContaining({
        spellCondition: 'tribal_type',
        tribalType: 'Merfolk',
        effect: 'put a charge counter on Door of Destinies',
      }),
    ]);
  });

  it('puts a charge counter on Door of Destinies when the trigger resolves', () => {
    const gameId = 't_door_of_destinies';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const doorId = 'door_1';
    (game.state as any).battlefield = [
      {
        id: doorId,
        controller: p1,
        owner: p1,
        chosenCreatureType: 'Merfolk',
        counters: {},
        card: {
          id: 'card_door',
          name: 'Door of Destinies',
          type_line: 'Artifact',
          oracle_text: doorOracle,
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Door of Destinies',
      'put a charge counter on Door of Destinies',
      {
        source: doorId,
        permanentId: doorId,
        triggerType: 'cast_creature_type',
      },
    );

    const door = ((game.state as any).battlefield || []).find((perm: any) => perm.id === doorId);
    expect(door?.counters?.charge).toBe(1);
  });
});
