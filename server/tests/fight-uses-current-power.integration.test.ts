import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { tryLoyaltyTemplateP1P1FightDamage } from '../src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateP1P1FightDamage.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Robert's report: a printed 2/2 that was currently 14/14 fought Blazing Archon (5/6) and dealt
// only 2 damage. Fight (CR 701.14a) and bite must use current power; lethal checks use current
// toughness.

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const PREY_UPON = "Target creature you control fights target creature you don't control.";
const RABID_BITE = "Target creature you control deals damage equal to its power to target creature you don't control.";

function archon() {
  return {
    id: 'archon', controller: p2, owner: p2, tapped: false, counters: {},
    card: {
      id: 'archon_card', name: 'Blazing Archon', type_line: 'Creature - Archon',
      oracle_text: "Flying\nCreatures can't attack you.", power: '5', toughness: '6',
    },
  };
}

function bear(extra: Record<string, unknown>) {
  return {
    id: 'mine', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'mine_card', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    ...extra,
  };
}

function setup(gameId: string, mine: any, extraPermanents: any[] = []) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = 3;
  state.battlefield = [mine, archon(), ...extraPermanents];
  const ctx: any = game;
  ctx.gameId = gameId;
  ResolutionQueueManager.removeQueue(gameId);
  return ctx;
}

function damageOn(ctx: any, id: string): number {
  const perm = (ctx.state.battlefield as any[]).find((p) => p.id === id);
  return Number(perm?.damageMarked ?? perm?.markedDamage ?? perm?.damage ?? 0);
}

function onBattlefield(ctx: any, id: string): boolean {
  return (ctx.state.battlefield as any[]).some((p) => p.id === id);
}

function castSpell(ctx: any, spellName: string, oracleText: string) {
  const outcome = tryResolveSpellViaOracleIR(ctx, {
    controller: p1,
    spellName,
    oracleText,
    sourceId: `${spellName.toLowerCase().replace(/\W+/g, '-')}-1`,
    targets: ['mine', 'archon'],
  } as any);
  expect(outcome.handled).toBe(true);
  ctx.runSBA?.();
}

const BUFFS: Array<[string, () => any, () => any[]]> = [
  ['+1/+1 counters', () => bear({ counters: { '+1/+1': 12 } }), () => []],
  [
    'an until-end-of-turn pump',
    () => bear({ temporaryPTMods: [{ power: 12, toughness: 12, source: 'Giant Growth x4', expiresAt: 'end_of_turn', turnApplied: 3 }] }),
    () => [],
  ],
  [
    'counters plus a static anthem',
    () => bear({ counters: { '+1/+1': 11 } }),
    () => [{
      id: 'anthem', controller: p1, owner: p1, tapped: false, counters: {},
      card: { id: 'anthem_card', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' },
    }],
  ],
];

describe('fight / bite use current (effective) power and toughness', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  for (const [label, makeMine, makeExtra] of BUFFS) {
    it(`computes 14/14 for a printed 2/2 with ${label}`, () => {
      const ctx = setup(`fight_pt_${label.replace(/\W+/g, '_')}`, makeMine(), makeExtra());
      const mine = (ctx.state.battlefield as any[]).find((p) => p.id === 'mine');
      expect(getCurrentPowerToughness(mine, ctx.state)).toEqual({ power: 14, toughness: 14 });
    });

    it(`Oracle IR fight: 2/2 with ${label} deals 14 to Blazing Archon, which dies; it survives 5`, () => {
      process.env.ORACLE_IR_SPELL_PRIMARY = '1';
      const ctx = setup(`fight_ir_${label.replace(/\W+/g, '_')}`, makeMine(), makeExtra());
      castSpell(ctx, 'Prey Upon', PREY_UPON);
      expect(onBattlefield(ctx, 'archon')).toBe(false);
      expect(onBattlefield(ctx, 'mine')).toBe(true);
      expect(damageOn(ctx, 'mine')).toBe(5);
    });
  }

  it('Oracle IR bite ("deals damage equal to its power") uses current power', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const ctx = setup('bite_ir_pump', bear({
      temporaryPTMods: [{ power: 12, toughness: 12, source: 'Pump', expiresAt: 'end_of_turn', turnApplied: 3 }],
    }));
    castSpell(ctx, 'Rabid Bite', RABID_BITE);
    expect(onBattlefield(ctx, 'archon')).toBe(false);
    expect(damageOn(ctx, 'mine')).toBe(0);
  });

  it('pump then fight in the same spell sees the pump (Oracle IR modifier not yet mirrored)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const ctx = setup('fight_ir_pump_then_fight', bear({}));
    castSpell(
      ctx,
      'Pump Fight',
      "Target creature you control gets +12/+12 until end of turn. Then it fights target creature you don't control.",
    );
    expect(onBattlefield(ctx, 'archon')).toBe(false);
    expect(onBattlefield(ctx, 'mine')).toBe(true);
    expect(damageOn(ctx, 'mine')).toBe(5);
    const mine = (ctx.state.battlefield as any[]).find((p) => p.id === 'mine');
    // After the program the pump is mirrored into temporaryPTMods; it must not be counted twice.
    expect(getCurrentPowerToughness(mine, ctx.state)).toEqual({ power: 14, toughness: 14 });
  });

  it('an unbuffed 2/2 still deals 2 (no regression) and dies to the Archon', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const ctx = setup('fight_ir_plain', bear({}));
    castSpell(ctx, 'Prey Upon', PREY_UPON);
    expect(damageOn(ctx, 'archon')).toBe(2);
    expect(onBattlefield(ctx, 'archon')).toBe(true);
    expect(onBattlefield(ctx, 'mine')).toBe(false);
  });

  it('planeswalker-template fight uses current power', () => {
    const ctx = setup('fight_pw_template_pump', bear({
      temporaryPTMods: [{ power: 12, toughness: 12, source: 'Pump', expiresAt: 'end_of_turn', turnApplied: 3 }],
    }));
    const handled = tryLoyaltyTemplateP1P1FightDamage(
      ctx,
      p1,
      'Garruk',
      { targets: ['mine', 'archon'] },
      { id: 'TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL' } as any,
      ctx.state,
      PREY_UPON,
    );
    expect(handled).toBe(true);
    expect(damageOn(ctx, 'archon')).toBe(14);
    expect(damageOn(ctx, 'mine')).toBe(5);
  });

  it('activated "This creature fights target creature" ability: each deals its own current power', () => {
    const ctx = setup('fight_activated_counters', bear({ counters: { '+1/+1': 12 } }));
    (ctx.state as any).stack = [{
      id: 'ability_fight_1',
      type: 'ability',
      controller: p1,
      source: 'mine',
      sourceName: 'Grizzly Bears',
      description: "This creature fights target creature you don't control.",
      abilityType: 'fight',
      targets: ['archon'],
      fightParams: { sourceCreatureId: 'mine', targetCreatureId: 'archon', sourceCreatureName: 'Grizzly Bears', targetCreatureName: 'Blazing Archon' },
    }];
    ctx.resolveTopOfStack();
    expect(onBattlefield(ctx, 'archon')).toBe(false);
    expect(onBattlefield(ctx, 'mine')).toBe(true);
    expect(damageOn(ctx, 'mine')).toBe(5);
  });
});