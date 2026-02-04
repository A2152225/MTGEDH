import { describe, expect, it } from 'vitest';
import { resolveTopOfStack } from '../src/state/modules/stack';

function makeCtx(state: any): any {
  return {
    state,
    bumpSeq: () => {},
  };
}

describe('intervening-if plumbing: warrior damage source refs', () => {
  it('suppresses trigger at trigger-time when damage source is not a Warrior', () => {
    const sourcePermanentId = 'src1';

    const sourcePermanent = {
      id: sourcePermanentId,
      controller: 'p1',
      card: {
        name: 'Test Non-Warrior Source',
        type_line: 'Creature — Elf',
        oracle_text:
          'Whenever ~ deals damage to a player, if any of that damage was dealt by a Warrior, draw a card.',
      },
    };

    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      life: { p1: 40, p2: 40 },
      battlefield: [sourcePermanent],
      stack: [
        {
          id: 'ability1',
          type: 'ability',
          controller: 'p1',
          source: sourcePermanentId,
          sourceName: 'Test Non-Warrior Source',
          description: 'deals 1 damage to target',
          targets: ['p2'],
        },
      ],
    };

    resolveTopOfStack(makeCtx(state));

    // Damage was dealt, but the intervening-if clause should have prevented the trigger.
    expect(state.life.p2).toBe(39);
    expect(Array.isArray(state.stack)).toBe(true);
    expect(state.stack.length).toBe(0);
  });

  it('queues trigger when damage source is a Warrior', () => {
    const sourcePermanentId = 'src2';

    const sourcePermanent = {
      id: sourcePermanentId,
      controller: 'p1',
      card: {
        name: 'Test Warrior Source',
        type_line: 'Creature — Human Warrior',
        oracle_text:
          'Whenever ~ deals damage to a player, if any of that damage was dealt by a Warrior, draw a card.',
      },
    };

    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      life: { p1: 40, p2: 40 },
      battlefield: [sourcePermanent],
      stack: [
        {
          id: 'ability2',
          type: 'ability',
          controller: 'p1',
          source: sourcePermanentId,
          sourceName: 'Test Warrior Source',
          description: 'deals 1 damage to target',
          targets: ['p2'],
        },
      ],
    };

    resolveTopOfStack(makeCtx(state));

    expect(state.life.p2).toBe(39);
    expect(state.stack.length).toBe(1);
    expect(state.stack[0]?.type).toBe('triggered_ability');
    expect(String(state.stack[0]?.description || '')).toMatch(/draw a card/i);
  });
});
