import { describe, expect, it } from 'vitest';
import { lookupStackZoneTarget } from './stackZoneTargetLookup';

describe('lookupStackZoneTarget', () => {
  it('reads a graveyard card from view zones when player objects have no graveyard', () => {
    const hit = lookupStackZoneTarget({
      targetId: 'terrain',
      players: [{ id: 'king', name: 'King' }],
      zones: {
        king: {
          graveyard: [{ id: 'terrain', name: 'Treacherous Terrain', type_line: 'Sorcery' }],
        },
      },
    });
    expect(hit).toMatchObject({ name: 'Treacherous Terrain', ownerId: 'king', zone: 'graveyard' });
  });

  it('falls back to the stack item target hint when the card is not in the zone lists', () => {
    const hit = lookupStackZoneTarget({
      targetId: 'terrain',
      stack: [{
        id: 'ability_1',
        copyRetargetValidTargets: [{
          id: 'terrain',
          name: 'Treacherous Terrain',
          type: 'graveyard_card',
          zoneOwnerId: 'king',
        }],
      }],
    });
    expect(hit).toMatchObject({ name: 'Treacherous Terrain', ownerId: 'king', zone: 'graveyard' });
  });
});
