import { describe, expect, it } from 'vitest';

import type { KnownCardRef } from '../../shared/src';
import { getGraveyardAbilitiesForCard, getGraveyardDoubleClickAbility } from '../src/components/GraveyardViewModal';
import { pickGraveyardContextMenuCard } from '../src/components/zonesPilesGraveyardContextTarget';
import { buildPlayLandRequestPayload } from '../src/utils/playLandRequestPayload';

const forest: KnownCardRef = { id: 'forest_1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '{T}: Add {G}.' } as KnownCardRef;
const bolt: KnownCardRef = { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}' } as KnownCardRef;
const bear: KnownCardRef = { id: 'bear_1', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '' } as KnownCardRef;

describe('buildPlayLandRequestPayload', () => {
  it('sends exactly the keys the server playLand handler reads for a graveyard land', () => {
    expect(buildPlayLandRequestPayload({ gameId: 'g1', cardId: 'forest_1', fromZone: 'graveyard' })).toEqual({
      gameId: 'g1',
      cardId: 'forest_1',
      fromZone: 'graveyard',
    });
  });

  it('keeps selectedFace and drops unknown zones', () => {
    expect(buildPlayLandRequestPayload({ gameId: 'g1', cardId: 'mdfc_1', selectedFace: 1, fromZone: 'battlefield' })).toEqual({
      gameId: 'g1',
      cardId: 'mdfc_1',
      selectedFace: 1,
    });
  });
});

describe('graveyard pile right-click target', () => {
  it('targets the top card when it is playable', () => {
    expect(pickGraveyardContextMenuCard([bolt, forest], ['forest_1'])?.id).toBe('forest_1');
  });

  it('targets the topmost playable land when the top card is not playable', () => {
    expect(pickGraveyardContextMenuCard([forest, bear], ['forest_1'])?.id).toBe('forest_1');
  });

  it('falls back to the top card and handles an empty graveyard', () => {
    expect(pickGraveyardContextMenuCard([forest, bear], [])?.id).toBe('bear_1');
    expect(pickGraveyardContextMenuCard([], ['forest_1'])).toBeUndefined();
  });
});

describe('graveyard modal double-click', () => {
  it('plays a playable graveyard land on double-click', () => {
    const abilities = getGraveyardAbilitiesForCard(forest, { isPlayable: true });
    expect(getGraveyardDoubleClickAbility(abilities)?.id).toBe('play-land');
  });

  it('does nothing for an unplayable land or a playable spell', () => {
    expect(getGraveyardDoubleClickAbility(getGraveyardAbilitiesForCard(forest, { isPlayable: false }))).toBeUndefined();
    expect(getGraveyardDoubleClickAbility(getGraveyardAbilitiesForCard(bolt, { isPlayable: true }))).toBeUndefined();
  });
});
