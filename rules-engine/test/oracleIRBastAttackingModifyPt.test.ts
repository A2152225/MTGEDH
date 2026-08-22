import { describe, expect, it } from 'vitest';

﻿import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'c1' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: 'combat' as any,
    active: true,
    ...overrides,
  } as any;
}

describe('Bast-style target attacking creature +X/+X where X = creatures you control', () => {
  it('parses modify_pt with target attacking creature and where-X creatures you control', () => {
    const ir = parseOracleTextToIR(
      'Whenever you attack, target attacking creature gets +X/+X until end of turn, where X is the number of creatures you control.',
      'Bast, Panther Goddess',
    );
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    const modify = steps.find((step: any) => step?.kind === 'modify_pt');
    expect(modify).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'target attacking creature' },
      powerUsesX: true,
      toughnessUsesX: true,
      condition: { kind: 'where', raw: 'X is the number of creatures you control' },
    });
  });

  it('applies the pump to the chosen attacking creature using creature-count X', () => {
    const ir = parseOracleTextToIR(
      'Target attacking creature gets +X/+X until end of turn, where X is the number of creatures you control.',
      'Bast, Panther Goddess',
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      battlefield: [
        {
          id: 'bast',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Bast, Panther Goddess',
          cardType: 'Creature',
          type_line: 'Legendary Creature — Cat God',
          power: 5,
          toughness: 5,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'tchalla',
          ownerId: 'p1',
          controller: 'p1',
          name: "T'Challa, the Black Panther",
          cardType: 'Creature',
          type_line: 'Legendary Creature — Human Noble Hero',
          power: 2,
          toughness: 2,
          attacking: 'p2',
          tapped: true,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'soldier1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Soldier',
          cardType: 'Creature',
          type_line: 'Token Creature — Soldier',
          power: 1,
          toughness: 1,
          attacking: 'p2',
          tapped: true,
          summoningSick: false,
          counters: {},
          isToken: true,
        } as any,
        {
          id: 'soldier2',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Soldier',
          cardType: 'Creature',
          type_line: 'Token Creature — Soldier',
          power: 1,
          toughness: 1,
          tapped: false,
          summoningSick: false,
          counters: {},
          isToken: true,
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'bast',
      sourceName: 'Bast, Panther Goddess',
      targetPermanentId: 'tchalla',
      selectorContext: {
        chosenObjectIds: ['tchalla'],
        targetPermanentId: 'tchalla',
      },
    });

    expect(result.appliedSteps.some((step) => step.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some((step) => step.kind === 'modify_pt')).toBe(false);

    const tchalla = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tchalla') as any;
    const ptMod = (Array.isArray(tchalla?.modifiers) ? tchalla.modifiers : []).find(
      (m: any) => m?.type === 'powerToughness',
    );
    // X = 4 creatures you control (Bast, T'Challa, 2 Soldiers)
    expect(ptMod?.power).toBe(4);
    expect(ptMod?.toughness).toBe(4);

    const soldier1 = ((result.state as any).battlefield || []).find((p: any) => p.id === 'soldier1') as any;
    const soldierPump = (Array.isArray(soldier1?.modifiers) ? soldier1.modifiers : []).find(
      (m: any) => m?.type === 'powerToughness',
    );
    expect(soldierPump).toBeUndefined();
  });

  it('does not apply when chosen id is not an attacking creature', () => {
    const ir = parseOracleTextToIR(
      'Target attacking creature gets +X/+X until end of turn, where X is the number of creatures you control.',
      'Bast, Panther Goddess',
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      battlefield: [
        {
          id: 'bast',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Bast, Panther Goddess',
          cardType: 'Creature',
          power: 5,
          toughness: 5,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'bench',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Bench Warmer',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'attacker',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Attacker',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          attacking: 'p2',
          tapped: true,
          summoningSick: false,
          counters: {},
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'bast',
      targetPermanentId: 'bench',
      selectorContext: { chosenObjectIds: ['bench'] },
    });

    // With a non-attacking chosen id and another attacker present, combat-role pool
    // should not silently pump the wrong creature via sole-attacker auto-pick when
    // chosen ids are present but illegal — expect skip or no pump on bench.
    const bench = ((result.state as any).battlefield || []).find((p: any) => p.id === 'bench') as any;
    const benchPump = (Array.isArray(bench?.modifiers) ? bench.modifiers : []).find(
      (m: any) => m?.type === 'powerToughness',
    );
    expect(benchPump).toBeUndefined();
  });
});
