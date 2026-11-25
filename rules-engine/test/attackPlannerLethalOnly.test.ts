/**
 * Cheap lethal-only path used when full planAttacks is skipped on large boards.
 */

import { describe, expect, it } from 'vitest';
import { GameStep } from '../../shared/src/types.js';
import { planLethalAttacksOnly } from '../src/ai/attackPlannerLethalOnly.js';
import { creature } from './fixtures/combatAiFixtures.js';

function stateFromCreatures(args: {
  life: Record<string, number>;
  mine: ReturnType<typeof creature>[];
  theirs: ReturnType<typeof creature>[];
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
    turn: 12,
    turnNumber: 12,
    step: GameStep.DECLARE_ATTACKERS,
    phase: 'combat',
    players,
    life: args.life,
    battlefield,
    commanderDamage: {},
    zones: Object.fromEntries(
      Object.keys(args.life).map((id) => [id, { hand: [], library: [], graveyard: [], exile: [] }]),
    ),
  };
}

describe('planLethalAttacksOnly', () => {
  it('returns a lethal declaration when unblocked damage exceeds life', () => {
    const beater = creature('beater', 9, 9, {}, { controllerId: 'ai-player' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 6, B: 40, C: 40 },
      mine: [beater],
      theirs: [],
    });
    const out = planLethalAttacksOnly({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['beater'],
      goaded: [],
    });
    expect(out).not.toBeNull();
    expect(out!.attackers).toEqual([
      { creatureId: 'beater', defendingPlayerId: 'A' },
    ]);
    expect(out!.reason).toMatch(/lethal-only/);
  });

  it('returns null when damage is not lethal', () => {
    const beater = creature('beater', 2, 2, {}, { controllerId: 'ai-player' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 20, B: 40, C: 40 },
      mine: [beater],
      theirs: [],
    });
    const out = planLethalAttacksOnly({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['beater'],
      goaded: [],
    });
    expect(out).toBeNull();
  });

  it('takes crack-safe unless_trick lethal when defender has open mana+hand', () => {
    const beater = creature('beater', 9, 9, {}, { controllerId: 'ai-player' });
    const gameState = stateFromCreatures({
      life: { 'ai-player': 40, A: 6, B: 40, C: 40 },
      mine: [beater],
      theirs: [],
    });
    // Open mana + card ⇒ findLethal marks unless_trick instead of guaranteed.
    gameState.battlefield.push({
      id: 'island',
      controller: 'A',
      owner: 'A',
      tapped: false,
      card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '{T}: Add {U}.' },
    } as any);
    gameState.zones.A.hand = [{ id: 'h1', name: 'Fog' }];
    const out = planLethalAttacksOnly({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['beater'],
      goaded: [],
    });
    expect(out).not.toBeNull();
    expect(out!.reason).toMatch(/unless-trick/);
    expect(out!.attackers).toEqual([
      { creatureId: 'beater', defendingPlayerId: 'A' },
    ]);
  });
});
