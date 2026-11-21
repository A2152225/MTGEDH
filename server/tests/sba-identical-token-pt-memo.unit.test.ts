import { describe, expect, it } from 'vitest';
import { applyStateBasedActions } from '../src/rules-engine/index.js';

function borgToken(id: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    isToken: true,
    tapped: false,
    counters: {},
    basePower: 1,
    baseToughness: 1,
    card: {
      id: `${id}_card`,
      name: 'Borg',
      type_line: 'Artifact Creature — Cyborg',
      oracle_text: '',
      power: '1',
      toughness: '1',
    },
    ...extras,
  };
}

function swarmState(battlefield: any[]) {
  return {
    battlefield,
    players: [
      { id: 'p1', name: 'P1', life: 40 },
      { id: 'p2', name: 'P2', life: 40 },
    ],
    zones: {
      p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      p2: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    },
    life: { p1: 40, p2: 40 },
    commandZone: {},
    emblems: [],
    conspiracies: [],
  } as any;
}

describe('applyStateBasedActions identical-token P/T memo', () => {
  it('destroys only the damaged copy among many identical tokens', () => {
    const battlefield = [
      ...Array.from({ length: 80 }, (_, i) => borgToken(`borg_${i}`)),
      borgToken('borg_lethal', { damageMarked: 1, markedDamage: 1, damage: 1 }),
    ];
    const result = applyStateBasedActions(swarmState(battlefield));
    expect(result.destroys).toEqual(['borg_lethal']);
  });

  it('does not share toughness when one copy has a temporary P/T bonus', () => {
    const battlefield = [
      borgToken('borg_plain', { damageMarked: 1, markedDamage: 1, damage: 1 }),
      borgToken('borg_buffed', {
        temporaryPTMods: [{ power: 0, toughness: 5, source: 'buff', expiresAt: 'end_of_turn' }],
        damageMarked: 1,
        markedDamage: 1,
        damage: 1,
      }),
    ];
    // Plain 1/1 with 1 damage dies; buffed 1/6 with 1 damage must live (memo must not reuse 1/1).
    const result = applyStateBasedActions(swarmState(battlefield));
    expect(result.destroys).toContain('borg_plain');
    expect(result.destroys).not.toContain('borg_buffed');
  });

  it('destroys 0-toughness tokens without needing per-copy damage', () => {
    const battlefield = Array.from({ length: 40 }, (_, i) =>
      borgToken(`borg_zero_${i}`, { baseToughness: 0, card: {
        id: `borg_zero_${i}_card`,
        name: 'Borg',
        type_line: 'Artifact Creature — Cyborg',
        oracle_text: '',
        power: '1',
        toughness: '0',
      } }),
    );
    const result = applyStateBasedActions(swarmState(battlefield));
    expect(result.destroys).toHaveLength(40);
  });
});
