import { describe, expect, it } from 'vitest';
import { setCommander } from '../src/state/modules/commander.js';

describe('Commander front-face snapshots', () => {
  it('uses face-0 image data when a transform commander has no top-level image_uris', () => {
    const playerId = 'player1';
    const commanderCard = {
      id: 'sephiroth-front',
      name: 'Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel',
      layout: 'transform',
      type_line: 'Legendary Creature — Human Soldier',
      card_faces: [
        {
          name: 'Sephiroth, Fabled SOLDIER',
          type_line: 'Legendary Creature — Human Soldier',
          mana_cost: '{2}{W}{B}',
          image_uris: {
            normal: 'https://img.test/sephiroth-front-normal.jpg',
            art_crop: 'https://img.test/sephiroth-front-art.jpg',
          },
          power: '3',
          toughness: '3',
        },
        {
          name: 'Sephiroth, One-Winged Angel',
          type_line: 'Legendary Creature — Angel',
          image_uris: {
            normal: 'https://img.test/sephiroth-back-normal.jpg',
          },
          power: '5',
          toughness: '5',
        },
      ],
    };

    const libraries = new Map([[playerId, [commanderCard]]]);
    const ctx: any = {
      commandZone: {},
      libraries,
      pendingInitialDraw: new Set<string>(),
      state: {
        phase: 'pre_game',
        zones: {
          [playerId]: {
            hand: [],
            handCount: 0,
            libraryCount: 1,
            graveyard: [],
            graveyardCount: 0,
          },
        },
        battlefield: [],
        commandZone: {},
      },
      bumpSeq() {},
    };

    setCommander(ctx, playerId, ['Sephiroth, Fabled SOLDIER'], ['sephiroth-front'], ['W', 'B']);

    const snapshot = ctx.state.commandZone[playerId]?.commanderCards?.[0];
    expect(snapshot).toBeDefined();
    expect(snapshot.image_uris?.normal).toBe('https://img.test/sephiroth-front-normal.jpg');
    expect(snapshot.image_uris?.art_crop).toBe('https://img.test/sephiroth-front-art.jpg');
    expect(snapshot.mana_cost).toBe('{2}{W}{B}');
    expect(snapshot.card_faces?.[0]?.name).toBe('Sephiroth, Fabled SOLDIER');
    expect(snapshot.layout).toBe('transform');
  });
});