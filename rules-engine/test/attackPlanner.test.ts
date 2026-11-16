/**
 * P2-5 attack planner: lethal, crack-back hold, target choice, timing.
 */

import { describe, expect, it } from 'vitest';
import { GameStep } from '../../shared/src/types.js';
import { planAttacks } from '../src/ai/attackPlanner.js';
import { creature } from './fixtures/combatAiFixtures.js';

function stateFromCreatures(args: {
  life: Record<string, number>;
  mine: ReturnType<typeof creature>[];
  theirs: ReturnType<typeof creature>[];
  commanderDamage?: Record<string, Record<string, number>>;
}) {
  const players = Object.keys(args.life).map((id) => ({
    id,
    name: id,
    life: args.life[id],
    spectator: false,
    isAI: id === 'ai-player',
  }));
  const battlefield = [
    ...args.mine.map((c) => c.permanent),
    ...args.theirs.map((c) => c.permanent),
  ];
  return {
    turn: 8,
    turnNumber: 8,
    step: GameStep.DECLARE_ATTACKERS,
    phase: 'combat',
    players,
    life: args.life,
    battlefield,
    commanderDamage: args.commanderDamage || {},
    zones: Object.fromEntries(
      Object.keys(args.life).map((id) => [id, { hand: [], library: [], graveyard: [], exile: [] }]),
    ),
  };
}

describe('P2-5 planAttacks', () => {
  it('declares lethal when unblocked damage exceeds life', () => {
    const beater = creature('beater', 8, 8, {}, { controllerId: 'ai-player' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 5, B: 40, C: 40 },
      mine: [beater],
      theirs: [],
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['beater'],
      goaded: [],
    });
    expect(out.attackers).toEqual([
      { creatureId: 'beater', defendingPlayerId: 'A' },
    ]);
    expect(out.reason).toMatch(/lethal/);
  });

  it('holds back when attacking would leave a lethal crack-back', () => {
    // At 4 with one 3/3; A has a 5/5. Attacking taps the only blocker → 5 lethal.
    const wall = creature('wall', 3, 3, {}, { controllerId: 'ai-player' });
    const a5 = creature('a5', 5, 5, {}, { controllerId: 'A' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 4, A: 40, B: 40, C: 40 },
      mine: [wall],
      theirs: [a5],
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['wall'],
      goaded: [],
    });
    expect(out.attackers).toEqual([]);
  });

  it('holds at low life when staying home takes 0 and attacking takes avoidable damage', () => {
    // C1: at 6 with 4/4+2/2; A has 5/5+3/3. Partial attack still leaks damage.
    const big = creature('big', 4, 4, {}, { controllerId: 'ai-player' });
    const small = creature('small', 2, 2, {}, { controllerId: 'ai-player' });
    const a5 = creature('a5', 5, 5, {}, { controllerId: 'A' });
    const a3 = creature('a3', 3, 3, {}, { controllerId: 'A' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 6, A: 40, B: 40, C: 40 },
      mine: [big, small],
      theirs: [a5, a3],
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['big', 'small'],
      goaded: [],
    });
    expect(out.attackers).toEqual([]);
  });

  it('holds a chump when commander crack-back would reach 21', () => {
    const chump = creature('chump', 3, 3, {}, { controllerId: 'ai-player' });
    const cmd = creature('cmd', 6, 6, {}, {
      controllerId: 'A',
      isCommander: true,
      cardId: 'card_cmd',
    });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
      mine: [chump],
      theirs: [cmd],
      commanderDamage: { 'ai-player': { cmd: 15 } },
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['chump'],
      goaded: [],
    });
    expect(out.attackers).toEqual([]);
  });

  it('prefers the open opponent over a deathtouch blocker', () => {
    const beater = creature('beater', 5, 5, {}, { controllerId: 'ai-player' });
    const dt = creature('dt', 1, 1, { deathtouch: true }, { controllerId: 'A' });
    const chump = creature('chump', 1, 1, {}, { controllerId: 'B' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 40, B: 40, C: 40 },
      mine: [beater],
      theirs: [dt, chump],
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['beater'],
      goaded: [],
    });
    expect(['B', 'C']).toContain(out.attackers[0]?.defendingPlayerId);
    expect(out.attackers[0]?.defendingPlayerId).not.toBe('A');
  });

  it('commander damage lethal prefers the 21 path over low life', () => {
    // A at 8 is not life-lethal to a 5/5; B dies to 16+5 commander damage.
    const cmd = creature('cmd', 5, 5, {}, {
      controllerId: 'ai-player',
      isCommander: true,
      cardId: 'cmd',
    });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 8, B: 40, C: 40 },
      mine: [cmd],
      theirs: [],
      commanderDamage: { B: { cmd: 16 } },
    });
    const out = planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['cmd'],
      goaded: [],
    });
    expect(out.attackers).toEqual([
      { creatureId: 'cmd', defendingPlayerId: 'B' },
    ]);
  });

  it('typical plan runs under 50ms', () => {
    const mine = Array.from({ length: 6 }, (_, i) =>
      creature(`m${i}`, 3, 3, {}, { controllerId: 'ai-player' }),
    );
    const theirs = [
      ...Array.from({ length: 3 }, (_, i) =>
        creature(`a${i}`, 2, 2, {}, { controllerId: 'A' }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        creature(`b${i}`, 2, 2, {}, { controllerId: 'B' }),
      ),
    ];
    const gameState = stateFromCreatures({
      life: { 'ai-player': 30, A: 25, B: 28, C: 40 },
      mine,
      theirs,
    });
    // Warm
    planAttacks({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: mine.map((c) => c.id),
      goaded: [],
    });
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const out = planAttacks({
        gameState,
        playerId: 'ai-player',
        legalAttackerIds: mine.map((c) => c.id),
        goaded: [],
      });
      samples.push(out.ms);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(50);
  });
});
