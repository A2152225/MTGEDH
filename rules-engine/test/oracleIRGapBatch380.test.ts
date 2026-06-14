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

describe('Oracle IR gap batch 380 — remaining condition clusters', () => {
  it('evaluates mayhem, impromptu, foundry, teferi, cinder, nasty end, dose, rith, kazuul', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you discarded it this turn',
        nextState: {} as GameState,
        ctx: { controllerId, discardedItThisTurn: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it isn't a creature card",
        lastMovedCards: [{ type_line: 'Instant' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed permanent was an artifact',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Artifact' }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it enters as a creature',
        nextState: {} as GameState,
        ctx: { controllerId, entersAsCreature: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a white creature dies this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastCreaturesDiedThisWay: [{ type_line: 'Creature — Human', colors: ['W'] }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed creature was legendary',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Legendary Creature — Human' }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it isn't your main phase",
        nextState: { phase: 'combat', turnPlayer: 'p1' } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a creature or planeswalker an opponent controlled was dealt excess damage this turn',
        nextState: { opponentPermanentDealtExcessDamageThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you're the defending player",
        nextState: { defendingPlayerId: 'p1' } as GameState,
        ctx: { controllerId, isDefendingPlayer: true },
      })
    ).toBe(true);
  });

  it('evaluates jared, barrin, creakwood, invoke despair, unforge, totem, jadar, chain veil, bombardment', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that card was all colors',
        lastMovedCards: [{ colors: ['W', 'U', 'B', 'R', 'G'] }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a permanent was put into your hand from the battlefield this turn',
        nextState: { permanentsPutIntoHandFromBattlefieldThisTurn: { p1: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there is an elf card in your graveyard and this creature has a -1/-1 counter on it',
        nextState: {
          players: [{ id: 'p1', graveyard: [{ type_line: 'Creature — Elf' }] }],
          battlefield: [{ id: 'bf-elf', controller: controllerId, type_line: 'Creature — Elf', counters: { '-1/-1': 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-elf' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "they can't",
        nextState: { battlefield: [] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that equipment was attached to a creature',
        nextState: {
          battlefield: [{ id: 'bf-bearer', controller: 'p2', type_line: 'Creature — Human' }],
        } as GameState,
        ctx: {
          controllerId,
          targetPermanentId: 'bf-equip',
          lastMovedCards: [{ id: 'bf-equip', type_line: 'Artifact — Equipment', attachedTo: 'bf-bearer' }],
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you haven't played it",
        nextState: {} as GameState,
        ctx: { controllerId, hasNotPlayedIt: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control no creatures with decayed',
        nextState: {
          battlefield: [{ id: 'bf-human', controller: controllerId, type_line: 'Creature — Human' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you didn't activate a loyalty ability of a planeswalker this turn",
        nextState: { activatedLoyaltyAbilityThisTurn: { p1: false } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "two or more permanents you don't control have an aim counter on them",
        nextState: {
          battlefield: [
            { id: 'a1', controller: 'p2', type_line: 'Creature — Human', counters: { aim: 1 } },
            { id: 'a2', controller: 'p2', type_line: 'Creature — Goblin', counters: { aim: 1 } },
          ],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates tainted specter, book of vile darkness, agni kai, prisoners dilemma, ayara, polis crusher, test of endurance', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player discards a card this way',
        lastDiscardedCards: [{ id: 'disc-1' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you lost 2 or more life this turn',
        nextState: { lifeLostThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the creature the opponent controls is dealt excess damage this way',
        nextState: {} as GameState,
        lastExcessDamageDealtThisWay: 2,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'each opponent chose silence',
        nextState: {} as GameState,
        ctx: { controllerId, eachOpponentChoseSilence: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'each opponent chose snitch',
        nextState: {} as GameState,
        ctx: { controllerId, eachOpponentChoseSnitch: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has fewer than four +1/+1 counters on it',
        nextState: {
          battlefield: [{ id: 'bf-oath', controller: controllerId, type_line: 'Creature — Knight', counters: { '+1/+1': 2 } }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-oath' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is monstrous',
        nextState: {
          battlefield: [{ id: 'bf-crusher', controller: controllerId, type_line: 'Creature — Cyclops', monstrous: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-crusher' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have 50 or more life',
        nextState: { players: [{ id: 'p1', life: 50 }] } as GameState,
      })
    ).toBe(true);
  });
});
