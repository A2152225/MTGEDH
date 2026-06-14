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

describe('Oracle IR gap batch 376 — 36 condition clusters', () => {
  it('evaluates historic, biblioplex, opal palace, titan hunter, primoc, sentinel, forum, vikya, elanor', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was historic',
        lastMovedCards: [{ type_line: 'Legendary Artifact — Equipment', cmc: 3 }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this land isn't a creature",
        nextState: {
          battlefield: [{ id: 'bf-biblioplex', controller: controllerId, type_line: 'Land' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-biblioplex' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you spend this mana to cast your commander',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentToCastCommander: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'no creatures died this turn',
        nextState: { creatureDiedThisTurn: false } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a player controls more wizards than each other player',
        nextState: {
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'w1', controller: 'p1', type_line: 'Creature — Wizard' },
            { id: 'w2', controller: 'p1', type_line: 'Creature — Wizard' },
            { id: 'w3', controller: 'p2', type_line: 'Creature — Wizard' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you cast it during your main phase',
        nextState: {} as GameState,
        ctx: { controllerId, castDuringMainPhase: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that mana is spent on a multicolored creature spell',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentOnMulticoloredCreatureSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'excess damage was dealt to a creature this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastExcessDamageDealtThisWay: 2 },
        lastExcessDamageDealtThisWay: 2,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you sacrificed a food this turn',
        nextState: { foodSacrificedThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates cosmic rebirth, baleful, timebug, train heist, imaginary pet, mages contest, madness, sidar, kitsune, silver bolt', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has mana value 3 or less',
        nextState: {
          players: [{ id: 'p1', graveyard: [{ id: 'gy-target', type_line: 'Creature — Human', cmc: 2 }] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'gy-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the {1}{b} cost was paid',
        nextState: {} as GameState,
        ctx: { controllerId, alternateCostPaid: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that permanent or card has a time counter on it',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Artifact', counters: { time: 1 } }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's your combat phase",
        nextState: { phase: 'combat', activePlayerId: 'p1' } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have a card in hand',
        nextState: {
          players: [{ id: 'p1', hand: [{ id: 'hand-1', type_line: 'Instant' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you win the bidding',
        nextState: {} as GameState,
        ctx: { controllerId, wonBidding: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its madness cost was paid',
        nextState: {} as GameState,
        ctx: { controllerId, madnessCostWasPaid: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'sidar jabari is in the command zone or on the battlefield',
        nextState: {
          battlefield: [{ id: 'bf-sidar', name: 'Sidar Jabari of Zhalfir', controller: controllerId, type_line: 'Legendary Creature — Human Knight' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is enchanted by two or more auras',
        nextState: {
          battlefield: [
            { id: 'bf-kitsune', controller: controllerId, type_line: 'Creature — Fox Wizard' },
            { id: 'bf-a1', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-kitsune' },
            { id: 'bf-a2', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-kitsune' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-kitsune' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a werewolf is dealt damage this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastDamagedCards: [{ type_line: 'Creature — Werewolf // Human' }] },
      })
    ).toBe(true);
  });

  it('evaluates verdant, multiple choice, maze mantle, bankbuster, ultros, proft, deadly brew, galadriel elf, thallid, grisly sigil', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the {3}{g} cost was paid',
        nextState: {} as GameState,
        ctx: { controllerId, alternateCostPaid: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'x is 1',
        nextState: {} as GameState,
        ctx: { controllerId, xValue: 1 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'x is 3',
        nextState: {} as GameState,
        ctx: { controllerId, xValue: 3 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature has toxic',
        nextState: {
          battlefield: [
            { id: 'bf-toxic', controller: controllerId, type_line: 'Creature — Human', keywords: ['toxic'] },
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-toxic' },
          ],
        } as GameState,
        ctx: { controllerId, enchantedPermanentId: 'bf-toxic' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are no charge counters on this vehicle',
        nextState: {
          battlefield: [{ id: 'bf-vehicle', controller: controllerId, type_line: 'Artifact — Vehicle', counters: {} }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-vehicle' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'at least eight mana was spent to cast it',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentToCastIt: 8 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've drawn more than one card this turn",
        nextState: { cardsDrawnThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you sacrificed a permanent this way',
        nextState: {} as GameState,
        ctx: { controllerId, youSacrificedPermanentThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'another elf entered the battlefield under your control this turn',
        nextState: { elvesEnteredBattlefieldUnderControlThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a saproling was sacrificed this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Token Creature — Saproling' }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was dealt noncombat damage this turn',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Human', wasDealtNoncombatDamageThisTurn: true }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target', targetWasDealtNoncombatDamageThisTurn: true },
      })
    ).toBe(true);
  });

  it('evaluates celestial reunion, kaito, lightning coils, consuming ashes mv, parser unless stubs', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this spell's additional cost was paid and the revealed card is the chosen type",
        nextState: {} as GameState,
        ctx: { controllerId, optionalAdditionalCostWasPaid: true, revealedCardMatchesChosenType: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'kaito entered this turn',
        nextState: { kaitoEnteredThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this artifact has five or more charge counters on it',
        nextState: {
          battlefield: [{ id: 'bf-coils', controller: controllerId, type_line: 'Artifact', counters: { charge: 5 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-coils' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it had mana value 3 or less',
        lastMovedCards: [{ id: 'exiled', cmc: 2, type_line: 'Creature — Zombie' }],
        nextState: {
          players: [{ id: 'p2', exile: [{ id: 'exiled', cmc: 2, type_line: 'Creature — Zombie' }] }],
        } as GameState,
        lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'draw two cards. then discard a card at random unless you pay {e}{e} (two energy counters).',
        nextState: {} as GameState,
        ctx: { controllerId, unlessPaysEnergyChoice: 'pay' },
      })
    ).toBe(true);
  });
});
