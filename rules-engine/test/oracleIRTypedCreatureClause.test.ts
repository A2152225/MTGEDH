import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';
import { cardMatchesType, parseSimpleCardTypeFromText } from '../src/oracleIRExecutorZoneOpsCardTypeMatchers';

const controllerId = 'p1' as PlayerID;
const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('generic typed-creature N conditionals', () => {
  it('evaluates a [type] is dealt damage this way for Elf, not only Dinosaur', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an elf is dealt damage this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastDamagedCards: [{ type_line: 'Creature — Elf Warrior' }] },
      }),
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an elf is dealt damage this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastDamagedCards: [{ type_line: 'Creature — Bear' }] },
      }),
    ).toBe(false);
  });

  it('evaluates a [type] is sacrificed this way for Saproling the same as Goblin', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a saproling is sacrificed this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Creature — Saproling' }] },
      }),
    ).toBe(true);
  });

  it('evaluates a [type] was exiled this way for Pirate', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a merfolk was exiled this way',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Creature — Merfolk' }],
        lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
      }),
    ).toBe(true);
  });

  it('evaluates a [type] is attacking for Goblin, not only Rat', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a goblin is attacking',
        nextState: {
          battlefield: [{ id: 'g1', controller: controllerId, type_line: 'Creature — Goblin', attacking: true }],
        } as GameState,
      }),
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a goblin is attacking',
        nextState: {
          battlefield: [{ id: 'b1', controller: controllerId, type_line: 'Creature — Bear', attacking: true }],
        } as GameState,
      }),
    ).toBe(false);
  });

  it('evaluates this creature is a [type] for Angel and Elf', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is an elf',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elf' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      }),
    ).toBe(true);
  });

  it('evaluates that mana is spent on a [type] creature spell for Dragon and Goblin', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that mana is spent on a goblin creature spell',
        nextState: {} as GameState,
        ctx: { controllerId, stackItem: { type_line: 'Creature — Goblin' } },
      }),
    ).toBe(true);
  });

  it('parses non-[type] creature as a generic simple card type', () => {
    expect(parseSimpleCardTypeFromText('non-elf creature')).toBe('non_elf_creature');
    expect(parseSimpleCardTypeFromText('non-dragon creature')).toBe('non_dragon_creature');
    expect(cardMatchesType({ type_line: 'Creature — Elf' }, 'non_elf_creature')).toBe(false);
    expect(cardMatchesType({ type_line: 'Creature — Bear' }, 'non_elf_creature')).toBe(true);
  });

  it('evaluates another [type] entered this turn without using a Human-only map', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'another goblin entered the battlefield under your control this turn',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Goblin', enteredThisTurn: false },
            { id: 'g2', controller: controllerId, type_line: 'Creature — Goblin', enteredThisTurn: true },
          ],
        } as GameState,
      }),
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'another goblin entered the battlefield under your control this turn',
        nextState: {
          humansEnteredBattlefieldUnderControlThisTurn: { [controllerId]: true },
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Goblin', enteredThisTurn: false },
            { id: 'h1', controller: controllerId, type_line: 'Creature — Human', enteredThisTurn: true },
          ],
        } as GameState,
      }),
    ).toBe(false);
  });

  it('evaluates it is not a [type] and enchanted creature is a [type] or [type]', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's not a spirit",
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elf' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', referencedObjectId: 'bf-source' },
      }),
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature is a wolf or werewolf',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'c1' },
            { id: 'c1', controller: controllerId, type_line: 'Creature — Wolf' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      }),
    ).toBe(true);
  });

  it('evaluates graveyard [type] card plus a -1/-1 counter', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there is an elf card in your graveyard and this creature has a -1/-1 counter on it',
        nextState: {
          players: [{ id: controllerId, graveyard: [{ type_line: 'Creature — Elf' }] }],
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elf', counters: { '-1/-1': 1 } }],
        } as GameState,
      }),
    ).toBe(true);
  });
});
