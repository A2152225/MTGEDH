import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';

describe('deferred IR gaps: Ooze / Fault / Rift', () => {
  it('splits Scavenging Ooze add_counter + gain_life and applies both after creature exile', () => {
    const text =
      '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.';
    const parsed = parseOracleTextToIR(text, 'Scavenging Ooze');
    const steps = parsed.abilities?.[0]?.steps || [];
    const conditional = steps.find((step: any) => step.kind === 'conditional') as any;
    const inner = conditional?.steps || conditional?.then || [];
    expect(inner.map((step: any) => step.kind)).toEqual(['add_counter', 'gain_life']);
    expect(inner[0].target?.text).toBe('this creature');

    const gyCreature = {
      id: 'gy1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      power: '2',
      toughness: '2',
    };
    const ooze = {
      id: 'src1',
      name: 'Scavenging Ooze',
      type_line: 'Creature — Ooze',
      controller: 'p1',
      owner: 'p1',
      counters: {},
      card: { id: 'src1c', name: 'Scavenging Ooze', type_line: 'Creature — Ooze' },
    };
    const state: any = {
      battlefield: [ooze],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [] },
        p2: { hand: [], graveyard: [gyCreature], exile: [], library: [] },
      },
      stack: [],
    };
    const result = applyOracleIRStepsToGameState(
      state,
      steps as any,
      {
        controllerId: 'p1',
        sourceId: 'src1',
        sourceName: 'Scavenging Ooze',
        targetCardId: 'gy1',
        chosenObjectIds: ['gy1'],
        selectorContext: { chosenObjectIds: ['gy1'] },
      } as any,
      { allowOptional: true },
    );
    // Conditional wrapper is omitted from appliedSteps when its branch applied work.
    expect(result.appliedSteps?.map((step: any) => step.kind)).toEqual([
      'move_zone',
      'add_counter',
      'gain_life',
    ]);
    expect(result.skippedSteps || []).toHaveLength(0);
    expect(result.state?.battlefield?.[0]?.counters?.['+1/+1']).toBe(1);
    expect(result.state?.players?.[0]?.life).toBe(41);
  });

  it('destroys bound target nonbasic land an opponent controls (Volatile Fault)', () => {
    const text =
      'Destroy target nonbasic land an opponent controls. That player may search their library for a basic land card, put it onto the battlefield, then shuffle. You create a Treasure token.';
    const parsed = parseOracleTextToIR(text, 'Volatile Fault');
    const steps = parsed.abilities?.[0]?.steps || [];
    const land = {
      id: 'land1',
      controller: 'p2',
      owner: 'p2',
      card: { id: 'land1c', name: 'Steam Vents', type_line: 'Land — Island Mountain' },
    };
    const fault = {
      id: 'src1',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'src1c', name: 'Volatile Fault', type_line: 'Land — Cave' },
    };
    const state: any = {
      battlefield: [fault, land],
      players: [
        { id: 'p1', life: 40, library: [] },
        { id: 'p2', life: 40, library: [{ id: 'b1', name: 'Island', type_line: 'Basic Land — Island' }] },
      ],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [] },
        p2: {
          hand: [],
          graveyard: [],
          exile: [],
          library: [{ id: 'b1', name: 'Island', type_line: 'Basic Land — Island' }],
        },
      },
      stack: [],
    };
    const result = applyOracleIRStepsToGameState(
      state,
      steps as any,
      {
        controllerId: 'p1',
        sourceId: 'src1',
        sourceName: 'Volatile Fault',
        targets: ['land1'],
        targetIds: ['land1'],
        chosenObjectIds: ['land1'],
      } as any,
      { allowOptional: true },
    );
    expect(result.appliedSteps?.map((step: any) => step.kind)).toEqual(
      expect.arrayContaining(['destroy', 'search_library', 'create_token']),
    );
    expect(result.skippedSteps || []).toHaveLength(0);
    const names = (result.state?.battlefield || []).map((perm: any) => perm?.card?.name);
    expect(names).not.toContain('Steam Vents');
    expect(names).toContain('Treasure');
  });

  it('inserts Underdark Rift targets just beneath the top X library cards', () => {
    const text =
      "Roll a d10. Put target artifact, creature, or planeswalker into its owner's library just beneath the top X cards of that library, where X is the result.";
    const parsed = parseOracleTextToIR(text, 'Underdark Rift');
    const steps = parsed.abilities?.[0]?.steps || [];
    const art = {
      id: 'bf1',
      controller: 'p2',
      owner: 'p2',
      card: { id: 'bf1c', name: 'Sol Ring', type_line: 'Artifact' },
    };
    const rift = {
      id: 'src1',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'src1c', name: 'Underdark Rift', type_line: 'Land' },
    };
    const lib = Array.from({ length: 10 }, (_, i) => ({
      id: `L${i}`,
      name: `Card${i}`,
      type_line: 'Creature — Test',
    }));
    const state: any = {
      battlefield: [rift, art],
      players: [
        { id: 'p1', life: 40, library: [] },
        { id: 'p2', life: 40, library: lib },
      ],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [] },
        p2: { hand: [], graveyard: [], exile: [], library: [...lib] },
      },
      stack: [],
    };
    const result = applyOracleIRStepsToGameState(
      state,
      steps as any,
      {
        controllerId: 'p1',
        sourceId: 'src1',
        sourceName: 'Underdark Rift',
        targetPermanentId: 'bf1',
        chosenObjectIds: ['bf1'],
        selectorContext: { chosenObjectIds: ['bf1'] },
        dieRollResult: 3,
      } as any,
      { allowOptional: true },
    );
    expect(result.appliedSteps?.map((step: any) => step.kind)).toEqual(['roll_die', 'move_zone']);
    expect(result.skippedSteps || []).toHaveLength(0);
    const libraryIds = (result.state?.players || [])
      .find((player: any) => player.id === 'p2')
      ?.library?.map((card: any) => card.id);
    expect(libraryIds).toHaveLength(11);
    expect(libraryIds.slice(0, 3)).toEqual(['L0', 'L1', 'L2']);
    expect(libraryIds[3]).toBe('bf1');
    expect((result.state?.battlefield || []).map((perm: any) => perm?.card?.name)).toEqual(['Underdark Rift']);
  });
});
