/**
 * P2-1 combat resolver: one-on-one grid vs evaluateSingleBlockOutcome,
 * multi-blocker, trample, lifelink, commander damage, uncertain flag.
 */

import { describe, expect, it } from 'vitest';
import { evaluateSingleBlockOutcome } from '../src/aiEngineBlockPlanning.js';
import type { CombatCreature, CombatKeywords } from '../src/combatAutomation.js';
import { resolveCombat } from '../src/ai/combatResolver.js';

const EMPTY_KW: CombatKeywords = {
  flying: false,
  reach: false,
  firstStrike: false,
  doubleStrike: false,
  deathtouch: false,
  trample: false,
  lifelink: false,
  menace: false,
  vigilance: false,
  haste: false,
  indestructible: false,
  defender: false,
  shadow: false,
  horsemanship: false,
  skulk: false,
  fear: false,
  intimidate: false,
  protectionColors: [],
  protectionTypes: [],
};

function creature(
  id: string,
  power: number,
  toughness: number,
  kw: Partial<CombatKeywords> = {},
  opts: {
    controllerId?: string;
    oracle?: string;
    isCommander?: boolean;
    cardId?: string;
    damage?: number;
  } = {},
): CombatCreature {
  const keywords: CombatKeywords = { ...EMPTY_KW, ...kw };
  // Mutual exclusion mirrors extractCombatKeywords.
  if (keywords.doubleStrike) {
    (keywords as { firstStrike: boolean }).firstStrike = false;
  }
  return {
    id,
    name: id,
    controllerId: opts.controllerId || 'p_atk',
    power,
    toughness,
    damage: opts.damage || 0,
    keywords,
    permanent: {
      id,
      controller: opts.controllerId || 'p_atk',
      owner: opts.controllerId || 'p_atk',
      tapped: false,
      summoningSickness: false,
      counters: opts.damage ? { damage: opts.damage } : {},
      isCommander: opts.isCommander || false,
      card: {
        id: opts.cardId || `c_${id}`,
        name: id,
        type_line: 'Creature',
        oracle_text: opts.oracle || '',
        power: String(power),
        toughness: String(toughness),
      },
    } as any,
  };
}

function survivalFromResolve(
  attacker: CombatCreature,
  blocker: CombatCreature,
): { blockerSurvives: boolean; attackerDies: boolean } {
  const creatures = new Map<string, CombatCreature>([
    [attacker.id, attacker],
    [blocker.id, blocker],
  ]);
  const out = resolveCombat(
    [{ attacker, defenderId: 'p_def' }],
    [{ blockerId: blocker.id, attackerId: attacker.id }],
    creatures,
    [{ id: 'p_def', life: 40, commanderDamageTaken: {} }],
  );
  return {
    blockerSurvives: !out.deaths.includes(blocker.id),
    attackerDies: out.deaths.includes(attacker.id),
  };
}

describe('P2-1 resolveCombat', () => {
  it('unblocked attacker deals power to the defender', () => {
    const atk = creature('a', 5, 5);
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['a', atk]]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.lifeLost.d1).toBe(5);
    expect(out.deaths).toEqual([]);
    expect(out.defendersKilled).toEqual([]);
  });

  it('double strike deals power twice when unblocked', () => {
    const atk = creature('a', 3, 3, { doubleStrike: true });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['a', atk]]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.lifeLost.d1).toBe(6);
  });

  it('trample sends excess past a chump', () => {
    const atk = creature('a', 7, 7, { trample: true });
    const blk = creature('b', 1, 1, {}, { controllerId: 'p_def' });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [{ blockerId: 'b', attackerId: 'a' }],
      new Map([
        ['a', atk],
        ['b', blk],
      ]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.deaths).toContain('b');
    expect(out.lifeLost.d1).toBe(6);
  });

  it('deathtouch trample: one damage kills blocker, rest trampls', () => {
    const atk = creature('a', 5, 5, { deathtouch: true, trample: true });
    const blk = creature('b', 4, 4, {}, { controllerId: 'p_def' });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [{ blockerId: 'b', attackerId: 'a' }],
      new Map([
        ['a', atk],
        ['b', blk],
      ]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.deaths).toContain('b');
    expect(out.lifeLost.d1).toBe(4);
  });

  it('lifelink gains life for the controller', () => {
    const atk = creature('a', 4, 4, { lifelink: true }, { controllerId: 'p_atk' });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['a', atk]]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.lifeGained.p_atk).toBe(4);
    expect(out.lifeLost.d1).toBe(4);
  });

  it('multi-blocker: attacker kills most valuable blockers its damage allows', () => {
    const atk = creature('a', 5, 5);
    const cheap = creature('c', 1, 1, {}, { controllerId: 'p_def' });
    const pricey = creature('p', 3, 3, { flying: true }, { controllerId: 'p_def' });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [
        { blockerId: 'c', attackerId: 'a' },
        { blockerId: 'p', attackerId: 'a' },
      ],
      new Map([
        ['a', atk],
        ['c', cheap],
        ['p', pricey],
      ]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    // 5 damage: kill 3/3 (needs 3) then 1/1 (needs 1); 1 left unused (no trample).
    expect(out.deaths).toEqual(expect.arrayContaining(['p', 'c']));
    expect(out.lifeLost.d1 || 0).toBe(0);
  });

  it('commander damage reaching 21 kills the defender', () => {
    const atk = creature('cmd', 5, 5, {}, {
      isCommander: true,
      cardId: 'cmd_card',
      controllerId: 'p_atk',
    });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['cmd', atk]]),
      [{ id: 'd1', life: 40, commanderDamageTaken: { cmd_card: 16 } }],
    );
    expect(out.commanderDamage.d1.cmd_card).toBe(5);
    expect(out.defendersKilled).toContain('d1');
  });

  it('commander damage keyed by permanent id still accumulates to 21', () => {
    // Puzzles/servers may key taken damage by permanent id while card.id differs.
    const atk = creature('cmd', 5, 5, {}, {
      isCommander: true,
      cardId: 'card_cmd',
      controllerId: 'p_atk',
    });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['cmd', atk]]),
      [{ id: 'd1', life: 40, commanderDamageTaken: { cmd: 17 } }],
    );
    expect(out.commanderDamage.d1.cmd).toBe(5);
    expect(out.defendersKilled).toContain('d1');
  });

  it('life to 0 kills the defender', () => {
    const atk = creature('a', 8, 8);
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [],
      new Map([['a', atk]]),
      [{ id: 'd1', life: 5, commanderDamageTaken: {} }],
    );
    expect(out.defendersKilled).toContain('d1');
  });

  it('two defenders in one combat', () => {
    const a1 = creature('a1', 3, 3, {}, { controllerId: 'p_atk' });
    const a2 = creature('a2', 4, 4, {}, { controllerId: 'p_atk' });
    const out = resolveCombat(
      [
        { attacker: a1, defenderId: 'd1' },
        { attacker: a2, defenderId: 'd2' },
      ],
      [],
      new Map([
        ['a1', a1],
        ['a2', a2],
      ]),
      [
        { id: 'd1', life: 40, commanderDamageTaken: {} },
        { id: 'd2', life: 40, commanderDamageTaken: {} },
      ],
    );
    expect(out.lifeLost.d1).toBe(3);
    expect(out.lifeLost.d2).toBe(4);
  });

  it('indestructible blocker survives lethal damage', () => {
    const atk = creature('a', 10, 10);
    const blk = creature('b', 1, 1, { indestructible: true }, { controllerId: 'p_def' });
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [{ blockerId: 'b', attackerId: 'a' }],
      new Map([
        ['a', atk],
        ['b', blk],
      ]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.deaths).not.toContain('b');
  });

  it('regeneration oracle sets uncertain', () => {
    const atk = creature('a', 3, 3);
    const blk = creature(
      'b',
      2,
      2,
      {},
      { controllerId: 'p_def', oracle: '{1}: Regenerate CARDNAME.' },
    );
    const out = resolveCombat(
      [{ attacker: atk, defenderId: 'd1' }],
      [{ blockerId: 'b', attackerId: 'a' }],
      new Map([
        ['a', atk],
        ['b', blk],
      ]),
      [{ id: 'd1', life: 40, commanderDamageTaken: {} }],
    );
    expect(out.uncertain).toBe(true);
  });

  describe('one-on-one keyword grid matches evaluateSingleBlockOutcome', () => {
    // Parity grid omits double strike: evaluateSingleBlockOutcome lumps DS as
    // power*2 in one check, which disagrees with a true two-step model when
    // the first-strike half is not lethal (e.g. 2-power DS vs 3 toughness).
    const flags = ['firstStrike', 'deathtouch', 'indestructible'] as const;
    const combos: Array<Partial<CombatKeywords>> = [{}];
    for (const f of flags) {
      const next = combos.map((c) => ({ ...c, [f]: true }));
      combos.push(...next);
    }

    for (const atkKw of combos) {
      for (const blkKw of combos) {
        const label = `atk=${JSON.stringify(atkKw)} blk=${JSON.stringify(blkKw)}`;
        it(label, () => {
          const attacker = creature('atk', 3, 3, atkKw, { controllerId: 'p_atk' });
          const blocker = creature('blk', 2, 2, blkKw, { controllerId: 'p_def' });
          const expected = evaluateSingleBlockOutcome(blocker, attacker);
          const got = survivalFromResolve(attacker, blocker);
          expect(got, label).toEqual(expected);
        });
      }
    }
  });

  it('double strike vs double strike uses two damage steps (not lumped power*2)', () => {
    // 3/3 DS vs 2/2 DS: first step both deal 3 and 2; blocker dies, attacker
    // takes 2 (survives). Regular: blocker is gone; attacker remains blocked
    // so deals nothing more without trample.
    const atk = creature('atk', 3, 3, { doubleStrike: true });
    const blk = creature('blk', 2, 2, { doubleStrike: true }, { controllerId: 'p_def' });
    const got = survivalFromResolve(atk, blk);
    expect(got.blockerSurvives).toBe(false);
    expect(got.attackerDies).toBe(false);
  });
});
