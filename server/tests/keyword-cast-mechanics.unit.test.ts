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
      .some((candidate) => candidate.castMethod === 'mayhem' && candidate.manaCost === '{0}' && Boolean(candidate.castPermissionId))).toBe(true);
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

  it('reset+replay keeps the chosen Web-slinging return when two creatures are legal', () => {
    const game = createInitialGameState('keyword-web-slinging-reset-replay');
    const spell = {
      id: 'web-spell-choice',
      name: 'Web spell',
      mana_cost: '{2}{W}',
      type_line: 'Creature — Spider',
      oracle_text: 'Web-slinging {1}{W}',
    };
    const chosen = {
      id: 'chosen-creature',
      controller: 'p1',
      owner: 'p1',
      tapped: true,
      card: { id: 'chosen-card', name: 'Chosen', type_line: 'Creature — Human' },
    };
    const other = {
      id: 'other-creature',
      controller: 'p1',
      owner: 'p1',
      tapped: true,
      card: { id: 'other-card', name: 'Other', type_line: 'Creature — Spider' },
    };
    const castEvent = {
      type: 'castSpell',
      playerId: 'p1',
      cardId: spell.id,
      card: { ...spell, webSlingingReturnedCreatureId: chosen.id },
      alternateCostId: 'web_slinging',
      webSlingingReturnedCreatureId: chosen.id,
      fromZone: 'hand',
      targets: [],
    };

    const seedBoard = () => {
      (game.state as any).zones.p1 = { hand: [{ ...spell }], graveyard: [], handCount: 1, graveyardCount: 0 };
      (game.state as any).battlefield = [{ ...chosen, card: { ...chosen.card } }, { ...other, card: { ...other.card } }];
      (game.state as any).stack = [];
    };

    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    seedBoard();
    game.applyEvent(castEvent as any);

    const assertChosenReturn = () => {
      expect((game.state as any).battlefield.map((entry: any) => entry.id)).toEqual([other.id]);
      expect((game.state as any).zones.p1.hand).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: chosen.card.id }),
      ]));
      expect((game.state as any).zones.p1.hand.map((card: any) => card.id)).not.toContain(spell.id);
      expect((game.state as any).stack).toEqual(expect.arrayContaining([
        expect.objectContaining({
          card: expect.objectContaining({ id: spell.id }),
          castUsingWebSlinging: true,
          webSlingingCostWasPaid: true,
          webSlingingReturnedCreatureId: chosen.id,
          alternateCostId: 'web_slinging',
        }),
      ]));
    };
    assertChosenReturn();

    game.reset!(true);
    seedBoard();
    game.replay!([castEvent as any]);
    assertChosenReturn();

    // Undo-before-cast parity: truncate the cast and the board is untouched.
    game.reset!(true);
    seedBoard();
    expect((game.state as any).battlefield.map((entry: any) => entry.id).sort()).toEqual(
      [chosen.id, other.id].sort(),
    );
    expect((game.state as any).zones.p1.hand).toEqual([expect.objectContaining({ id: spell.id })]);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('reset+replay reconstructs Mayhem discard provenance and the graveyard cast', () => {
    const game = createInitialGameState('keyword-mayhem-reset-replay');
    const card = {
      id: 'mayhem-cast-card',
      name: 'Mayhem spell',
      mana_cost: '{5}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Mayhem {0} (You may cast this card from your graveyard for its mayhem cost if you discarded it this turn.)',
    };
    const discardEvent = {
      type: 'cleanupDiscard',
      playerId: 'p1',
      cardIds: [card.id],
    };

    const seedBoard = () => {
      (game.state as any).turnNumber = 4;
      (game.state as any).zones.p1 = { hand: [{ ...card }], graveyard: [], handCount: 1, graveyardCount: 0 };
      (game.state as any).battlefield = [];
      (game.state as any).stack = [];
    };

    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    seedBoard();
    game.applyEvent(discardEvent as any);
    const gyAfterDiscard = (game.state as any).zones.p1.graveyard[0];
    expect(gyAfterDiscard).toMatchObject({
      id: card.id,
      discardedByPlayerId: 'p1',
      discardedOnTurn: 4,
    });
    expect(cardMayBeCastWithMayhem(game.state, 'p1', gyAfterDiscard)).toBe(true);
    const mayhemCandidate = getCastableSpellCandidates(game as any, 'p1' as any, { mode: 'main' })
      .find((candidate) => candidate.castMethod === 'mayhem' && String(candidate.card?.id || '') === card.id);
    expect(mayhemCandidate?.castPermissionId).toEqual(expect.any(String));
    expect(mayhemCandidate?.graveyardPermissionId).toBe(mayhemCandidate?.castPermissionId);

    const castEvent = {
      type: 'castSpell',
      playerId: 'p1',
      cardId: card.id,
      card: {
        ...card,
        castPermissionId: mayhemCandidate?.castPermissionId,
        graveyardPermissionId: mayhemCandidate?.graveyardPermissionId,
      },
      alternateCostId: 'mayhem',
      castPermissionId: mayhemCandidate?.castPermissionId,
      graveyardPermissionId: mayhemCandidate?.graveyardPermissionId,
      fromZone: 'graveyard',
      targets: [],
      manaSpentTotal: 0,
    };

    game.applyEvent(castEvent as any);

    const assertMayhemCast = () => {
      expect((game.state as any).zones.p1.graveyard.map((entry: any) => entry.id)).not.toContain(card.id);
      expect((game.state as any).stack).toEqual(expect.arrayContaining([
        expect.objectContaining({
          card: expect.objectContaining({ id: card.id }),
          alternateCostId: 'mayhem',
          castFromGraveyard: true,
          castPermissionId: mayhemCandidate?.castPermissionId,
          graveyardPermissionId: mayhemCandidate?.graveyardPermissionId,
        }),
      ]));
    };
    assertMayhemCast();

    game.reset!(true);
    seedBoard();
    game.replay!([discardEvent as any, castEvent as any]);
    assertMayhemCast();

    // Undo truncates before the cast: provenance remains, Mayhem is still legal this turn.
    game.reset!(true);
    seedBoard();
    game.replay!([discardEvent as any]);
    const gyOnly = (game.state as any).zones.p1.graveyard[0];
    expect(gyOnly).toMatchObject({
      id: card.id,
      discardedByPlayerId: 'p1',
      discardedOnTurn: 4,
    });
    expect(cardMayBeCastWithMayhem(game.state, 'p1', gyOnly)).toBe(true);
    expect((game.state as any).stack || []).toHaveLength(0);

    // Turn change rejects Mayhem even with the same discarded card object.
    (game.state as any).turnNumber = 5;
    expect(cardMayBeCastWithMayhem(game.state, 'p1', gyOnly)).toBe(false);
    expect(getCastableSpellCandidates(game as any, 'p1' as any, { mode: 'main' })
      .some((candidate) => candidate.castMethod === 'mayhem')).toBe(false);
  });
});
