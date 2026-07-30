import { describe, expect, it } from 'vitest';

import {
  chooseAITargetsForSpell,
  isAISpellContextuallyUseful,
} from '../src/socket/ai.js';

const fog = {
  name: 'Fog',
  type_line: 'Instant',
  oracle_text: 'Prevent all combat damage that would be dealt this turn.',
};

const entrapmentManeuver = {
  name: 'Entrapment Maneuver',
  type_line: 'Instant',
  oracle_text: "Target player sacrifices an attacking creature of their choice. You create X 1/1 white Soldier creature tokens, where X is that creature's toughness.",
};

function buildGame(battlefield: any[] = []) {
  return {
    state: {
      players: [
        { id: 'ai', name: 'AI', life: 40 },
        { id: 'attacker', name: 'Attacker', life: 40 },
        { id: 'bystander', name: 'Bystander', life: 40 },
      ],
      battlefield,
      stack: [],
      zones: {
        ai: { hand: [] },
        attacker: { hand: [] },
        bystander: { hand: [] },
      },
    },
  } as any;
}

describe('AI combat-dependent spell context', () => {
  it('does not consider Fog or attacking-creature edicts useful without attackers', () => {
    const game = buildGame();

    expect(isAISpellContextuallyUseful(game, 'ai' as any, fog)).toBe(false);
    expect(isAISpellContextuallyUseful(game, 'ai' as any, entrapmentManeuver)).toBe(false);
  });

  it('allows Fog only for a hostile attack involving the AI', () => {
    const attackingAI = buildGame([{
      id: 'bear',
      controller: 'attacker',
      attacking: 'ai',
      card: { name: 'Bear', type_line: 'Creature — Bear', toughness: '2' },
    }]);
    const attackingBystander = buildGame([{
      id: 'bear',
      controller: 'attacker',
      attacking: 'bystander',
      card: { name: 'Bear', type_line: 'Creature — Bear', toughness: '2' },
    }]);

    expect(isAISpellContextuallyUseful(attackingAI, 'ai' as any, fog)).toBe(true);
    expect(isAISpellContextuallyUseful(attackingBystander, 'ai' as any, fog)).toBe(false);
  });

  it('targets a player who controls an attacker for an attacking-creature edict', () => {
    const game = buildGame([{
      id: 'attacking_beast',
      controller: 'attacker',
      attacking: 'ai',
      card: { name: 'Attacking Beast', type_line: 'Creature — Beast', toughness: '5' },
    }]);

    expect(isAISpellContextuallyUseful(game, 'ai' as any, entrapmentManeuver)).toBe(true);

    const selected = chooseAITargetsForSpell(
      game,
      'ai' as any,
      entrapmentManeuver,
      { op: 'TARGET_PLAYER', minTargets: 1 } as any,
      [
        { kind: 'player', id: 'bystander' },
        { kind: 'player', id: 'attacker' },
      ] as any,
      1,
    );

    expect(selected).toEqual([{ kind: 'player', id: 'attacker' }]);
  });
});
