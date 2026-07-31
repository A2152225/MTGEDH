import { describe, expect, it } from 'vitest';

import { resolveTriggeredAbilityControllerId } from '../src/state/modules/triggerSourceUtils.js';
import { resolveTriggeredAbilityStackItem } from '../src/state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js';

describe('triggered ability controller resolution', () => {
  it('recovers controller from source permanent when stack item controller is missing', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'harvester_1',
          controller: 'p2',
          card: {
            name: 'Harvester of Souls',
            type_line: 'Creature — Demon',
            oracle_text: 'Whenever a creature dies, you may draw a card.',
          },
        },
      ],
      stack: [],
    };

    const triggerItem = {
      id: 'trigger_1',
      type: 'triggered_ability',
      // Missing controller — previously orphaned option_choice and left priority null.
      source: 'harvester_1',
      sourceName: 'Harvester of Souls',
      description: 'you may draw a card',
      triggerType: 'creature_dies',
      effect: 'you may draw a card',
    };

    expect(resolveTriggeredAbilityControllerId(state, triggerItem)).toBe('p2');

    let executedController: string | undefined;
    const ctx = {
      state,
      bumpSeq: () => {},
      gameId: 'test_harvester_controller',
    };

    resolveTriggeredAbilityStackItem(ctx as any, {
      item: triggerItem,
      controller: undefined as any,
      executeTriggerEffect: (_ctx: any, controller: string) => {
        executedController = controller;
      },
    });

    expect(executedController).toBe('p2');
    expect(triggerItem.controller).toBe('p2');
  });

  it('skips execution when controller cannot be recovered', () => {
    const state = {
      players: [{ id: 'p1' }],
      battlefield: [],
      stack: [],
    };
    let executed = false;
    resolveTriggeredAbilityStackItem(
      { state, bumpSeq: () => {} } as any,
      {
        item: {
          id: 'trigger_1',
          type: 'triggered_ability',
          sourceName: 'Harvester of Souls',
          description: 'you may draw a card',
          triggerType: 'creature_dies',
        },
        controller: undefined as any,
        executeTriggerEffect: () => {
          executed = true;
        },
      },
    );
    expect(executed).toBe(false);
  });
});
