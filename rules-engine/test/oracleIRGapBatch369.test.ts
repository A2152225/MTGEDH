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

describe('Oracle IR gap batch 369 — 36 condition clusters', () => {
  it('evaluates life, drizzt power, land gy, walls, exact life, goblin or orc', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'your life total is less than 7',
        nextState: { players: [{ id: controllerId, life: 6 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it had power greater than drizzt's power",
        nextState: {
          battlefield: [{ id: 'bf-drizzt', controller: controllerId, type_line: 'Legendary Creature', power: 3 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-drizzt' },
        lastMovedCards: [{ power: 5 }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a land you controlled was put into a graveyard from the battlefield this turn',
        nextState: { landYouControlledPutIntoGraveyardFromBattlefieldThisTurn: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'defending player controls no walls',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Dragon', attacking: 'p2' },
            { id: 'bf-human', controller: 'p2', type_line: 'Creature — Human' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', defendingPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have exactly 13 life',
        nextState: { players: [{ id: controllerId, life: 13 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's a goblin or orc",
        nextState: {
          battlefield: [{ id: 'bf-goblin', controller: controllerId, type_line: 'Creature — Goblin' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-goblin' },
      })
    ).toBe(true);
  });

  it('evaluates enchanted wolf, pelt collector, gy creature, player spell, green or white', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature is a wolf or werewolf',
        nextState: {
          battlefield: [
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-wolf' },
            { id: 'bf-wolf', controller: controllerId, type_line: 'Creature — Wolf' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-aura' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that creature's power is greater than this creature's",
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', power: 2 },
            { id: 'bf-entering', controller: controllerId, type_line: 'Creature — Bear', power: 4 },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetCreatureId: 'bf-entering' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a creature card was put into your graveyard from anywhere this turn',
        nextState: { creatureCardPutIntoYourGraveyardThisTurn: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that player didn't cast a creature spell this turn",
        nextState: { spellsCastThisTurn: [{ casterId: 'p2', card: { type_line: 'Instant' } }] } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', thatPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a green or white permanent',
        nextState: {
          battlefield: [{ id: 'bf-green', controller: controllerId, type_line: 'Creature — Elf', colors: ['G'] }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates draw count, one attacker, no black, orvar targets, gift, counter', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent drew three or more cards this turn',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }],
          cardsDrawnThisTurn: { p1: 0, p2: 3 },
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'exactly one creature is attacking',
        nextState: {
          battlefield: [{ id: 'bf-atk', controller: controllerId, type_line: 'Creature — Soldier', attacking: true }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'defending player controls no black permanents',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Spirit', attacking: 'p2' },
            { id: 'bf-green', controller: 'p2', type_line: 'Creature — Elf', colors: ['G'] },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', defendingPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it targets one or more other permanents you control',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Shapeshifter' },
            { id: 'bf-other', controller: controllerId, type_line: 'Creature — Bear' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', stackItem: { targets: ['bf-other'] } },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "the gift was promised and that creature isn't legendary" },
        nextState: {
          battlefield: [{ id: 'bf-zombie', controller: controllerId, type_line: 'Creature — Zombie' }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', giftPromised: true, targetPermanentId: 'bf-zombie' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has a counter on it',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
      })
    ).toBe(true);
  });

  it('evaluates wild mammoth, beacon, initiative, gy this way, colors, neither, avatar, spectacle, trap, carpet', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a player controls more creatures than each other player',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }, { id: 'p3' }],
          battlefield: [
            { id: 'c1', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p3', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p3', type_line: 'Creature — Human' },
            { id: 'c4', controller: 'p3', type_line: 'Creature — Human' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this artifact has loyalty counters on it',
        nextState: {
          battlefield: [{ id: 'bf-beacon', controller: controllerId, type_line: 'Artifact', counters: { loyalty: 2 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-beacon' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you or a player you're attacking has the initiative" },
        nextState: {
          initiative: controllerId,
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Soldier', attacking: 'p2' }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a creature card is put into a graveyard this way',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Creature — Zombie' }],
        lastActionOutcome: { kind: 'applied', stepKind: 'destroy' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature was green or white',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Creature — Elf', colors: ['G'] }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control neither creature',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }, { id: 'p3' }],
          battlefield: [
            { id: 'bf-a', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'bf-b', controller: 'p3', type_line: 'Creature — Bear' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-a', secondTargetPermanentId: 'bf-b' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are ten or more creature cards total in all graveyards',
        nextState: {
          players: [
            { id: controllerId, graveyard: new Array(5).fill({ type_line: 'Creature — Zombie' }) },
            { id: 'p2', graveyard: new Array(5).fill({ type_line: 'Creature — Zombie' }) },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its spectacle cost was paid',
        nextState: { stack: [{ id: 'stack-spell-1', alternateCostId: 'spectacle' }] } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1', stackItem: { alternateCostId: 'spectacle' } },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'a creature spell you cast this turn was countered by a spell or ability an opponent controlled',
        nextState: { creatureSpellsCounteredByOpponentThisTurn: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you haven't added mana with this ability this turn",
        nextState: { addedManaWithThisAbilityThisTurn: { [controllerId]: {} } } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', abilityId: '0' },
      })
    ).toBe(true);
  });

  it('evaluates batch368 carryover fixtures: grim reminder, ramses, legendary sacrifice, nonred', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'each opponent who cast a spell this turn with the same name as that card',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }],
          spellsCastThisTurn: [{ casterId: 'p2', name: 'Lightning Bolt' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', referencedCardName: 'Lightning Bolt' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they were attacked this turn by an assassin you controlled',
        nextState: { attackedByAssassinThisTurnByPlayer: { [controllerId]: { p2: true } } } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', thatPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed artifact was legendary',
        ctx: { controllerId, sourceId: 'bf-source', lastSacrificedPermanents: [{ type_line: 'Legendary Artifact' }] },
        nextState: {} as GameState,
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a nonred permanent is dealt damage this way',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Artifact', colors: ['U'] }],
        lastActionOutcome: { kind: 'applied', stepKind: 'deal_damage' },
      })
    ).toBe(true);
  });
});
