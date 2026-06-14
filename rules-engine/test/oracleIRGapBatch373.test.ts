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

describe('Oracle IR gap batch 373 — 36 condition clusters', () => {
  it('evaluates rampage, timely reinforcements, sokenzan, dragon mana, exiled with it', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it doesn't have rampage",
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human' }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have less life than an opponent',
        nextState: { players: [{ id: 'p1', life: 10 }, { id: 'p2', life: 20 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control fewer creatures than an opponent',
        nextState: {
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'c1', controller: controllerId, type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p2', type_line: 'Creature — Elf' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a player has more cards in hand than each other player',
        nextState: {
          players: [{ id: 'p1', hand: [{}] }, { id: 'p2', hand: [{}, {}, {}] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that mana is spent on a dragon creature spell',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentOnDragonCreatureSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are cards exiled with it',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Artifact', exiledCardCount: 2 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);
  });

  it('evaluates artifact control, counters, spirit, combat, avatar, exile entry', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you controlled that artifact',
        nextState: {} as GameState,
        lastMovedCards: [{ controller: controllerId, type_line: 'Artifact' }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it had no counters on it',
        lastMovedCards: [{ counters: {} }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "he wasn't a spirit",
        lastMovedCards: [{ type_line: 'Creature — Human' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a black creature with flying is attacking',
        nextState: {
          battlefield: [{
            id: 'bf-atk',
            controller: 'p2',
            type_line: 'Creature — Bat',
            colors: ['B'],
            keywords: ['flying'],
            attacking: controllerId,
          }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent controls at least four more creatures than you',
        nextState: {
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'c1', controller: controllerId, type_line: 'Creature — Human' },
            ...new Array(5).fill(null).map((_, i) => ({
              id: `c-opp-${i}`,
              controller: 'p2',
              type_line: 'Creature — Human',
            })),
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'one or more of them entered from exile or was cast from exile',
        lastMovedCards: [{ enteredFromZone: 'exile' }],
        nextState: {} as GameState,
      })
    ).toBe(true);
  });

  it('evaluates historic, damage, pirate vehicle, modified death, unearth, counters', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've cast a historic spell this turn",
        nextState: { historicSpellsCastThisTurn: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was dealt damage this turn',
        nextState: {} as GameState,
        lastMovedCards: [{ tookDamageThisTurn: true }],
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a pirate and a vehicle attacked this combat',
        nextState: {
          battlefield: [
            { id: 'pirate-1', controller: controllerId, type_line: 'Creature — Pirate', attacking: 'p2' },
            { id: 'vehicle-1', controller: controllerId, type_line: 'Artifact — Vehicle', attacking: 'p2' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a modified creature died under your control this turn',
        nextState: { modifiedCreaturesDiedThisTurnByController: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are thirteen or more creatures on the battlefield',
        nextState: {
          battlefield: new Array(13).fill(null).map((_, i) => ({
            id: `c-${i}`,
            controller: controllerId,
            type_line: 'Creature — Human',
          })),
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature has one or more +1/+1 counters on it',
        nextState: {
          battlefield: [{ id: 'bf-prodigy', controller: controllerId, type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-prodigy' },
      })
    ).toBe(true);
  });

  it('evaluates wolf strike modify_pt path, guardian project, soul search mv, no ltb', () => {
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
        normalizedRaw:
          "it doesn't have the same name as another creature you control or a creature card in your graveyard",
        nextState: {
          players: [{ id: 'p1', graveyard: [] }],
          battlefield: [{ id: 'bf-entry', controller: controllerId, type_line: 'Creature — Elf', name: 'Elvish Mystic' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-entry', thisCreatureId: 'bf-entry' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "the card's mana value is 1 or less",
        lastMovedCards: [{ manaValue: 1 }],
        nextState: {} as GameState,
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
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "Draw three cards. Then discard a card unless you waterbend {2}." },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, waterbendWasPaid: true },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });
});
