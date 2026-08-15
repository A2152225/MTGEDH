import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const ASHCOAT_END =
  'At the beginning of your end step, you may mill four cards. If you do, return up to two Rat creature cards from your graveyard to your hand.';
const FLORIAN_MAIN =
  'At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards and put the rest on the bottom of your library in a random order. You may play the exiled card this turn.';
const COURT_UPKEEP =
  "At the beginning of your upkeep, any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead.";
const CRUCIBLE_END =
  'At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost.';

function collectTriggerSteps(oracleText: string, cardName: string) {
  const ir = parseOracleTextToIR(oracleText, cardName);
  const ability = ir.abilities.find((entry) => /at the beginning/i.test(String(entry.text || entry.effectText || '')))
    ?? ir.abilities[0];
  return ability?.steps || [];
}

function makeCard(id: string, name: string, typeLine: string, zone: string) {
  return { id, name, type_line: typeLine, zone };
}

function baseState(overrides?: Partial<GameState> & { monarch?: string }): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 3,
    monarch: overrides?.monarch,
    lifeLostThisTurn: { [p1]: 0, [p2]: 3 },
    players: [
      {
        id: p1,
        name: 'P1',
        life: 40,
        library: [
          makeCard('lib0', 'Look A', 'Instant', 'library'),
          makeCard('lib1', 'Look B', 'Instant', 'library'),
          makeCard('lib2', 'Look C', 'Instant', 'library'),
          makeCard('lib3', 'Look D', 'Instant', 'library'),
          makeCard('lib4', 'Look E', 'Instant', 'library'),
          makeCard('lib5', 'Look F', 'Instant', 'library'),
          makeCard('lib6', 'Look G', 'Instant', 'library'),
          makeCard('lib7', 'Look H', 'Instant', 'library'),
          makeCard('lib8', 'Look I', 'Instant', 'library'),
          makeCard('lib9', 'Look J', 'Instant', 'library'),
        ],
        graveyard: [],
        hand: [],
        exile: [],
      },
      {
        id: p2,
        name: 'P2',
        life: 40,
        library: Array.from({ length: 12 }, (_, i) => makeCard(`p2lib${i}`, `P2 Card ${i}`, 'Instant', 'library')),
        graveyard: [],
        hand: [],
        exile: [],
      },
    ],
    battlefield: [],
    stack: [],
    ...overrides,
  } as unknown as GameState;
}

describe('phase-trigger follow-on sentences', () => {
  it('parses Ashcoat if-you-do graveyard return after optional mill', () => {
    const steps = collectTriggerSteps(ASHCOAT_END, 'Ashcoat of the Shadow Swarm');
    expect(steps[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 4 },
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect((steps[1] as any).steps?.[0]).toMatchObject({
      kind: 'move_zone',
      to: 'hand',
      what: { kind: 'raw', text: 'up to two Rat creature cards from your graveyard' },
    });
  });

  it('returns up to two Rat creature cards after accepting the optional mill', () => {
    const steps = collectTriggerSteps(ASHCOAT_END, 'Ashcoat of the Shadow Swarm');
    const ratA = makeCard('rat_a', 'Rat Colony', 'Creature — Rat', 'graveyard');
    const ratB = makeCard('rat_b', 'Pack Rat', 'Creature — Rat', 'graveyard');
    const bear = makeCard('bear_1', 'Grizzly Bears', 'Creature — Bear', 'graveyard');
    const state = baseState();
    (state.players[0] as any).graveyard = [ratA, ratB, bear];

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'ashcoat-1',
        sourceName: 'Ashcoat of the Shadow Swarm',
        selectorContext: { chosenObjectIds: ['rat_a', 'rat_b'] },
      }),
      { allowOptional: true },
    );

    const p1 = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect(p1.hand.map((card: any) => card.id).sort()).toEqual(['rat_a', 'rat_b']);
    expect(p1.graveyard.map((card: any) => card.id)).toContain('bear_1');
    expect(p1.graveyard).toHaveLength(5);
    expect(p1.library).toHaveLength(6);
  });

  it('parses Florian look-top X plus exile-one-rest-bottom as look_choose_from_top', () => {
    const steps = collectTriggerSteps(FLORIAN_MAIN, 'Florian, Voldaren Scion');
    expect(steps[0]).toMatchObject({
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: 'the total amount of life your opponents lost this turn' },
      destination: 'exile',
      selectorText: 'one of those cards',
    });
    expect(String((steps[0] as any).raw || '')).toMatch(/life your opponents lost this turn/i);
    expect(steps.some((step) => step.kind === 'grant_exile_permission')).toBe(true);
    expect(steps.some((step) => step.kind === 'exile')).toBe(false);
  });

  it('exiles one looked card and puts the rest on the bottom for Florian X', () => {
    const steps = collectTriggerSteps(FLORIAN_MAIN, 'Florian, Voldaren Scion');
    const state = baseState();
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'florian-1',
        sourceName: 'Florian, Voldaren Scion',
        selectorContext: { chosenObjectIds: ['lib0'] },
      }),
    );

    const p1 = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect(p1.exile.map((card: any) => card.id)).toEqual(['lib0']);
    expect(p1.library.map((card: any) => card.id)).not.toContain('lib0');
    expect(p1.library).toHaveLength(9);
    expect(p1.library.slice(0, 7).map((card: any) => card.id)).toEqual([
      'lib3', 'lib4', 'lib5', 'lib6', 'lib7', 'lib8', 'lib9',
    ]);
  });

  it('parses Court of Cunning monarch mill replacement from a bare effect clause', () => {
    const steps = parseOracleTextToIR(
      "any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead.",
      'Court of Cunning',
    ).abilities.flatMap((ability) => ability.steps || []);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
    });
  });

  it('parses Court of Cunning monarch mill replacement as a conditional mill', () => {
    const steps = collectTriggerSteps(COURT_UPKEEP, 'Court of Cunning');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
    });
    expect((steps[0] as any).steps?.[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'any_number_of_target_players' },
      amount: { kind: 'number', value: 10 },
    });
    expect((steps[0] as any).elseSteps?.[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'any_number_of_target_players' },
      amount: { kind: 'number', value: 2 },
    });
  });

  it('mills two when not monarch and ten when monarch', () => {
    const steps = collectTriggerSteps(COURT_UPKEEP, 'Court of Cunning');
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'court-1',
      sourceName: 'Court of Cunning',
      selectorContext: { chosenObjectIds: ['p2'] },
    });

    const notMonarch = applyOracleIRStepsToGameState(baseState({ monarch: 'p2' }), steps, ctx);
    const monarch = applyOracleIRStepsToGameState(baseState({ monarch: 'p1' }), steps, ctx);

    const p2Not = (notMonarch.state as any).players.find((entry: any) => entry.id === 'p2');
    const p2Yes = (monarch.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2Not.graveyard).toHaveLength(2);
    expect(p2Yes.graveyard).toHaveLength(10);
  });

  it('parses Crucible random graveyard exile as copy of the last moved card', () => {
    const steps = collectTriggerSteps(CRUCIBLE_END, 'Wondrous Crucible');
    expect(steps[0]).toMatchObject({ kind: 'mill', amount: { kind: 'number', value: 2 } });
    expect(steps[1]).toMatchObject({
      kind: 'move_zone',
      to: 'exile',
      what: { kind: 'raw', text: 'a nonland card at random from your graveyard' },
    });
    expect(steps.some((step) => step.kind === 'copy_spell' && (step as any).subject === 'last_moved_card')).toBe(true);
  });

  it('exiles a random nonland after milling and copies that card', () => {
    const steps = collectTriggerSteps(CRUCIBLE_END, 'Wondrous Crucible');
    const bolt = makeCard('bolt_1', 'Lightning Bolt', 'Instant', 'graveyard');
    const state = baseState();
    (state.players[0] as any).graveyard = [bolt];

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'crucible-1',
        sourceName: 'Wondrous Crucible',
      }),
      { allowOptional: true },
    );

    const p1 = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect(p1.library).toHaveLength(8);
    expect(p1.graveyard.length + p1.exile.length).toBe(3);
    expect(p1.exile.length).toBeGreaterThanOrEqual(1);
    expect(result.appliedSteps.some((step) => step.kind === 'move_zone' || step.kind === 'copy_spell')).toBe(true);
  });
});
