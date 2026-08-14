import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

/** Documented Dread Summons clause (EDHREC / older oracle). */
const DREAD_SUMMONS =
  'Each player mills X cards. For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.';

/** Newer mill-this-way template (Gorging Vulture family). */
const DREAD_SUMMONS_MILLED =
  'Each player mills X cards. For each creature card milled this way, you create a tapped 2/2 black Zombie creature token.';

function zombieTokens(state: { battlefield?: readonly any[] }): any[] {
  return (state.battlefield || []).filter((perm: any) => {
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    const name = String(perm?.card?.name || perm?.name || '').toLowerCase();
    return typeLine.includes('zombie') || name.includes('zombie');
  });
}

function makeTwoPlayerState(args: {
  casterTop: { id: string; name: string; type_line: string };
  kingTop: { id: string; name: string; type_line: string };
}) {
  return {
    players: [
      {
        id: 'p_caster',
        seat: 0,
        library: [args.casterTop],
        graveyard: [],
      },
      {
        id: 'p_king',
        seat: 1,
        library: [args.kingTop],
        graveyard: [],
      },
    ],
    battlefield: [],
  } as any;
}

describe('for-each creature card put into a graveyard this way token rider', () => {
  it('parses mill then create_token and binds the mill antecedent', () => {
    const steps = parseOracleTextToIR(DREAD_SUMMONS, 'Dread Summons').abilities[0]?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['mill', 'create_token']);
    expect(steps[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'each_player' },
      amount: { kind: 'x' },
    });
    expect(steps[1]).toMatchObject({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      token: expect.stringContaining('2/2 black Zombie'),
      entersTapped: true,
    });
    expect((steps[1] as any).thisWayAntecedentStepIndex).toBe(0);
    expect((steps[1] as any).thisWayAntecedentStepKind).toBe('mill');
  });

  it('creates one tapped Zombie when an opponent mills a creature and you mill a land', () => {
    const steps = parseOracleTextToIR(DREAD_SUMMONS, 'Dread Summons').abilities[0]?.steps ?? [];
    const start = makeTwoPlayerState({
      casterTop: { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island' },
      kingTop: { id: 'archon-1', name: 'Blazing Archon', type_line: 'Creature — Archon' },
    });

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p_caster',
        sourceName: 'Dread Summons',
        xValue: 1,
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['mill', 'create_token']);
    const king = result.state.players.find((player: any) => player.id === 'p_king');
    expect(king?.graveyard?.some((card: any) => String(card?.name || '') === 'Blazing Archon')).toBe(true);

    const zombies = zombieTokens(result.state);
    expect(zombies).toHaveLength(1);
    expect(zombies[0].controller).toBe('p_caster');
    expect(zombies[0].tapped).toBe(true);
  });

  it('does not use spell X as the token count when only one milled card is a creature', () => {
    const steps = parseOracleTextToIR(DREAD_SUMMONS, 'Dread Summons').abilities[0]?.steps ?? [];
    const start = {
      players: [
        {
          id: 'p_caster',
          seat: 0,
          library: [
            { id: 'archon-1', name: 'Blazing Archon', type_line: 'Creature — Archon' },
            { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island' },
          ],
          graveyard: [],
        },
        {
          id: 'p_king',
          seat: 1,
          library: [
            { id: 'plains-1', name: 'Plains', type_line: 'Basic Land — Plains' },
            { id: 'swamp-1', name: 'Swamp', type_line: 'Basic Land — Swamp' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p_caster',
        sourceName: 'Dread Summons',
        xValue: 2,
      }),
      { allowOptional: true },
    );

    expect(zombieTokens(result.state)).toHaveLength(1);
  });

  it('creates no Zombie when only noncreature cards are milled', () => {
    const steps = parseOracleTextToIR(DREAD_SUMMONS, 'Dread Summons').abilities[0]?.steps ?? [];
    const start = makeTwoPlayerState({
      casterTop: { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island' },
      kingTop: { id: 'plains-1', name: 'Plains', type_line: 'Basic Land — Plains' },
    });

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p_caster',
        sourceName: 'Dread Summons',
        xValue: 1,
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['mill', 'create_token']);
    expect(zombieTokens(result.state)).toHaveLength(0);
  });

  it('counts creature cards milled this way on the newer template', () => {
    const steps = parseOracleTextToIR(DREAD_SUMMONS_MILLED, 'Dread Summons').abilities[0]?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['mill', 'create_token']);
    expect((steps[1] as any).thisWayAntecedentStepKind).toBe('mill');

    const start = makeTwoPlayerState({
      casterTop: { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island' },
      kingTop: { id: 'archon-1', name: 'Blazing Archon', type_line: 'Creature — Archon' },
    });

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p_caster',
        sourceName: 'Dread Summons',
        xValue: 1,
      }),
      { allowOptional: true },
    );

    expect(zombieTokens(result.state)).toHaveLength(1);
  });

  it('counts lastMilledCards when the rider is applied in isolation', () => {
    const steps = parseOracleTextToIR(
      'For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.',
      'Dread Summons',
    ).abilities[0]?.steps ?? [];

    const start = {
      players: [
        { id: 'p_caster', seat: 0, library: [], graveyard: [] },
        { id: 'p_king', seat: 1, library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p_caster',
        sourceName: 'Dread Summons',
        lastMilledCards: [
          { id: 'archon-1', name: 'Blazing Archon', type_line: 'Creature — Archon' },
          { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island' },
        ],
      }),
      { allowOptional: true },
    );

    expect(zombieTokens(result.state)).toHaveLength(1);
  });
});
