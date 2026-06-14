import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
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

describe('Oracle IR gap batch 372 — 36 condition clusters', () => {
  it('evaluates combat, warp, defending hand, no LTB, would destroyed, named spells', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it enlisted a creature this combat',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Soldier', enlistedThisCombat: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature was cast for its warp cost',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', alternateCostId: 'warp' }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'defending player has more cards in hand than you',
        nextState: {
          players: [
            { id: 'p1', hand: [{}] },
            { id: 'p2', hand: [{}, {}, {}] },
          ],
        } as GameState,
        ctx: { controllerId, defendingPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'no permanents left the battlefield this turn',
        nextState: { permanentLeftBattlefieldThisTurn: { p1: false, p2: false } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature would be destroyed',
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          "you've cast a spell named Peer Through Depths and a spell named Reach Through Mists this turn",
        nextState: {
          namedSpellsCastThisTurn: { p1: { peerThroughDepths: true, reachThroughMists: true } },
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates liar pendulum, guardian project, first strike, revival, delirium', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you do and your opponent guessed wrong' },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, youDoChoice: true, lastGuessCorrect: false },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          "it doesn't have the same name as another creature you control or a creature card in your graveyard",
        nextState: {
          players: [{ id: 'p1', graveyard: [] }],
          battlefield: [{ id: 'bf-unique', controller: controllerId, type_line: 'Creature — Elf', name: 'Elvish Mystic' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-unique' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it doesn't have first strike",
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human' }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has first strike',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', keywords: ['first strike'] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it had a revival counter on it',
        nextState: {} as GameState,
        lastMovedCards: [{ counters: { revival: 1 } }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'there are four or more card types among cards in your graveyard, search the graveyard, hand, and library of that spell\'s controller for any number of cards with the same name as that spell',
        nextState: {
          players: [{
            id: 'p1',
            graveyard: [
              { type_line: 'Instant' },
              { type_line: 'Sorcery' },
              { type_line: 'Creature — Human' },
              { type_line: 'Artifact' },
            ],
          }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates counters, life, equip, exert, artifact counters, council votes', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this creature doesn't have a +1/+1 counter on it",
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', counters: {} }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this enchantment has twenty or more growth counters on it',
        nextState: {
          battlefield: [{ id: 'bf-ascendancy', controller: controllerId, type_line: 'Enchantment', counters: { growth: 20 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-ascendancy' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have 40 or more life',
        nextState: { players: [{ id: 'p1', life: 40 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is equipped',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', isEquipped: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this creature hasn't been exerted this turn",
        nextState: {
          battlefield: [{ id: 'bf-celebrant', controller: controllerId, type_line: 'Creature — Human', exertedThisTurn: false }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-celebrant' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that artifact had counters on it',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Artifact', counters: { charge: 2 } }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'sickness gets more votes',
        nextState: { councilVoteResults: { sickness: 3, psychosis: 1 } } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates parser-emitted full-text conditions and turn trackers', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          "Target creature you control gets +2/+0 until end of turn if it's night. Then it deals damage equal to its power to target creature you don't control.",
        nextState: { dayNight: 'night' } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you drew two or more cards this turn',
        nextState: { cardsDrawnThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control no other creatures',
        nextState: {
          battlefield: [{ id: 'bf-lone', controller: controllerId, type_line: 'Creature — Spirit' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-lone' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you didn't play a land this turn",
        nextState: { landsPlayedThisTurn: { p1: 0 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a spell or ability you control would counter a spell',
        nextState: {} as GameState,
      })
    ).toBe(true);
  });
});
