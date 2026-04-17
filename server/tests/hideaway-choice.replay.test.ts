import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';

describe('hideawayChoice replay', () => {
  it('replays hideawayChoice by storing the chosen card under the source permanent and updating library order', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'windbrisk_1',
            controller: 'p1',
            owner: 'p1',
            card: {
              id: 'windbrisk_card',
              name: 'Windbrisk Heights',
              type_line: 'Land',
              oracle_text: 'Hideaway 4',
            },
          },
        ],
        stack: [{ id: 'hideaway_stack_1', controller: 'p1', owner: 'p1' }],
        zones: {
          p1: {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          },
        },
      },
      libraries: new Map([
        [
          'p1',
          [
            { id: 'top_1', name: 'Top Card 1', zone: 'library' },
            { id: 'top_2', name: 'Top Card 2', zone: 'library' },
            { id: 'top_3', name: 'Top Card 3', zone: 'library' },
            { id: 'top_4', name: 'Top Card 4', zone: 'library' },
            { id: 'rest_1', name: 'Rest Card', zone: 'library' },
          ],
        ],
      ]),
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'hideawayChoice',
      playerId: 'p1',
      permanentId: 'windbrisk_1',
      selectedCardId: 'top_2',
      lookedAtCardIds: ['top_1', 'top_2', 'top_3', 'top_4'],
      bottomOrderIds: ['top_3', 'top_1', 'top_4'],
      stackItemId: 'hideaway_stack_1',
    } as any);

    const permanent = ctx.state.battlefield[0] as any;
    const library = ctx.libraries.get('p1') || [];
    const zoneLibrary = ctx.state.zones.p1.library || [];

    expect(permanent.hideawayCard?.card?.id).toBe('top_2');
    expect(library.map((card: any) => card.id)).toEqual(['rest_1', 'top_3', 'top_1', 'top_4']);
    expect(zoneLibrary.map((card: any) => card.id)).toEqual(['rest_1', 'top_3', 'top_1', 'top_4']);
    expect((ctx.state.stack || []).some((item: any) => item.id === 'hideaway_stack_1')).toBe(false);
  });
});
