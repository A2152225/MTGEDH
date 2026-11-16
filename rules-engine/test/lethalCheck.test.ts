/**
 * P2-2 lethal check fixtures.
 */

import { describe, expect, it } from 'vitest';
import { findLethal } from '../src/ai/lethalCheck.js';
import { creature } from './fixtures/combatAiFixtures.js';

describe('P2-2 findLethal', () => {
  it('no-lethal when defenders can chump enough', () => {
    const atk = creature('a', 4, 4);
    const blk = creature('b', 1, 1, {}, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [blk]]]),
      trickRisk: {},
    });
    expect(plans).toEqual([]);
  });

  it('lethal when unblocked damage exceeds life', () => {
    const atk = creature('a', 8, 8);
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', []]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].targetId).toBe('d1');
    expect(plans[0].certainty).toBe('guaranteed');
    expect(plans[0].attackers[0]).toEqual({
      creatureId: 'a',
      defendingPlayerId: 'd1',
    });
  });

  it('commander damage carried over reaches 21', () => {
    const cmd = creature('cmd', 5, 5, {}, {
      isCommander: true,
      cardId: 'cmd_card',
    });
    const plans = findLethal({
      attackers: [cmd],
      defenders: [{ id: 'd1', life: 40, commanderDamageTaken: { cmd_card: 16 } }],
      blockersByDefender: new Map([['d1', []]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].targetId).toBe('d1');
  });

  it('trample past chump blockers still kills', () => {
    const atk = creature('a', 10, 10, { trample: true });
    const chump = creature('c', 1, 1, {}, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 6, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [chump]]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
  });

  it('menace: one blocker is not enough; two can stop lethal', () => {
    const atk = creature('a', 9, 9, { menace: true });
    const b1 = creature('b1', 2, 2, {}, { controllerId: 'd1' });
    const b2 = creature('b2', 2, 2, {}, { controllerId: 'd1' });
    const withOne = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 8, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [b1]]]),
      trickRisk: {},
    });
    expect(withOne).toHaveLength(1); // one blocker → incomplete menace → full damage

    const withTwo = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 8, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [b1, b2]]]),
      trickRisk: {},
    });
    expect(withTwo).toEqual([]); // two blockers stop it
  });

  it('returns both killable opponents', () => {
    const a1 = creature('a1', 10, 10);
    const a2 = creature('a2', 10, 10);
    // findLethal sends ALL attackers at each defender in turn
    const plans = findLethal({
      attackers: [a1, a2],
      defenders: [
        { id: 'd1', life: 15, commanderDamageTaken: {} },
        { id: 'd2', life: 15, commanderDamageTaken: {} },
      ],
      blockersByDefender: new Map([
        ['d1', []],
        ['d2', []],
      ]),
      trickRisk: {},
    });
    expect(plans.map((p) => p.targetId).sort()).toEqual(['d1', 'd2']);
  });

  it('unless_trick when trickRisk is set', () => {
    const atk = creature('a', 10, 10);
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', []]]),
      trickRisk: { d1: true },
    });
    expect(plans[0].certainty).toBe('unless_trick');
  });

  it('guaranteed when trickRisk is false/absent', () => {
    const atk = creature('a', 10, 10);
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', []]]),
      trickRisk: { d1: false },
    });
    expect(plans[0].certainty).toBe('guaranteed');
  });

  it('flying attacker ignores ground blockers', () => {
    const atk = creature('a', 7, 7, { flying: true });
    const ground = creature('g', 5, 5, {}, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 6, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [ground]]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
  });

  it('reach blocker can stop flying lethal', () => {
    const atk = creature('a', 7, 7, { flying: true });
    const reach = creature('r', 1, 1, { reach: true }, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 6, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [reach]]]),
      trickRisk: {},
    });
    expect(plans).toEqual([]);
  });

  it('tapped blockers do not count', () => {
    const atk = creature('a', 6, 6);
    const tapped = creature('t', 5, 5, {}, { controllerId: 'd1', tapped: true });
    const plans = findLethal({
      attackers: [atk],
      defenders: [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [tapped]]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
  });

  it('multiple attackers lethal through partial blocks', () => {
    const a1 = creature('a1', 5, 5);
    const a2 = creature('a2', 5, 5);
    const blk = creature('b', 2, 2, {}, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [a1, a2],
      defenders: [{ id: 'd1', life: 6, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [blk]]]),
      trickRisk: {},
    });
    // One attacker blocked (5 prevented), other gets through → 5 damage < 6 life? 
    // 5 through with life 6 → not lethal. Raise stakes:
    expect(plans).toEqual([]);
  });

  it('multiple attackers lethal when through-damage exceeds life', () => {
    const a1 = creature('a1', 5, 5);
    const a2 = creature('a2', 5, 5);
    const blk = creature('b', 2, 2, {}, { controllerId: 'd1' });
    const plans = findLethal({
      attackers: [a1, a2],
      defenders: [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
      blockersByDefender: new Map([['d1', [blk]]]),
      trickRisk: {},
    });
    expect(plans).toHaveLength(1);
  });

  it('empty attackers returns no plans', () => {
    expect(
      findLethal({
        attackers: [],
        defenders: [{ id: 'd1', life: 1, commanderDamageTaken: {} }],
        blockersByDefender: new Map(),
        trickRisk: {},
      }),
    ).toEqual([]);
  });

  it('typical late-game check runs under 1ms', () => {
    const attackers = Array.from({ length: 8 }, (_, i) =>
      creature(`a${i}`, 3 + (i % 3), 3),
    );
    const blockers = Array.from({ length: 6 }, (_, i) =>
      creature(`b${i}`, 2, 2, {}, { controllerId: 'd1' }),
    );
    const defenders = [
      { id: 'd1', life: 20, commanderDamageTaken: {} },
      { id: 'd2', life: 18, commanderDamageTaken: {} },
      { id: 'd3', life: 22, commanderDamageTaken: {} },
    ];
    const blockersByDefender = new Map([
      ['d1', blockers],
      ['d2', blockers.slice(0, 3)],
      ['d3', []],
    ]);
    // Warm up
    findLethal({ attackers, defenders, blockersByDefender, trickRisk: {} });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      findLethal({ attackers, defenders, blockersByDefender, trickRisk: {} });
    }
    const avg = (performance.now() - t0) / 50;
    expect(avg).toBeLessThan(1);
  });
});
