import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const PLANETARY_ANNIHILATION =
  'Each player chooses six lands they control, then sacrifices the rest. Planetary Annihilation deals 6 damage to each creature.';
const LIMITED_RESOURCES =
  "When this enchantment enters, each player chooses five lands they control and sacrifices the rest. Players can't play lands as long as ten or more lands are on the battlefield.";
const MYTHOS_OF_SNAPDAX =
  'Each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest. If {B}{R} was spent to cast this spell, you choose the permanents for each player instead.';
const BALANCE =
  'Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way.';

function spellSteps(oracleText: string, name: string) {
  return parseOracleTextToIR(oracleText, name).abilities.flatMap((ability) => ability.steps || []);
}

function land(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    card: { name: 'Plains', type_line: 'Basic Land — Plains' },
  };
}

function creature(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    damageMarked: 0,
    card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '7' },
  };
}

function board(landCount: number) {
  const battlefield = [
    ...Array.from({ length: landCount }, (_, index) => land(`p1-land-${index}`, 'p1')),
    ...Array.from({ length: landCount }, (_, index) => land(`p2-land-${index}`, 'p2')),
    creature('p1-giant', 'p1'),
    creature('p2-giant', 'p2'),
    { id: 'p1-rock', controller: 'p1', owner: 'p1', card: { name: 'Sol Ring', type_line: 'Artifact' } },
  ];
  return {
    players: [
      { id: 'p1', name: 'P1', hasLost: false },
      { id: 'p2', name: 'P2', hasLost: false },
    ],
    battlefield,
    stack: [],
  } as any;
}

describe('Planetary Annihilation choose-lands then sacrifice the rest', () => {
  it('parses a keep-lands choice plus 6 damage, not a controller-only sacrifice', () => {
    const steps = spellSteps(PLANETARY_ANNIHILATION, 'Planetary Annihilation');
    expect(steps.map((step) => step.kind)).toEqual([
      'each_player_choose_then_sacrifice_rest',
      'deal_damage',
    ]);
    expect(steps[0]).toMatchObject({
      choosers: { kind: 'each_player' },
      keepTypes: ['land'],
      keepCount: 6,
    });
  });

  it('parses Limited Resources as the same keep-lands choice', () => {
    const steps = spellSteps(LIMITED_RESOURCES, 'Limited Resources');
    const choice = steps.find((step) => step.kind === 'each_player_choose_then_sacrifice_rest');
    expect(choice).toMatchObject({ keepTypes: ['land'], keepCount: 5 });
    expect(steps.some((step) => step.kind === 'sacrifice')).toBe(false);
  });

  it('does not treat from-among or variable-count sacrifice as a fixed keep-N choice', () => {
    expect(spellSteps(MYTHOS_OF_SNAPDAX, 'Mythos of Snapdax').some(
      (step) => step.kind === 'each_player_choose_then_sacrifice_rest',
    )).toBe(false);
    expect(spellSteps(BALANCE, 'Balance').some(
      (step) => step.kind === 'each_player_choose_then_sacrifice_rest',
    )).toBe(false);
  });

  it('asks for a choice and leaves the board alone when someone controls more than six lands', () => {
    const steps = spellSteps(PLANETARY_ANNIHILATION, 'Planetary Annihilation');
    const state = board(7);
    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'pa',
      sourceName: 'Planetary Annihilation',
      sourceObjectType: 'spell',
    }, { haltOnPlayerChoiceRequired: true });

    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('sacrifice');
    expect(result.skippedSteps.map((step) => step.kind)).toContain('each_player_choose_then_sacrifice_rest');
    expect(result.pendingContinuationSteps?.map((step) => step.kind)).toEqual(['deal_damage']);
    expect(result.state.battlefield).toHaveLength(state.battlefield.length);
    expect((result.state.battlefield as any[]).find((permanent) => permanent.id === 'p1-giant').damageMarked).toBe(0);
  });

  it('sacrifices nothing and deals 6 damage when every player has six or fewer lands', () => {
    const steps = spellSteps(PLANETARY_ANNIHILATION, 'Planetary Annihilation');
    const result = applyOracleIRStepsToGameState(board(2), steps, {
      controllerId: 'p1',
      sourceId: 'pa',
      sourceName: 'Planetary Annihilation',
      sourceObjectType: 'spell',
    }, { haltOnPlayerChoiceRequired: true });

    const battlefield = result.state.battlefield as any[];
    expect(battlefield.filter((permanent) => String(permanent.card?.type_line || '').includes('Land'))).toHaveLength(4);
    expect(battlefield.find((permanent) => permanent.id === 'p1-rock')).toBeTruthy();
    expect(battlefield.find((permanent) => permanent.id === 'p1-giant').damageMarked).toBe(6);
    expect(battlefield.find((permanent) => permanent.id === 'p2-giant').damageMarked).toBe(6);
    expect(result.pendingContinuationSteps || []).toHaveLength(0);
  });
});
