import { describe, expect, it } from 'vitest';
import { setPermanentPrepared, syncPreparedPermanentAfterControlChange } from '../src/state/modules/prepared.js';

describe('prepared control sync unit', () => {
  it('migrates prepared exile copy when controller changes', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const preparedCard = {
      id: 'prepared_treason_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      card_faces: [
        {
          name: 'Prepared Host',
          type_line: 'Creature — Human Advisor',
          oracle_text: 'This creature enters prepared.',
        },
        {
          name: 'Sudden Recall',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const permanent = {
      id: 'prepared_treason_perm',
      controller: p2,
      owner: p2,
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        type_line: 'Creature — Human Advisor',
      },
    } as any;

    const state = {
      zones: {
        [p1]: { exile: [], exileCount: 0 },
        [p2]: { exile: [], exileCount: 0 },
      },
      battlefield: [permanent],
    };

    setPermanentPrepared(state, permanent);
    expect(state.zones[p2].exile).toHaveLength(1);

    permanent.controller = p1;
    syncPreparedPermanentAfterControlChange(state, permanent, p2);

    expect(state.zones[p2].exile).toHaveLength(0);
    expect(state.zones[p1].exile).toHaveLength(1);
    expect(state.zones[p1].exile[0]).toMatchObject({
      canBePlayedBy: p1,
      preparedSourcePermanentId: 'prepared_treason_perm',
    });
  });
});
