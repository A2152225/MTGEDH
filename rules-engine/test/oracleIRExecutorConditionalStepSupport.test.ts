import { describe, expect, it } from 'vitest';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';

describe('oracleIRExecutorConditionalStepSupport', () => {
  it('treats contextual battlefield type checks as current-state permanent checks', () => {
    const state = {
      id: 'game1',
      format: 'commander',
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      startingLife: 40,
      life: {},
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
      battlefield: [
        {
          id: 'target-perm',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Transmuted Blessing',
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          effectiveTypes: ['Enchantment', 'Artifact'],
          tapped: false,
          counters: {},
        },
      ],
      commandZone: {},
      phase: 'pre_game',
      active: true,
    } as any;

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'that permanent is an artifact' } as any,
      nextState: state,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', targetPermanentId: 'target-perm' } as any,
      lastActionOutcome: null,
    });

    expect(result).toBe(true);
  });

  it('treats "you do" as false when the antecedent optional action did not apply', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you do' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
      lastStepOutcome: { kind: 'unsupported', stepKind: 'pay_mana' },
    });
    expect(result).toBe(false);
  });

  it('treats "you search your library this way" as true after an applied library search', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you search your library this way' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: { kind: 'applied', stepKind: 'search_library' },
    });
    expect(result).toBe(true);
  });

  it('evaluates persist-style counter checks on the referenced source', () => {
    const state = {
      players: [{ id: 'p1', graveyard: [], hand: [], library: [], exile: [], life: 40 }],
      battlefield: [
        {
          id: 'bf-source',
          controller: 'p1',
          type_line: 'Creature',
          counters: {},
        },
      ],
    } as any;

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'it had no -1/-1 counters on it' } as any,
      nextState: state,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', sourceId: 'bf-source' } as any,
      lastActionOutcome: null,
    });

    expect(result).toBe(true);
  });

  it('evaluates milled-this-way land checks from ctx.lastMilledCards', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'a land card was milled this way' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: {
        controllerId: 'p1',
        lastMilledCards: [{ type_line: 'Basic Land — Forest' }],
      } as any,
      lastActionOutcome: { kind: 'applied', stepKind: 'mill' },
    });
    expect(result).toBe(true);
  });

  it('evaluates ability resolve count thresholds from ctx', () => {
    const second = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'this is the second time this ability has resolved this turn' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', abilityResolveCountThisTurn: 2 } as any,
      lastActionOutcome: null,
    });
    expect(second).toBe(true);
  });

  it('evaluates revolt-style permanent-left checks from game state', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'a permanent left the battlefield under your control this turn' } as any,
      nextState: { permanentLeftBattlefieldThisTurn: { p1: true } } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(result).toBe(true);
  });

  it('evaluates raid and greatest-power battlefield checks', () => {
    const raid = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you attacked this turn' } as any,
      nextState: {
        battlefield: [{ id: 'c1', controller: 'p1', type_line: 'Creature', attackedThisTurn: true }],
      } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(raid).toBe(true);

    const greatestPower = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you control the creature with the greatest power or tied for the greatest power' } as any,
      nextState: {
        battlefield: [
          { id: 'c1', controller: 'p1', type_line: 'Creature', power: 5 },
          { id: 'c2', controller: 'p2', type_line: 'Creature', power: 2 },
        ],
      } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(greatestPower).toBe(true);
  });

  it('evaluates hand-this-way negatives from look-choose antecedents', () => {
    const didNotPut = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "you didn't put a card into your hand this way" } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: { kind: 'applied', stepKind: 'look_choose_from_top' },
      lastMovedCards: [],
    });
    expect(didNotPut).toBe(true);
  });

  it('evaluates party, poison, kicked, and exile-this-way checks', () => {
    const partyState = {
      players: [{ id: 'p1', hand: [], library: [], graveyard: [], exile: [], life: 40 }],
      battlefield: [
        { id: 'c1', controller: 'p1', type_line: 'Creature — Human Cleric' },
        { id: 'c2', controller: 'p1', type_line: 'Creature — Human Rogue' },
        { id: 'c3', controller: 'p1', type_line: 'Creature — Human Warrior' },
        { id: 'c4', controller: 'p1', type_line: 'Creature — Human Wizard' },
      ],
    } as any;
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you have a full party' } as any,
        nextState: partyState,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    const poison = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'an opponent has three or more poison counters' } as any,
      nextState: { players: [{ id: 'p1' }, { id: 'p2' }], poisonCounters: { p2: 3 } } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(poison).toBe(true);

    const kicked = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'it was kicked' } as any,
      nextState: { battlefield: [{ id: 'bf-source', controller: 'p1', wasKicked: true, type_line: 'Sorcery' }] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', sourceId: 'bf-source' } as any,
      lastActionOutcome: null,
    });
    expect(kicked).toBe(true);

    const exiledThisWay = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'a creature is put into exile this way' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
      lastMovedCards: [{ type_line: 'Creature — Bear' }],
    });
    expect(exiledThisWay).toBe(true);
  });

  it('evaluates spell mana value thresholds and leaves a bare you-don\'t unevaluable', () => {
    const spellMv = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "that spell's mana value is 5 or greater" } as any,
      nextState: { stack: [{ id: 'stack-spell-1', card: { cmc: 5 } }] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', referenceSpellManaValue: 5, targetSpellId: 'stack-spell-1' } as any,
      lastActionOutcome: null,
    });
    expect(spellMv).toBe(true);

    const youDont = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "you don't" } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    // Without an antecedent there is nothing the player could have declined, so this stays null and
    // the wrapper is reported as an unsupported-condition gap. Defaulting to true fired punisher
    // branches unprompted ("If you don't, sacrifice this artifact").
    expect(youDont).toBeNull();
  });

  it('evaluates hand-size, graveyard replacement, experience, and dice-doubles checks', () => {
    const handState = {
      players: [
        { id: 'p1', hand: [], library: [], graveyard: [], exile: [], life: 40 },
        { id: 'p2', hand: [{ id: 'h1' }, { id: 'h2' }], library: [], graveyard: [], exile: [], life: 40 },
      ],
      battlefield: [],
      experienceCounters: { p1: 6 },
    } as any;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you have no cards in hand' } as any,
        nextState: handState,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'an opponent has more cards in hand than you' } as any,
        nextState: handState,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'a card or token would be put into a graveyard from anywhere' } as any,
        nextState: handState,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "that card's mana value is less than or equal to the number of experience counters you have" } as any,
        nextState: {
          ...handState,
          players: [
            {
              id: 'p1',
              hand: [],
              library: [],
              graveyard: [{ id: 'gy-creature-1', type_line: 'Creature', cmc: 3 }],
              exile: [],
              life: 40,
            },
            handState.players[1],
          ],
        },
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', targetCreatureId: 'gy-creature-1' } as any,
        lastActionOutcome: { kind: 'applied', stepKind: 'choose_target_creature' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you rolled doubles' } as any,
        nextState: {
          lastDieRollByPlayer: {
            p1: { sides: 6, count: 2, result: 8, results: [4, 4] },
          },
        } as any,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: { kind: 'applied', stepKind: 'roll_die' },
      })
    ).toBe(true);
  });

  it('treats missing you-do antecedent as false', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you do' } as any,
      nextState: { players: [], battlefield: [] } as any,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
      lastStepOutcome: null,
    });
    expect(result).toBe(false);
  });

  it('evaluates batch-29 timing, antecedent, and power-threshold checks', () => {
    const state = {
      players: [{ id: 'p1', hand: [{ id: 'h1' }], library: [], graveyard: [], exile: [], life: 40 }],
      battlefield: [
        { id: 'c1', controller: 'p1', type_line: 'Creature', power: 8, attackedLastTurn: true },
        { id: 'c2', controller: 'p1', type_line: 'Creature', power: 4 },
      ],
      handAtBeginningOfTurn: { p1: 1 },
      combatPhasesThisTurn: { p1: 1 },
      creaturesDiedThisTurnByController: { p1: 1, p2: 2 },
      lastDieRollByPlayer: { p1: { result: 2, results: [2] } },
    } as any;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it's the first combat phase of your turn" } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', targetPermanentId: 'c1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it attacked during its controller's last turn" } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', targetPermanentId: 'c1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you control a creature with power 7 or greater' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that creature has power 4 or greater' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', targetPermanentId: 'c2' } as any,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'the result is 3 or less' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: { kind: 'applied', stepKind: 'roll_die' },
      })
    ).toBe(true);
  });

  it('does not split threshold comparisons on "or greater"', () => {
    const state = {
      id: 'game1',
      format: 'commander',
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] }],
      startingLife: 40,
      life: {},
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
      battlefield: [],
      commandZone: {},
      phase: 'main1',
      active: true,
    } as any;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "that spell's power is 4 or greater" } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(false);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'evidence was collected' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      })
    ).toBe(false);
  });

  it('treats "this spell was cast from a graveyard" from ctx.castFromZone even when the stack item source is not a zone', () => {
    const stackItem = {
      id: 'stack-sevinne',
      source: 'p1',
      castFromGraveyard: true,
      card: { name: "Sevinne's Reclamation", source: 'p1' },
    };
    const state = {
      players: [{ id: 'p1', graveyard: [], hand: [], library: [], exile: [], life: 40 }],
      battlefield: [],
      stack: [stackItem],
    } as any;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this spell was cast from a graveyard' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', sourceId: 'stack-sevinne', castFromZone: 'graveyard' } as any,
        lastActionOutcome: null,
      }),
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this spell was cast from a graveyard' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', sourceId: 'stack-sevinne', castFromZone: 'hand' } as any,
        lastActionOutcome: null,
      }),
    ).toBe(false);
  });

  it('falls back to flashback / castFromGraveyard flags when ctx.castFromZone is unset', () => {
    const stackItem = {
      id: 'stack-sevinne',
      source: 'p1',
      castFromGraveyard: true,
      card: { name: "Sevinne's Reclamation", castWithAbility: 'flashback' },
    };
    const state = {
      players: [{ id: 'p1', graveyard: [], hand: [], library: [], exile: [], life: 40 }],
      battlefield: [],
      stack: [stackItem],
    } as any;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this spell was cast from a graveyard' } as any,
        nextState: state,
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1', sourceId: 'stack-sevinne' } as any,
        lastActionOutcome: null,
      }),
    ).toBe(true);
  });
});