import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { runSBA } from '../src/state/modules/counters_tokens.js';
import { resolveLandCardFaceForBattlefieldEntry } from '../src/state/modules/stackPlayLandUtils.js';

const westvaleCard = {
  id: 'westvale_1',
  name: 'Westvale Abbey // Ormendahl, Profane Prince',
  type_line: 'Land // Legendary Creature — Demon',
  layout: 'transform',
  card_faces: [
    {
      name: 'Westvale Abbey',
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.',
    },
    {
      name: 'Ormendahl, Profane Prince',
      type_line: 'Legendary Creature — Demon',
      oracle_text: 'Flying, lifelink, indestructible, haste',
      power: '9',
      toughness: '7',
    },
  ],
};

describe('resolveLandCardFaceForBattlefieldEntry', () => {
  it('uses the transform front land face only', () => {
    const resolved = resolveLandCardFaceForBattlefieldEntry(westvaleCard);
    expect(resolved.type_line).toBe('Land');
    expect(resolved.name).toBe('Westvale Abbey');
    expect(resolved.power).toBeUndefined();
    expect(resolved.toughness).toBeUndefined();
  });
});

describe('playLand transform lands', () => {
  it('keeps Westvale Abbey on the battlefield after state-based actions', () => {
    const g = createInitialGameState('westvale_land_play');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'AI' });
    g.importDeckResolved(p1, [westvaleCard as any]);
    g.drawCards(p1, 1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).step = GameStep.MAIN1;

    const handCard = (g.state.zones?.[p1]?.hand as any[])[0];
    expect(handCard?.id).toBe('westvale_1');

    g.playLand(p1, handCard.id);

    expect(g.state.battlefield.length).toBe(1);
    expect(g.state.battlefield[0]?.card?.type_line).toBe('Land');
    expect(g.state.battlefield[0]?.baseToughness).toBeUndefined();

    runSBA({
      state: g.state,
      bumpSeq: () => {},
      gameId: 'westvale_land_play',
    } as any);

    expect(g.state.battlefield.length).toBe(1);
    expect((g.state.zones?.[p1]?.graveyard as any[] | undefined)?.length ?? 0).toBe(0);
  });
});
