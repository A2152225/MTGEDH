import { describe, expect, it } from 'vitest';
import { GamePhase, type PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';

describe('end_combat_phase + council vote IR', () => {
  it('parses and executes End the combat phase', () => {
    const text =
      "Cast this spell only during combat.\nYour opponents can't cast spells this turn.\nEnd the combat phase. (Remove all attackers and blockers from combat. Exile all spells and abilities from the stack, including this spell.)";

    const collected = collectSpellResolutionEffectStepsWithOverlay(text, 'Mandate of Peace');
    expect(collected.map((s) => s.kind)).toContain('end_combat_phase');

    const endStep = collected.find((s) => s.kind === 'end_combat_phase')!;
    const state: any = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [], graveyard: [], exile: [] },
        { id: 'p2', life: 40, hand: [], library: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        { id: 'a1', controller: 'p1', attacking: 'p2', card: { name: 'Bear', type_line: 'Creature' } },
        { id: 'b1', controller: 'p2', blocking: 'a1', card: { name: 'Wall', type_line: 'Creature' } },
      ],
      stack: [
        {
          id: 's1',
          controller: 'p1',
          card: { id: 'c1', name: 'Mandate of Peace', type_line: 'Instant' },
        },
      ],
      phase: 'combat',
      step: 'declareBlockers',
      combat: { attackers: ['a1'] },
      combatNumber: 1,
    };

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 's1',
      sourceName: 'Mandate of Peace',
    });
    const result = applyOracleIRStepsToGameState(state, [endStep], ctx, { allowOptional: true });

    expect(result.appliedSteps.some((s) => s.kind === 'end_combat_phase')).toBe(true);
    expect(result.state.phase).toBe(GamePhase.POSTCOMBAT_MAIN);
    expect((result.state as any).battlefield[0].attacking).toBeUndefined();
    expect((result.state as any).battlefield[1].blocking).toBeUndefined();
    expect((result.state as any).combat).toBeUndefined();
    expect((result.state as any).stack).toHaveLength(0);
    expect((result.state as any).players[0].exile.some((c: any) => c.name === 'Mandate of Peace')).toBe(true);
  });

  it('parses Secret council / Will of the council into vote steps', () => {
    const mob = parseOracleTextToIR(
      'Secret council — Each player secretly votes for another player, then those votes are revealed. For each vote an opponent received, Mob Verdict deals 2 damage to that player and each creature that player controls. For each vote you received, draw a card.',
      'Mob Verdict',
    );
    const mobSteps = mob.abilities.flatMap((a) => a.steps);
    const mobVote = mobSteps.find((s) => s.kind === 'vote') as any;
    expect(mobVote).toBeTruthy();
    expect(mobVote.secret).toBe(true);
    expect(mobVote.ballot).toBe('players');
    expect(mobSteps.some((s) => s.kind === 'draw' && (s as any).amount?.kind === 'votes_received')).toBe(true);

    const plea = parseOracleTextToIR(
      'Will of the council — Starting with you, each player votes for time or knowledge. If time gets more votes, take an extra turn after this one. If knowledge gets more votes or the vote is tied, draw three cards.',
      'Plea for Power',
    );
    const pleaVote = plea.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'vote') as any;
    expect(pleaVote).toBeTruthy();
    expect(pleaVote.choices).toEqual(['time', 'knowledge']);
    expect(pleaVote.startingWith).toEqual({ kind: 'you' });
  });

  it('applies vote tallies into state for follow-on votes_received amounts', () => {
    const voteStep = {
      kind: 'vote' as const,
      voters: { kind: 'each_player' as const },
      choices: [] as string[],
      ballot: 'players' as const,
      ballotFilter: 'another player',
      secret: true,
      raw: 'Each player secretly votes for another player',
    };
    const drawStep = {
      kind: 'draw' as const,
      who: { kind: 'you' as const },
      amount: { kind: 'votes_received' as const, who: 'you' as const },
      raw: 'For each vote you received, draw a card.',
    };

    const state: any = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [{ id: 'l1' }, { id: 'l2' }], graveyard: [], exile: [] },
        { id: 'p2', life: 40, hand: [], library: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
      stack: [],
    };

    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        sourceName: 'Mob Verdict',
        voteChoiceCounts: { p1: 2, p2: 1 },
      },
      { voteChoiceCounts: { p1: 2, p2: 1 } },
    );
    const result = applyOracleIRStepsToGameState(state, [voteStep, drawStep], ctx, {
      allowOptional: true,
    });

    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['vote', 'draw']);
    expect((result.state as any).votesReceivedByPlayer.p1).toBe(2);
    expect((result.state as any).players[0].hand.length).toBe(2);
  });
});
