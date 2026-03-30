import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack, triggerETBEffectsForPermanent } from '../src/state/modules/stack.js';
import type { PlayerID } from '../../shared/src';

describe("Legion's Landing ETB", () => {
  it('creates the 1/1 white Vampire token with lifelink from the front face ETB text', () => {
    const game = createInitialGameState('t_legions_landing_etb_token');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'AI' });

    const permanent: any = {
      id: 'perm_legions_landing_1',
      controller: p2,
      owner: p2,
      tapped: false,
      transformed: false,
      card: {
        id: 'legions_landing_card_1',
        name: "Legion's Landing // Adanto, the First Fort",
        type_line: 'Legendary Enchantment // Legendary Land',
        layout: 'transform',
        card_faces: [
          {
            name: "Legion's Landing",
            type_line: 'Legendary Enchantment',
            oracle_text: "When Legion's Landing enters, create a 1/1 white Vampire creature token with lifelink.\nWhen you attack with three or more creatures, transform Legion's Landing.",
            image_uris: { small: 'https://example.com/legions-landing-front.jpg' },
          },
          {
            name: 'Adanto, the First Fort',
            type_line: 'Legendary Land',
            oracle_text: '(Transforms from Legion\'s Landing.)\n{T}: Add {W}.\n{2}{W}, {T}: Create a 1/1 white Vampire creature token with lifelink.',
            image_uris: { small: 'https://example.com/adanto-back.jpg' },
          },
        ],
      },
    };

    (game.state.battlefield as any).push(permanent);

    triggerETBEffectsForPermanent(game as any, permanent, p2);

    const stack = (game.state.stack || []) as any[];
    expect(stack.some((item) => item?.type === 'triggered_ability' && item?.sourceName === "Legion's Landing")).toBe(true);

    resolveTopOfStack(game as any);

    const battlefield = (game.state.battlefield || []) as any[];
    const vampireToken = battlefield.find((entry) => entry?.isToken === true && entry?.controller === p2 && entry?.card?.name === 'Vampire');

    expect(vampireToken).toBeTruthy();
    expect(vampireToken?.basePower).toBe(1);
    expect(vampireToken?.baseToughness).toBe(1);
    expect(String(vampireToken?.card?.type_line || '')).toContain('Vampire');
    expect(String(vampireToken?.card?.oracle_text || '').toLowerCase()).toContain('lifelink');
  });
});