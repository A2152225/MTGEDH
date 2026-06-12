import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess.js';

describe('oracle IR trigger PT bare fragment parse', () => {
  it('parses team pump and target pump as modify_pt', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
      power: 1,
      toughness: 1,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
      power: 2,
      toughness: 2,
    });
  });

  it('parses self pump and double target power as modify_pt', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'it gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
      power: 2,
      toughness: 2,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      "double target creature's power until end of turn.",
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
    });
  });

  it('parses compound team PT+keyword as modify_pt then grant', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'creatures you control get +1/+1 and gain vigilance until end of turn.',
    );
    expect(steps).toHaveLength(2);
    expect(steps?.[0]).toMatchObject({
      kind: 'modify_pt',
      power: 1,
      toughness: 1,
    });
    expect(steps?.[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      abilities: ['vigilance'],
      sequence: 'then',
    });
  });

  it('parses other-creatures pump, double P/T, and target cant block', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'other creatures you control get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
      power: 1,
      toughness: 1,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      "double target creature's power and toughness until end of turn.",
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      duration: 'end_of_turn',
    });
    expect(parseBareTriggerEffectFragmentSteps(
      "target creature can't block this turn.",
    )?.[0]).toMatchObject({
      kind: 'cant_block',
      duration: 'end_of_turn',
    });
  });

  it('parses each-creature and chosen-type compound pumps', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { text: 'each creature you control' },
    });
    const chosenTypeSteps = parseBareTriggerEffectFragmentSteps(
      'creatures you control of the chosen type get +1/+0 and gain haste until end of turn.',
    );
    expect(chosenTypeSteps?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gets +2/+2 and gains flying until end of turn.',
    )?.[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      abilities: ['flying'],
    });
  });

  it('parses prefix team compound, team have, and target-player compound', () => {
    const prefixSteps = parseBareTriggerEffectFragmentSteps(
      'until end of turn, creatures you control get +1/+1 and gain trample.',
    );
    expect(prefixSteps?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control have haste until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'grant_temporary_ability',
      abilities: ['haste'],
    });
    const velisVelSteps = parseBareTriggerEffectFragmentSteps(
      'creatures target player controls get +0/+1 and gain all creature types until end of turn.',
    );
    expect(velisVelSteps?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(velisVelSteps?.[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      effectText: ['all creature types'],
    });
  });

  it('parses each-other and those-creatures mass PT bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'each other creature you control gets +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each other creature you control' },
      power: 1,
      toughness: 1,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'Those creatures get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'those creatures' },
      power: 1,
      toughness: 1,
    });
  });

  it('parses qualified mass PT bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'attacking creatures you control get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'attacking creatures you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'Zombie creatures you control get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'zombie creatures you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'the creature that attacked gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'the creature that attacked' },
      power: 2,
      toughness: 2,
    });
  });

  it('parses antecedent, global, opponent, blocking, and prefix combat mass PT', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'they get +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'they' },
      power: 2,
      toughness: 2,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'the chosen creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'the chosen creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature gets +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      "each opponent's creatures get -1/-1 until end of turn.",
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: "each opponent's creatures" },
      power: -1,
      toughness: -1,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature blocking it gets +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each creature blocking it' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of combat, creatures you control get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'creatures you control' },
    });
    const compoundHaveSteps = parseBareTriggerEffectFragmentSteps(
      'creatures you control get +1/+1 and have trample until end of turn.',
    );
    expect(compoundHaveSteps?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(compoundHaveSteps?.[1]).toMatchObject({
      abilities: ['trample'],
    });
  });

  it('parses reference-creature and antecedent X mass PT bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'that creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'that creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'equipped creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'equipped creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'enchanted creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'enchanted creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'they get +X/+X until end of turn, where X is the number of creatures you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'they' },
      powerUsesX: true,
      toughnessUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of creatures you control' },
    });
  });

  it('executes they X pump against antecedent creature targets', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'they get +X/+X until end of turn, where X is the number of creatures you control.',
    );
    expect(steps?.[0]?.kind).toBe('modify_pt');
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { name: 'A', type_line: 'Creature — Human' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { name: 'B', type_line: 'Creature — Elf' } },
        { id: 'c', controller: 'p1' as PlayerID, card: { name: 'C', type_line: 'Creature — Wizard' } },
      ],
    } as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'a',
      lastAntecedentBattlefieldPermanentIds: ['a', 'b'],
    });
    const result = applyOracleIRStepsToGameState(state, steps!, ctx);
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    const permA = result.state.battlefield?.find((perm) => perm.id === 'a') as any;
    expect(permA?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 3,
    )).toBe(true);
  });

  it('parses team X, stampede compound X, global hand-scaled, flanking, and per-creature counter X', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'creatures you control' },
      powerUsesX: true,
      toughnessUsesX: true,
    });
    const stampedeSteps = parseBareTriggerEffectFragmentSteps(
      'Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.',
    );
    expect(stampedeSteps?.map((step) => step.kind)).toEqual(['grant_temporary_ability', 'modify_pt']);
    expect(parseBareTriggerEffectFragmentSteps(
      'all creatures get -X/-0 until end of turn, where X is the number of cards in your hand.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'all creatures' },
      powerUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'all attacking creatures with flanking get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'all attacking creatures with flanking' },
      power: 1,
      toughness: 1,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each creature you control' },
      powerUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'another target creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'another target creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature you control gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'target creature you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +X/+X until end of turn, where X is the greatest power among creatures you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the greatest power among creatures you control' },
    });
  });

  it('parses up-to-one-target, unblocked attacking, and prefix target compound bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'up to one target creature gets +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'up to one target creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'unblocked attacking creatures get +1/+0 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'unblocked attacking creatures' },
      power: 1,
      toughness: 0,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, target creature gets +2/+2 and gains flying.',
    )?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
  });

  it('executes per-creature counter X against each controlled creature independently', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    );
    expect(steps?.[0]?.kind).toBe('modify_pt');
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'countered', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, card: { type_line: 'Creature' } },
        { id: 'plain', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'countered',
    });
    const result = applyOracleIRStepsToGameState(state, steps!, ctx);
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    const countered = result.state.battlefield?.find((perm) => perm.id === 'countered') as any;
    const plain = result.state.battlefield?.find((perm) => perm.id === 'plain') as any;
    expect(countered?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(plain?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses multi-target, prefix self compound, and asymmetric each-creature X bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'one or two target creatures get +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'one or two target creatures' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gets +2/+2 and gains flying.',
    )?.map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: false,
    });
  });

  it('executes one-or-two-target pump against all chosen creature targets', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'one or two target creatures get +2/+2 until end of turn.',
    );
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'c', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'a',
      selectorContext: { chosenObjectIds: ['a', 'b'] },
    });
    const result = applyOracleIRStepsToGameState(state, steps!, ctx);
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['a', 'b']) {
      const perm = result.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(perm?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
      )).toBe(true);
    }
    const permC = result.state.battlefield?.find((entry) => entry.id === 'c') as any;
    expect(permC?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses target-player mass, exact-count multi-target, and scaled target bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures target player controls get +1/+1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'creatures target player controls' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'two target creatures get +2/+2 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'two target creatures' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature an opponent controls gets -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each attacking creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each attacking creature you control' },
    });
  });

  it('executes two-target pump against all chosen creature targets', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'two target creatures get +2/+2 until end of turn.',
    );
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'c', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'a',
      selectorContext: { chosenObjectIds: ['a', 'b'] },
    });
    const result = applyOracleIRStepsToGameState(state, steps!, ctx);
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['a', 'b']) {
      const perm = result.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(perm?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
      )).toBe(true);
    }
  });

  it('executes each-attacking counter X per attacking creature independently', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each attacking creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    );
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, attacking: true, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, attacking: true, card: { type_line: 'Creature' } },
        { id: 'c', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'a',
    });
    const result = applyOracleIRStepsToGameState(state, steps!, ctx);
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    const a = result.state.battlefield?.find((entry) => entry.id === 'a') as any;
    const b = result.state.battlefield?.find((entry) => entry.id === 'b') as any;
    expect(a?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(b?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses chosen, blocking, another-target, and opponent -X/-0 scaled bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'the chosen creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'the chosen creature' },
      powerUsesX: true,
      toughnessUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature blocking it gets -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each creature blocking it' },
      powerUsesX: true,
      toughnessUsesX: true,
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'another target creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'another target creature' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature an opponent controls gets -X/-0 until end of turn, where X is the number of cards in your hand.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: false,
    });
  });

  it('executes chosen-creature and blocking hand-scaled pumps', () => {
    const chosenSteps = parseBareTriggerEffectFragmentSteps(
      'the chosen creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    );
    const chosenState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'chosen', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const chosenResult = applyOracleIRStepsToGameState(
      chosenState,
      chosenSteps!,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'chosen',
        selectorContext: { chosenObjectIds: ['chosen'] },
      }),
    );
    expect(chosenResult.appliedSteps?.length).toBeGreaterThan(0);
    const chosen = chosenResult.state.battlefield?.find((entry) => entry.id === 'chosen') as any;
    expect(chosen?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);

    const blockingSteps = parseBareTriggerEffectFragmentSteps(
      'each creature blocking it gets -X/-X until end of turn, where X is the number of cards in your hand.',
    );
    const blockingState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID, hand: [{ id: 'h1' }, { id: 'h2' }] }],
      battlefield: [
        { id: 'src', controller: 'p1' as PlayerID, blockedBy: [{ blockerId: 'blocker' }], card: { type_line: 'Creature' } },
        { id: 'blocker', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const blockingResult = applyOracleIRStepsToGameState(
      blockingState,
      blockingSteps!,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
      }),
    );
    expect(blockingResult.appliedSteps?.length).toBeGreaterThan(0);
    const blocker = blockingResult.state.battlefield?.find((entry) => entry.id === 'blocker') as any;
    expect(blocker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -2 && entry?.toughness === -2,
    )).toBe(true);
  });

  it('parses reference-creature, attacked, and opponent scaled bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'that creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'the creature that attacked gets +X/+X until end of turn, where X is the number of Mountains you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'the creature that attacked' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each opponent\'s creatures get -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
  });

  it('executes greatest-power team pump and target its-toughness scaling', () => {
    const teamSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn, where X is the greatest power among creatures you control.',
    );
    const teamState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'small', controller: 'p1' as PlayerID, card: { type_line: 'Creature', power: 2 } },
        { id: 'big', controller: 'p1' as PlayerID, card: { type_line: 'Creature', power: 6 } },
      ],
    } as GameState;
    const teamResult = applyOracleIRStepsToGameState(
      teamState,
      teamSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'small' }),
    );
    expect(teamResult.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['small', 'big']) {
      const perm = teamResult.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(perm?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 6 && entry?.toughness === 6,
      )).toBe(true);
    }

    const targetSteps = parseBareTriggerEffectFragmentSteps(
      'target creature gets +X/+X until end of turn, where X is its toughness.',
    );
    const targetState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'tgt', controller: 'p2' as PlayerID, card: { type_line: 'Creature', power: 2, toughness: 5 } },
      ],
    } as GameState;
    const targetResult = applyOracleIRStepsToGameState(
      targetState,
      targetSteps!,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['tgt'] },
      }),
    );
    expect(targetResult.appliedSteps?.length).toBeGreaterThan(0);
    const tgt = targetResult.state.battlefield?.find((entry) => entry.id === 'tgt') as any;
    expect(tgt?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 5 && entry?.toughness === 5,
    )).toBe(true);
  });

  it('parses grant-keyword and asymmetric team-X bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +X/+0 until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control gain menace until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gains hexproof until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
  });

  it('executes per-creature its-power scaling independently', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn, where X is its power.',
    );
    const state = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'small', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 2, toughness: 5 },
        { id: 'big', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 6, toughness: 3 },
        { id: 'countered', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 1, toughness: 1, counters: { '+1/+1': 2 } },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      steps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'small' }),
    );
    expect(result.appliedSteps?.length).toBeGreaterThan(0);
    const expectMod = (id: string, power: number, toughness: number) => {
      const perm = result.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(perm?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === power && entry?.toughness === toughness,
      )).toBe(true);
    };
    expectMod('small', 2, 2);
    expectMod('big', 6, 6);
    expectMod('countered', 3, 3);
  });

  it('parses they/other asymmetric X and expanded grant bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'they get +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'other creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, target creature gets +X/+X, where X is its power.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'other creatures you control gain flying until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gains hexproof.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
  });

  it('executes per-creature its-toughness and each-attacking its-power scaling', () => {
    const toughnessSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn, where X is its toughness.',
    );
    const toughnessState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'small', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 2, toughness: 5 },
        { id: 'big', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 6, toughness: 3 },
      ],
    } as GameState;
    const toughnessResult = applyOracleIRStepsToGameState(
      toughnessState,
      toughnessSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'small' }),
    );
    expect(toughnessResult.appliedSteps?.length).toBeGreaterThan(0);
    const small = toughnessResult.state.battlefield?.find((entry) => entry.id === 'small') as any;
    const big = toughnessResult.state.battlefield?.find((entry) => entry.id === 'big') as any;
    expect(small?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 5 && entry?.toughness === 5,
    )).toBe(true);
    expect(big?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 3,
    )).toBe(true);

    const attackingSteps = parseBareTriggerEffectFragmentSteps(
      'each attacking creature you control gets +X/+X until end of turn, where X is its power.',
    );
    const attackingState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'attacker', controller: 'p1' as PlayerID, attacking: true, card: { type_line: 'Creature' }, power: 4, toughness: 2 },
        { id: 'bench', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 9, toughness: 9 },
      ],
    } as GameState;
    const attackingResult = applyOracleIRStepsToGameState(
      attackingState,
      attackingSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    expect(attackingResult.appliedSteps?.length).toBeGreaterThan(0);
    const attacker = attackingResult.state.battlefield?.find((entry) => entry.id === 'attacker') as any;
    const bench = attackingResult.state.battlefield?.find((entry) => entry.id === 'bench') as any;
    expect(attacker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 4 && entry?.toughness === 4,
    )).toBe(true);
    expect(bench?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses prefix self scaled X, pronoun grants, and qualified each-creature X bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'he gains flying until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'this creature gains lifelink until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control with a +1/+1 counter on it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
  });

  it('executes prefix self counter X and qualified each-creature counter X scaling', () => {
    const selfSteps = parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
    );
    const selfState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'src', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 2, toughness: 2, counters: { '+1/+1': 3 } },
      ],
    } as GameState;
    const selfResult = applyOracleIRStepsToGameState(
      selfState,
      selfSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(selfResult.appliedSteps?.length).toBeGreaterThan(0);
    const src = selfResult.state.battlefield?.find((entry) => entry.id === 'src') as any;
    expect(src?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 3,
    )).toBe(true);

    const qualifiedSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control with a +1/+1 counter on it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    );
    const qualifiedState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'countered', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, card: { type_line: 'Creature' } },
        { id: 'plain', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const qualifiedResult = applyOracleIRStepsToGameState(
      qualifiedState,
      qualifiedSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'countered' }),
    );
    expect(qualifiedResult.appliedSteps?.length).toBeGreaterThan(0);
    const countered = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'countered') as any;
    const plain = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'plain') as any;
    expect(countered?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(plain?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses reference grants, prefix team asymmetric X, and opponent mass bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'that creature gains hexproof until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'enchanted creature gains flying until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, creatures you control get +X/+0, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures your opponents control get -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control of the chosen type get +X/+X until end of turn, where X is the number of Mountains you control.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures with power 4 or greater you control get +1/+1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
  });

  it('executes prefix team hand-scaled, self suffix counter X, and power-qualified team pump', () => {
    const teamSteps = parseBareTriggerEffectFragmentSteps(
      'until end of turn, creatures you control get +X/+0, where X is the number of cards in your hand.',
    );
    const teamState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID, hand: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const teamResult = applyOracleIRStepsToGameState(
      teamState,
      teamSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'a' }),
    );
    expect(teamResult.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['a', 'b']) {
      const perm = teamResult.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(perm?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 0,
      )).toBe(true);
    }

    const selfSteps = parseBareTriggerEffectFragmentSteps(
      'it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    );
    const selfState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'src', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, counters: { '+1/+1': 2 } },
      ],
    } as GameState;
    const selfResult = applyOracleIRStepsToGameState(
      selfState,
      selfSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(selfResult.appliedSteps?.length).toBeGreaterThan(0);
    const src = selfResult.state.battlefield?.find((entry) => entry.id === 'src') as any;
    expect(src?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);

    const qualifiedSteps = parseBareTriggerEffectFragmentSteps(
      'creatures with power 4 or greater you control get +1/+1 until end of turn.',
    );
    const qualifiedState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'big', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 5, toughness: 5 },
        { id: 'small', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 2, toughness: 2 },
      ],
    } as GameState;
    const qualifiedResult = applyOracleIRStepsToGameState(
      qualifiedState,
      qualifiedSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'big' }),
    );
    expect(qualifiedResult.appliedSteps?.length).toBeGreaterThan(0);
    const big = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'big') as any;
    const small = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'small') as any;
    expect(big?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 1,
    )).toBe(true);
    expect(small?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses dont-control, prefix-each, qualified fixed, and compound target bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      "each creature you don't control gets -1/-1 until end of turn.",
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, each creature you control gets +1/+1.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control with power 4 or greater gets +1/+1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'the creature gets +2/+2 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature with flying gets +1/+1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gains hexproof and gets +1/+1 until end of turn.',
    )?.map((step) => step.kind)).toEqual(['grant_temporary_ability', 'modify_pt']);
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control with a +1/+1 counter on it gains trample until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
  });

  it('executes dont-control hand-scaled debuff and each power-4+ team pump', () => {
    const debuffSteps = parseBareTriggerEffectFragmentSteps(
      "each creature you don't control gets -X/-X until end of turn, where X is the number of cards in your hand.",
    );
    const debuffState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID, hand: [{ id: 'h1' }, { id: 'h2' }] }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'ally', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const debuffResult = applyOracleIRStepsToGameState(
      debuffState,
      debuffSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'ally' }),
    );
    expect(debuffResult.appliedSteps?.length).toBeGreaterThan(0);
    const opp = debuffResult.state.battlefield?.find((entry) => entry.id === 'opp') as any;
    const ally = debuffResult.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(opp?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -2 && entry?.toughness === -2,
    )).toBe(true);
    expect(ally?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();

    const qualifiedSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control with power 4 or greater gets +1/+1 until end of turn.',
    );
    const qualifiedState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'big', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 5, toughness: 5 },
        { id: 'small', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 2, toughness: 2 },
      ],
    } as GameState;
    const qualifiedResult = applyOracleIRStepsToGameState(
      qualifiedState,
      qualifiedSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'big' }),
    );
    expect(qualifiedResult.appliedSteps?.length).toBeGreaterThan(0);
    const big = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'big') as any;
    const small = qualifiedResult.state.battlefield?.find((entry) => entry.id === 'small') as any;
    expect(big?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 1,
    )).toBe(true);
    expect(small?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses all-dont-control and for-each scaler bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      "all creatures you don't control get -1/-1 until end of turn.",
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature gets +1/+1 until end of turn for each creature you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      scaler: { kind: 'reference_scaler', raw: 'for each creature you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +1/+1 until end of turn for each creature you control.',
    )?.[0]?.scaler).toMatchObject({ kind: 'reference_scaler', raw: 'for each creature you control' });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gets +1/+1 until end of turn for each creature you control.',
    )?.[0]?.target).toMatchObject({ kind: 'raw', text: 'target creature' });
  });

  it('executes all-dont-control debuff and per-target for-each counter scaling', () => {
    const allSteps = parseBareTriggerEffectFragmentSteps(
      "all creatures you don't control get -1/-1 until end of turn.",
    );
    const allState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'ally', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const allResult = applyOracleIRStepsToGameState(
      allState,
      allSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'ally' }),
    );
    expect(allResult.appliedSteps?.length).toBeGreaterThan(0);
    const opp = allResult.state.battlefield?.find((entry) => entry.id === 'opp') as any;
    const ally = allResult.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(opp?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -1 && entry?.toughness === -1,
    )).toBe(true);
    expect(ally?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();

    const counterSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +1/+1 until end of turn for each +1/+1 counter on it.',
    );
    const counterState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'countered', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, card: { type_line: 'Creature' } },
        { id: 'plain', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const counterResult = applyOracleIRStepsToGameState(
      counterState,
      counterSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'countered' }),
    );
    expect(counterResult.appliedSteps?.length).toBeGreaterThan(0);
    const countered = counterResult.state.battlefield?.find((entry) => entry.id === 'countered') as any;
    const plain = counterResult.state.battlefield?.find((entry) => entry.id === 'plain') as any;
    expect(countered?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(plain?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('parses scaled for-each and global each-creature where-X bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn for each +1/+1 counter on it.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: true,
      scaler: { kind: 'reference_scaler', raw: 'for each +1/+1 counter on it' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature gets +X/+X until end of turn, where X is the number of creatures you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of creatures you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +X/+0 until end of turn for each land you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      toughnessUsesX: false,
      scaler: { kind: 'reference_scaler', raw: 'for each land you control' },
    });
  });

  it('executes scaled for-each counter pump and global each-creature where-X', () => {
    const scaledSteps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +X/+X until end of turn for each +1/+1 counter on it.',
    );
    const scaledState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'countered', controller: 'p1' as PlayerID, counters: { '+1/+1': 2 }, card: { type_line: 'Creature' } },
        { id: 'plain', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const scaledResult = applyOracleIRStepsToGameState(
      scaledState,
      scaledSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'countered' }),
    );
    expect(scaledResult.appliedSteps?.length).toBeGreaterThan(0);
    const countered = scaledResult.state.battlefield?.find((entry) => entry.id === 'countered') as any;
    const plain = scaledResult.state.battlefield?.find((entry) => entry.id === 'plain') as any;
    expect(countered?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(plain?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();

    const globalSteps = parseBareTriggerEffectFragmentSteps(
      'each creature gets +X/+X until end of turn, where X is the number of creatures you control.',
    );
    const globalState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'c', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const globalResult = applyOracleIRStepsToGameState(
      globalState,
      globalSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'a' }),
    );
    expect(globalResult.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['a', 'b', 'c']) {
      const creature = globalResult.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(creature?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
      )).toBe(true);
    }
  });

  it('parses prefix-each for-each, all-creatures for-each, and static cost-reduction bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, each creature gets +X/+X, where X is the number of creatures you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of creatures you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, each creature gets +1/+1 for each creature you control.',
    )?.[0]?.scaler).toMatchObject({ kind: 'reference_scaler', raw: 'for each creature you control' });
    expect(parseBareTriggerEffectFragmentSteps(
      'all creatures get +X/+X until end of turn for each land you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      powerUsesX: true,
      scaler: { kind: 'reference_scaler', raw: 'for each land you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'noncreature spells you control cost {1} less to cast.',
    )?.[0]).toMatchObject({
      kind: 'grant_static_ability',
      effectText: ['cost {1} less to cast'],
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'instant and sorcery spells you cast this turn cost {1} less to cast.',
    )?.[0]?.kind).toBe('grant_static_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'activated abilities of creatures you control cost {2} less to activate.',
    )?.[0]).toMatchObject({
      kind: 'grant_static_ability',
      target: { kind: 'raw', text: 'creatures you control' },
    });
  });

  it('executes prefix-each for-each team pump and all-creatures land-scaled pump', () => {
    const prefixSteps = parseBareTriggerEffectFragmentSteps(
      'until end of turn, creatures you control get +1/+1 for each creature you control.',
    );
    const prefixState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        { id: 'a', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'b', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const prefixResult = applyOracleIRStepsToGameState(
      prefixState,
      prefixSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'a' }),
    );
    expect(prefixResult.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['a', 'b']) {
      const creature = prefixResult.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(creature?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
      )).toBe(true);
    }

    const allSteps = parseBareTriggerEffectFragmentSteps(
      'all creatures get +1/+1 until end of turn for each land you control.',
    );
    const allState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'c', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'land1', controller: 'p1' as PlayerID, card: { type_line: 'Land' } },
        { id: 'land2', controller: 'p1' as PlayerID, card: { type_line: 'Land' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const allResult = applyOracleIRStepsToGameState(
      allState,
      allSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'c' }),
    );
    expect(allResult.appliedSteps?.length).toBeGreaterThan(0);
    for (const id of ['c', 'opp']) {
      const creature = allResult.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(creature?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
      )).toBe(true);
    }
  });

  it('parses opponent for-each, prefix-all for-each, and extended cost-reduction bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      "each opponent's creatures get +1/+1 until end of turn for each creature you control.",
    )?.[0]?.scaler).toMatchObject({ kind: 'reference_scaler', raw: 'for each creature you control' });
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, all creatures get +1/+1 for each land you control.',
    )?.[0]).toMatchObject({ kind: 'modify_pt', target: { kind: 'raw', text: 'all creatures' } });
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature an opponent controls gets -1/-1 until end of turn for each card in your hand.',
    )?.[0]?.scaler).toMatchObject({ kind: 'reference_scaler', raw: 'for each card in your hand' });
    expect(parseBareTriggerEffectFragmentSteps(
      'this spell costs {1} less to cast for each creature you control.',
    )?.[0]).toMatchObject({ kind: 'grant_static_ability', target: { kind: 'raw', text: 'this spell' } });
    expect(parseBareTriggerEffectFragmentSteps(
      'the first instant or sorcery spell you cast each turn costs {1} less to cast for each land you control.',
    )?.[0]?.kind).toBe('grant_static_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'spells your opponents cast with the chosen name cost {2} more to cast.',
    )?.[0]?.effectText?.[0]).toContain('more to cast');
  });

  it('executes opponent for-each pump and opponent-creature hand-scaled debuff', () => {
    const oppMassSteps = parseBareTriggerEffectFragmentSteps(
      "each opponent's creatures get +1/+1 until end of turn for each creature you control.",
    );
    const oppMassState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'ally', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'buddy', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const oppMassResult = applyOracleIRStepsToGameState(
      oppMassState,
      oppMassSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'ally' }),
    );
    expect(oppMassResult.appliedSteps?.length).toBeGreaterThan(0);
    const opp = oppMassResult.state.battlefield?.find((entry) => entry.id === 'opp') as any;
    expect(opp?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);

    const oppEachSteps = parseBareTriggerEffectFragmentSteps(
      'each creature an opponent controls gets -1/-1 until end of turn for each card in your hand.',
    );
    const oppEachState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID, hand: [{}, {}, {}] }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'ally', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const oppEachResult = applyOracleIRStepsToGameState(
      oppEachState,
      oppEachSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'ally' }),
    );
    expect(oppEachResult.appliedSteps?.length).toBeGreaterThan(0);
    const debuffed = oppEachResult.state.battlefield?.find((entry) => entry.id === 'opp') as any;
    expect(debuffed?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -3 && entry?.toughness === -3,
    )).toBe(true);
  });

  it('parses opponent target/mass debuff, each-other-attacking, and keyword grant bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'each other attacking creature gets +1/+0 until end of turn.',
    )?.[0]).toMatchObject({ kind: 'modify_pt', target: { kind: 'raw', text: 'each other attacking creature' } });
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature an opponent controls gets -2/-0 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures your opponents control get -1/-1 until end of turn.',
    )?.[0]?.target).toMatchObject({ kind: 'raw', text: 'creatures your opponents control' });
    expect(parseBareTriggerEffectFragmentSteps(
      'this creature gets +X/+X until end of turn where X is the number of players being attacked.',
    )?.[0]?.powerUsesX).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'another target creature you control gains deathtouch until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'all creatures get -1/-1 until end of turn.',
    )?.[0]?.power).toBe(-1);
  });

  it('executes each-other-attacking pump, opponent mass debuff, and blocking scaler', () => {
    const battlecrySteps = parseBareTriggerEffectFragmentSteps(
      'each other attacking creature gets +1/+0 until end of turn.',
    );
    const battlecryState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'leader', controller: 'p1' as PlayerID, attacking: true, card: { type_line: 'Creature' } },
        { id: 'ally', controller: 'p1' as PlayerID, attacking: true, card: { type_line: 'Creature' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const battlecryResult = applyOracleIRStepsToGameState(
      battlecryState,
      battlecrySteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'leader' }),
    );
    expect(battlecryResult.appliedSteps?.length).toBeGreaterThan(0);
    const ally = battlecryResult.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 0,
    )).toBe(true);
    const leader = battlecryResult.state.battlefield?.find((entry) => entry.id === 'leader') as any;
    expect(leader?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();

    const massSteps = parseBareTriggerEffectFragmentSteps(
      'creatures your opponents control get -1/-1 until end of turn.',
    );
    const massState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      battlefield: [
        { id: 'source', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'opp', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const massResult = applyOracleIRStepsToGameState(
      massState,
      massSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'source' }),
    );
    expect(massResult.appliedSteps?.length).toBeGreaterThan(0);
    const opp = massResult.state.battlefield?.find((entry) => entry.id === 'opp') as any;
    expect(opp?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -1 && entry?.toughness === -1,
    )).toBe(true);

    const blockingSteps = parseBareTriggerEffectFragmentSteps(
      'it gets +1/+1 until end of turn for each creature blocking it.',
    );
    const blockingState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }, { id: 'p2' as PlayerID }],
      combat: {
        attackers: [{ permanentId: 'attacker', blockedBy: ['block1', 'block2'] }],
      },
      battlefield: [
        {
          id: 'attacker',
          controller: 'p1' as PlayerID,
          attacking: true,
          card: { type_line: 'Creature' },
        },
        { id: 'block1', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
        { id: 'block2', controller: 'p2' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const blockingResult = applyOracleIRStepsToGameState(
      blockingState,
      blockingSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    expect(blockingResult.appliedSteps?.length).toBeGreaterThan(0);
    const attacker = blockingResult.state.battlefield?.find((entry) => entry.id === 'attacker') as any;
    expect(attacker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
  });

  it('parses other-attacking-you-control and base-1/1 team scaled PT bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'other attacking creatures you control get +X/+0 until end of turn, where X is the number of counters on this permanent.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'other attacking creatures you control' },
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of counters on this permanent' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'attacking creatures you control get +X/+0 until end of turn, where X is the number of Mountains you control.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'attacking creatures you control' },
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of Mountains you control' },
    });
    expect(parseBareTriggerEffectFragmentSteps(
      'each other creature you control with base power and toughness 1/1 gets +X/+X until end of turn, where X is the number of +1/+1 counters on this permanent.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each other creature you control with base power and toughness 1/1' },
      powerUsesX: true,
      toughnessUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of +1/+1 counters on this permanent' },
    });
  });

  it('executes other-attacking-you-control counter X and base-1/1 team counter X pumps', () => {
    const qalaSteps = parseBareTriggerEffectFragmentSteps(
      'other attacking creatures you control get +X/+0 until end of turn, where X is the number of counters on this permanent.',
    );
    const qalaState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        {
          id: 'qala',
          controller: 'p1' as PlayerID,
          attacking: true,
          counters: { '+1/+1': 2 },
          card: { type_line: 'Creature' },
        },
        { id: 'ally', controller: 'p1' as PlayerID, attacking: true, card: { type_line: 'Creature' } },
        { id: 'bench', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    } as GameState;
    const qalaResult = applyOracleIRStepsToGameState(
      qalaState,
      qalaSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'qala' }),
    );
    expect(qalaResult.appliedSteps?.length).toBeGreaterThan(0);
    const ally = qalaResult.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 0,
    )).toBe(true);
    const qala = qalaResult.state.battlefield?.find((entry) => entry.id === 'qala') as any;
    expect(qala?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();

    const bessSteps = parseBareTriggerEffectFragmentSteps(
      'each other creature you control with base power and toughness 1/1 gets +X/+X until end of turn, where X is the number of +1/+1 counters on this permanent.',
    );
    const bessState = {
      turnNumber: 1,
      players: [{ id: 'p1' as PlayerID }],
      battlefield: [
        {
          id: 'bess',
          controller: 'p1' as PlayerID,
          basePower: 1,
          baseToughness: 1,
          counters: { '+1/+1': 3 },
          card: { type_line: 'Creature', power: 1, toughness: 1 },
        },
        {
          id: 'token',
          controller: 'p1' as PlayerID,
          basePower: 1,
          baseToughness: 1,
          card: { type_line: 'Creature', power: 1, toughness: 1 },
        },
        {
          id: 'giant',
          controller: 'p1' as PlayerID,
          basePower: 4,
          baseToughness: 4,
          card: { type_line: 'Creature', power: 4, toughness: 4 },
        },
      ],
    } as GameState;
    const bessResult = applyOracleIRStepsToGameState(
      bessState,
      bessSteps!,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'bess' }),
    );
    expect(bessResult.appliedSteps?.length).toBeGreaterThan(0);
    const token = bessResult.state.battlefield?.find((entry) => entry.id === 'token') as any;
    expect(token?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 3,
    )).toBe(true);
    const giant = bessResult.state.battlefield?.find((entry) => entry.id === 'giant') as any;
    expect(giant?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });
});
