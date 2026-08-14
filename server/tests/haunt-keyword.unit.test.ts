import { describe, expect, it } from 'vitest';

import {
  applyHauntExileToTarget,
  listLegalHauntCreatureTargets,
} from '../src/state/modules/hauntKeywordUtils.js';

describe('generic haunt targeting helpers', () => {
  it('lists battlefield creatures and skips the dying haunt source', () => {
    const state = {
      battlefield: [
        {
          id: 'thrull',
          controller: 'p1',
          card: { name: 'Exhumer Thrull', type_line: 'Creature — Spirit' },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'relic',
          controller: 'p1',
          card: { name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'phased',
          controller: 'p2',
          phasedOut: true,
          card: { name: 'Phased Bear', type_line: 'Creature — Bear' },
        },
      ],
    };

    expect(listLegalHauntCreatureTargets(state, { excludePermanentId: 'thrull' }).map((target) => target.id))
      .toEqual(['bear']);
  });

  it('exiles the haunt card from graveyard with hauntingPermanentId stamped', () => {
    const hauntCard = {
      id: 'thrull_card',
      name: 'Exhumer Thrull',
      type_line: 'Creature — Spirit',
      oracle_text: 'Haunt (When this creature dies, exile it haunting target creature.)',
    };
    const state = {
      battlefield: [
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ],
      zones: {
        p1: {
          graveyard: [hauntCard],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
        },
      },
    };

    const result = applyHauntExileToTarget(state, {
      ownerId: 'p1',
      hauntCardId: 'thrull_card',
      targetPermanentId: 'bear',
    });

    expect(result.applied).toBe(true);
    expect(state.zones.p1.graveyard).toHaveLength(0);
    expect(state.zones.p1.exile).toHaveLength(1);
    expect(state.zones.p1.exile[0]).toEqual(expect.objectContaining({
      id: 'thrull_card',
      hauntingPermanentId: 'bear',
      hauntedCard: 'bear',
      hauntingTargetId: 'bear',
      zone: 'exile',
    }));
  });
});
