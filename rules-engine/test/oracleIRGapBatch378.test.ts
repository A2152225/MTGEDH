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

describe('Oracle IR gap batch 378 — 36 condition clusters', () => {
  it('evaluates quest present tense, burrog, swipe, flying, once upon a time, breena, hex, web-slinging, reaper', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has four or more quest counters on it',
        nextState: {
          battlefield: [{ id: 'bf-asc', controller: controllerId, type_line: 'Enchantment', counters: { quest: 4 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-asc' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've cast another instant or sorcery spell this turn",
        nextState: {} as GameState,
        ctx: { controllerId, castAnotherInstantOrSorceryThisTurn: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its power is 2',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Bear', power: 2 }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature has flying',
        nextState: {
          battlefield: [{ id: 'bf-fly', controller: 'p2', type_line: 'Creature — Bird', keywords: ['flying'] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-fly' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this spell is the first spell you've cast this game",
        nextState: { spellsCastThisGame: { p1: 0 } } as GameState,
        ctx: { controllerId, isFirstSpellCastThisGame: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that opponent has more life than another of your opponents',
        nextState: {
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 35 },
            { id: 'p3', life: 30 },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted equipment is attached to a creature',
        nextState: {
          battlefield: [
            { id: 'bf-creature', controller: controllerId, type_line: 'Creature — Human' },
            { id: 'bf-equip', controller: controllerId, type_line: 'Enchantment — Aura Equipment', attachedTo: 'bf-creature' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-equip' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they were cast using web-slinging',
        nextState: {} as GameState,
        ctx: { controllerId, castUsingWebSlinging: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'defending player has two or fewer cards in hand',
        nextState: { players: [{ id: 'p2', hand: [{ id: 'h1' }] }] } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates archive trap, soulflayer, lumengrid, bloodchief, spire, valakut, baba, sidequest, lich, marchesa', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent searched their library this turn',
        nextState: { opponentSearchedLibraryThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "a creature card with flying was exiled with this creature's delve ability",
        nextState: {} as GameState,
        ctx: { controllerId, delveExiledFlyingCreature: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player discards an artifact card this way',
        lastDiscardedCards: [{ type_line: 'Artifact' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent lost 2 or more life this turn',
        nextState: { lifeLostThisTurn: { p2: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this enchantment has three or more quest counters on it',
        nextState: {
          battlefield: [{ id: 'bf-bc', controller: controllerId, type_line: 'Enchantment', counters: { quest: 3 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-bc' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you guessed correctly for a card named this permanent',
        nextState: {} as GameState,
        ctx: { controllerId, guessedCorrectlyForCardNamedThisPermanent: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are cards exiled with this enchantment',
        nextState: {
          battlefield: [{ id: 'bf-valakut', controller: controllerId, type_line: 'Enchantment', exiledCardCount: 2 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-valakut' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there were three or more card types among the sacrificed permanents',
        nextState: {} as GameState,
        ctx: {
          controllerId,
          lastSacrificedPermanents: [
            { type_line: 'Creature — Human' },
            { type_line: 'Artifact' },
            { type_line: 'Enchantment' },
          ],
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "a creature died under an opponent's control this turn",
        nextState: { creatureDiedUnderOpponentControlThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'damage would be dealt to you',
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent is the monarch',
        nextState: { monarch: 'p2' } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates foreboding, brawler, hellish, warren, ingenious, dreampod, stockpile, ashnod, rowan, rekindled, trapper', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are three or more omen counters on this creature',
        nextState: {
          battlefield: [{ id: 'bf-omen', controller: controllerId, type_line: 'Artifact Creature', counters: { omen: 3 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-omen' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's the first time +1/+1 counters have been put on that permanent this turn",
        nextState: {} as GameState,
        ctx: { controllerId, firstTimePlusOneCountersPutOnThatPermanentThisTurn: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed permanent was a vehicle',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Artifact — Vehicle' }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a goblin is sacrificed this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Creature — Goblin' }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the {2}{u} cost was paid',
        nextState: {} as GameState,
        ctx: { controllerId, alternateCostPaid: true, paidAlternateCostRaw: '{2}{U}' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that cost wasn't paid",
        nextState: {} as GameState,
        ctx: { controllerId, alternateCostPaid: false },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is enchanted',
        nextState: {
          battlefield: [
            { id: 'bf-druid', controller: controllerId, type_line: 'Creature — Druid' },
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-druid' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-druid' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the discarded card was a zombie card',
        lastDiscardedCards: [{ type_line: 'Creature — Zombie' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'one or more permanents were sacrificed to activate it',
        nextState: {} as GameState,
        ctx: { controllerId, permanentsSacrificedToActivateAbility: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've drawn three or more cards this turn",
        nextState: { cardsDrawnThisTurn: { p1: 3 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent has no cards in hand',
        nextState: { players: [{ id: 'p1', hand: [{ id: 'h1' }] }, { id: 'p2', hand: [] }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "they aren't attacking you",
        nextState: {} as GameState,
        ctx: { controllerId, theyAreNotAttackingYou: true },
      })
    ).toBe(true);
  });

  it('evaluates urza meld, thirsting axe, barren glory, ravenous trap', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you both own and control this permanent and an artifact named the mightstone and weakstone',
        nextState: {
          battlefield: [
            { id: 'bf-urza', controller: controllerId, owner: controllerId, type_line: 'Legendary Creature — Human Artificer' },
            { id: 'bf-msw', controller: controllerId, owner: controllerId, name: 'The Mightstone and Weakstone', type_line: 'Legendary Artifact' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-urza' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "equipped creature didn't deal combat damage to a creature this turn",
        nextState: {} as GameState,
        ctx: { controllerId, equippedCreatureDidNotDealCombatDamageToCreatureThisTurn: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you control no permanents other than this enchantment and have no cards in hand',
        nextState: {
          players: [{ id: 'p1', hand: [] }],
          battlefield: [{ id: 'bf-glory', controller: controllerId, type_line: 'Enchantment' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-glory' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'an opponent had three or more cards put into their graveyard from anywhere this turn',
        nextState: { cardsPutIntoGraveyardFromAnywhereThisTurn: { p2: 3 } } as GameState,
      })
    ).toBe(true);
  });
});
