import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;
const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 379 — 36 condition clusters', () => {
  it('evaluates graveyard entry, colors, votes, adaptive, land grant, god, attack, damage, urborg, discard', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature entered from a graveyard or you cast it from a graveyard',
        nextState: {} as GameState,
        ctx: { controllerId, enteredFromGraveyard: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that permanent was blue or black',
        lastMovedCards: [{ type_line: 'Artifact', colors: ['U'] }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'no creature got votes',
        nextState: {} as GameState,
        ctx: { controllerId, noCreatureGotVotes: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature has greater power or toughness than this creature',
        nextState: {
          battlefield: [
            { id: 'bf-src', controller: controllerId, type_line: 'Artifact Creature', power: 1, toughness: 1 },
            { id: 'bf-tgt', controller: 'p2', type_line: 'Creature — Bear', power: 3, toughness: 3 },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-src', targetPermanentId: 'bf-tgt' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have no land cards in hand',
        nextState: {
          players: [{ id: 'p1', hand: [{ id: 'h1', type_line: 'Instant' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the exiled card is a god card',
        lastMovedCards: [{ type_line: 'Legendary Enchantment Creature — God' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this permanent attacked this turn',
        nextState: {
          battlefield: [{ id: 'bf-taigam', controller: controllerId, type_line: 'Legendary Creature', attackedThisTurn: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-taigam' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent was dealt 3 or more damage this turn',
        nextState: { damageDealtToOpponentsThisTurn: { p2: 3 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that creature's toughness is 1 or greater",
        nextState: {
          battlefield: [{ id: 'bf-tgt', controller: 'p2', type_line: 'Creature — Bear', toughness: 2 }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-tgt' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player controls a nonblack',
        nextState: {
          battlefield: [{ id: 'bf-red', controller: 'p2', type_line: 'Creature — Human', colors: ['R'] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've discarded a card this turn",
        nextState: { cardsDiscardedThisTurn: { p1: 1 } } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates wall, defense, earthbind, scout, party, excess permanent, attacking, invert skies, decayed, steam-kin', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature was dealt damage this turn',
        nextState: {
          battlefield: [{ id: 'bf-wall', controller: controllerId, type_line: 'Creature — Wall', dealtDamageThisTurn: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-wall' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent controls three or more creatures',
        nextState: {
          battlefield: [
            { id: 'o1', controller: 'p2', type_line: 'Creature — Goblin' },
            { id: 'o2', controller: 'p2', type_line: 'Creature — Goblin' },
            { id: 'o3', controller: 'p2', type_line: 'Creature — Goblin' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature has flying',
        nextState: {
          battlefield: [
            { id: 'bf-fly', controller: 'p2', type_line: 'Creature — Bird', keywords: ['flying'] },
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-fly' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-aura', enchantedPermanentId: 'bf-fly' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this permanent is a scout, it becomes a human faerie detective and gains "whenever this permanent deals combat damage to a player',
        nextState: {
          battlefield: [{ id: 'bf-scout', controller: controllerId, type_line: 'Creature — Scout' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-scout' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you had another cleric, rogue, warrior, or wizard enter the battlefield under your control this turn',
        nextState: {} as GameState,
        ctx: { controllerId, anotherPartyClassEnteredThisTurn: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'excess damage was dealt to a permanent this way',
        nextState: {} as GameState,
        ctx: { controllerId },
        lastExcessDamageDealtThisWay: 2,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature is attacking',
        nextState: {
          battlefield: [{ id: 'bf-atk', controller: 'p2', type_line: 'Creature — Bear', attacking: true }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-atk' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          '{g} was spent to cast this spell, and creatures you control gain flying until end of turn if {u} was spent to cast this spell',
        nextState: {} as GameState,
        ctx: { controllerId, greenManaSpentToCastThisSpell: true, blueManaSpentToCastThisSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it didn't have decayed",
        lastMovedCards: [{ type_line: 'Creature — Zombie', hadDecayed: false }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature has fewer than three +1/+1 counters on it',
        nextState: {
          battlefield: [{ id: 'bf-kin', controller: controllerId, type_line: 'Creature — Elemental', counters: { '+1/+1': 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-kin' },
      })
    ).toBe(true);
  });

  it('evaluates might makes right, syrix, magistrate, conduit, desertion, triskaidekaphile, serpent, pulse, voidwalker', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control each creature on the battlefield with the greatest power',
        nextState: {
          battlefield: [
            { id: 'bf-big', controller: controllerId, type_line: 'Creature — Giant', power: 5 },
            { id: 'bf-small', controller: 'p2', type_line: 'Creature — Goblin', power: 1 },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a creature card left your graveyard this turn',
        nextState: { creatureCardsLeftGraveyardThisTurn: { p1: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its mana value was 1 or greater',
        lastMovedCards: [{ cmc: 2, manaValue: 2 }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you haven't cast a spell this turn",
        nextState: { spellsCastThisTurnByPlayer: { p1: 0 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an artifact or creature spell is countered this way',
        nextState: {} as GameState,
        ctx: { controllerId, artifactOrCreatureSpellCounteredThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have exactly thirteen cards in your hand',
        nextState: {
          players: [{ id: 'p1', hand: Array.from({ length: 13 }, (_, i) => ({ id: `h${i}` })) }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature had a +1/+1 counter on it',
        nextState: {} as GameState,
        ctx: { controllerId, lastDestroyedCreatures: [{ hadPlusOneCounter: true }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that player or that planeswalker's controller has more life than you",
        nextState: {
          players: [
            { id: 'p1', life: 10 },
            { id: 'p2', life: 20 },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "a card would be put into an opponent's graveyard from anywhere",
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent cast a blue and/or black spell this turn',
        nextState: { opponentCastBlueOrBlackSpellThisTurn: true } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates cobra trap, madness, gunner, gisela/bruna meld', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'a noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled',
        nextState: { noncreaturePermanentDestroyedByOpponentThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this spell's madness cost was paid",
        nextState: {} as GameState,
        ctx: { controllerId, madnessCostWasPaid: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was enchanted',
        lastMovedCards: [{ wasEnchanted: true }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was equipped',
        lastMovedCards: [{ wasEquipped: true }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you both own and control this permanent and a creature named bruna',
        nextState: {
          battlefield: [
            { id: 'bf-gisela', controller: controllerId, owner: controllerId, type_line: 'Legendary Creature — Angel' },
            { id: 'bf-bruna', controller: controllerId, owner: controllerId, name: 'Bruna, the Fading Light', type_line: 'Legendary Creature — Angel' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-gisela' },
      })
    ).toBe(true);
  });
});
