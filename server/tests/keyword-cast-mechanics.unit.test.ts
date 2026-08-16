import { describe, expect, it } from 'vitest';

import {
  calculateWebSlingingOptions,
  cardMayBeCastWithMayhem,
  parseMayhemCost,
  parseWebSlingingCost,
  validateWebSlingingReturnedCreature,
} from '../src/state/modules/keywordCastMechanics.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { createInitialGameState } from '../src/state/index.js';

describe('generic keyword cast mechanics', () => {
  it('requires discard provenance from the current player and turn for Mayhem', () => {
    const card = {
      oracle_text: 'Mayhem {1}{R} (You may cast this card from your graveyard for its mayhem cost if you discarded it this turn.)',
      discardedOnTurn: 7,
      discardedByPlayerId: 'p1',
    };
    expect(parseMayhemCost(card.oracle_text)).toBe('{1}{R}');
    expect(cardMayBeCastWithMayhem({ turnNumber: 7 }, 'p1', card)).toBe(true);
    expect(cardMayBeCastWithMayhem({ turnNumber: 8 }, 'p1', card)).toBe(false);
    expect(cardMayBeCastWithMayhem({ turnNumber: 7 }, 'p2', card)).toBe(false);
  });

  it('surfaces a Mayhem graveyard candidate only with current discard provenance', () => {
    const card = {
      id: 'mayhem-card',
      name: 'Mayhem spell',
      mana_cost: '{5}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Mayhem {0} (You may cast this card from your graveyard for its mayhem cost if you discarded it this turn.)',
      discardedOnTurn: 7,
      discardedByPlayerId: 'p1',
    };
    const state = {
      turnNumber: 7,
      zones: { p1: { hand: [], graveyard: [card] } },
      battlefield: [],
      stack: [],
    };
    expect(getCastableSpellCandidates({ state } as any, 'p1' as any, { mode: 'main' })
      .some((candidate) => candidate.castMethod === 'mayhem' && candidate.manaCost === '{0}')).toBe(true);
    card.discardedOnTurn = 6;
    expect(getCastableSpellCandidates({ state } as any, 'p1' as any, { mode: 'main' })
      .some((candidate) => candidate.castMethod === 'mayhem')).toBe(false);
  });

  it('lists and validates only tapped creatures controlled for Web-slinging', () => {
    const state = {
      battlefield: [
        { id: 'tapped', controller: 'p1', tapped: true, card: { name: 'Tapped', type_line: 'Creature — Spider' } },
        { id: 'untapped', controller: 'p1', tapped: false, card: { name: 'Untapped', type_line: 'Creature — Human' } },
        { id: 'opponent', controller: 'p2', tapped: true, card: { name: 'Opponent', type_line: 'Creature — Goblin' } },
      ],
    };
    const oracleText = 'Web-slinging {1}{W} (You may return a tapped creature you control to its owner\'s hand rather than pay this spell\'s mana cost.)';
    expect(parseWebSlingingCost(oracleText)).toBe('{1}{W}');
    expect(calculateWebSlingingOptions(state, 'p1', { oracle_text: oracleText }).availableCreatures.map((entry) => entry.id)).toEqual(['tapped']);
    expect(validateWebSlingingReturnedCreature(state, 'p1', 'tapped').ok).toBe(true);
    expect(validateWebSlingingReturnedCreature(state, 'p1', 'untapped')).toMatchObject({ ok: false, code: 'WEB_SLINGING_CREATURE_UNTAPPED' });
  });

  it('replays the selected Web-slinging return before placing the spell on the stack', () => {
    const game = createInitialGameState('keyword-web-slinging-replay');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    const spell = {
      id: 'web-spell',
      name: 'Web spell',
      mana_cost: '{2}{W}',
      type_line: 'Creature — Spider',
      oracle_text: 'Web-slinging {1}{W}',
    };
    (game.state as any).zones.p1 = { hand: [spell], graveyard: [], handCount: 1, graveyardCount: 0 };
    (game.state as any).battlefield = [{
      id: 'returned-creature',
      controller: 'p1',
      owner: 'p1',
      tapped: true,
      card: { id: 'returned-card', name: 'Returned creature', type_line: 'Creature — Human' },
    }];

    game.applyEvent({
      type: 'castSpell',
      playerId: 'p1',
      cardId: spell.id,
      card: { ...spell, webSlingingReturnedCreatureId: 'returned-creature' },
      alternateCostId: 'web_slinging',
      webSlingingReturnedCreatureId: 'returned-creature',
      fromZone: 'hand',
      targets: [],
    } as any);

    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones.p1.hand).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'returned-card' }),
    ]));
    expect((game.state as any).stack).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: spell.id }),
        castUsingWebSlinging: true,
        webSlingingCostWasPaid: true,
      }),
    ]));
  });

  it('stamps Mayhem discard provenance when replaying cleanupDiscard', () => {
    const game = createInitialGameState('keyword-mayhem-cleanup-discard');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    (game.state as any).turnNumber = 4;
    const card = {
      id: 'discarded-mayhem',
      name: 'Mayhem spell',
      mana_cost: '{1}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Mayhem {0}',
    };
    (game.state as any).zones.p1 = { hand: [card], graveyard: [], handCount: 1, graveyardCount: 0 };

    game.applyEvent({
      type: 'cleanupDiscard',
      playerId: 'p1',
      cardIds: [card.id],
    } as any);

    const gyCard = (game.state as any).zones.p1.graveyard[0];
    expect(gyCard).toMatchObject({
      id: card.id,
      discardedByPlayerId: 'p1',
      discardedOnTurn: 4,
    });
    expect(cardMayBeCastWithMayhem(game.state, 'p1', gyCard)).toBe(true);
  });
});
