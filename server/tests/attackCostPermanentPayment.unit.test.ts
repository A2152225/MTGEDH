import { describe, expect, it } from 'vitest';
import {
  collectAttackPermanentCosts,
  collectBlockTapCreatureCosts,
  buildAttackCostPermanentValidTargets,
  buildAttackCostTapValidTargets,
  describeAttackPermanentCost,
  payAttackCostPermanentSelections,
} from '../src/socket/combat-handlers/attackCostPermanentPayment.js';

const HW_ORACLE =
  "This creature can't attack or block unless you tap an untapped creature you control not declared as an attacking or blocking creature this combat.";

function perm(id: string, name: string, oracle: string, controller = 'p1', type_line = 'Creature', colors: string[] = [], extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, ...extra, card: { name, type_line, oracle_text: oracle, colors } };
}

describe('attackCostPermanentPayment', () => {
  it('collects Floodtide Serpent return-enchantment cost', () => {
    const serpent = perm('s1', 'Floodtide Serpent', "Floodtide Serpent can't attack unless you return an enchantment you control to its owner's hand.", 'p1', 'Creature — Serpent', ['U']);
    const aura = perm('a1', 'Pacifism', 'Enchant creature', 'p1', 'Enchantment — Aura');
    const reqs = collectAttackPermanentCosts(
      { battlefield: [serpent, aura] },
      'p1',
      [{ creatureId: 's1', targetPlayerId: 'p2' }],
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'return_to_hand', permanentType: 'enchantment', count: 1, attackerIds: ['s1'] });
    expect(describeAttackPermanentCost(reqs[0])).toMatch(/return an enchantment/i);
    const targets = buildAttackCostPermanentValidTargets([serpent, aura], 'p1', 'enchantment', new Set(['s1']));
    expect(targets.map((t) => t.id)).toEqual(['a1']);
  });

  it('collects Flooded Woodlands sacrifice-a-land per black attacker', () => {
    const woodlands = perm('w1', 'Flooded Woodlands', "Black creatures can't attack unless their controller sacrifices a land of their choice for each.", 'p2', 'Enchantment');
    const black1 = perm('b1', 'Bog Wraith', '', 'p1', 'Creature — Wraith', ['B']);
    const black2 = perm('b2', 'Shadow', '', 'p1', 'Creature — Shade', ['B']);
    const red = perm('r1', 'Goblin', '', 'p1', 'Creature — Goblin', ['R']);
    const land1 = perm('l1', 'Swamp', '', 'p1', 'Basic Land — Swamp');
    const land2 = perm('l2', 'Forest', '', 'p1', 'Basic Land — Forest');
    const reqs = collectAttackPermanentCosts(
      { battlefield: [woodlands, black1, black2, red, land1, land2] },
      'p1',
      [
        { creatureId: 'b1', targetPlayerId: 'p2' },
        { creatureId: 'b2', targetPlayerId: 'p2' },
        { creatureId: 'r1', targetPlayerId: 'p2' },
      ],
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'sacrifice', permanentType: 'land', count: 2 });
    expect(reqs[0].attackerIds.sort()).toEqual(['b1', 'b2']);
    const targets = buildAttackCostPermanentValidTargets(
      [woodlands, black1, black2, red, land1, land2], 'p1', 'land', new Set(['b1', 'b2', 'r1']),
    );
    expect(targets.map((t) => t.id).sort()).toEqual(['l1', 'l2']);
  });

  it('pays by returning the chosen enchantment to hand', async () => {
    const serpent = perm('s1', 'Floodtide Serpent', "Floodtide Serpent can't attack unless you return an enchantment you control to its owner's hand.");
    const aura = perm('a1', 'Pacifism', '', 'p1', 'Enchantment — Aura');
    const game: any = {
      state: {
        battlefield: [serpent, aura],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } },
      },
      libraries: new Map(),
      bumpSeq() {},
    };
    const result = await payAttackCostPermanentSelections(game, 'g1', 'p1', 'return_to_hand', ['a1']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movedIds).toEqual(['a1']);
    expect(game.state.battlefield.some((p: any) => p.id === 'a1')).toBe(false);
  });

  it('pays by sacrificing the chosen land', async () => {
    const land = perm('l1', 'Swamp', '', 'p1', 'Basic Land — Swamp');
    const game: any = {
      state: {
        battlefield: [land],
        players: [{ id: 'p1' }],
        zones: { p1: { hand: [], graveyard: [] } },
      },
      libraries: new Map(),
      bumpSeq() {},
    };
    const result = await payAttackCostPermanentSelections(game, 'g1', 'p1', 'sacrifice', ['l1']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movedNames).toEqual(['Swamp']);
    expect(game.state.battlefield.some((p: any) => p.id === 'l1')).toBe(false);
  });

  it('collects Hollow Warrior tap-creature attack cost and eligible targets', () => {
    const hw = perm('hw1', 'Hollow Warrior', HW_ORACLE, 'p1', 'Artifact Creature — Golem Warrior');
    const bear = perm('bear1', 'Grizzly Bears', '', 'p1', 'Creature — Bear');
    const tapped = perm('tap1', 'Tapped Bear', '', 'p1', 'Creature — Bear', [], { tapped: true });
    const otherAtk = perm('atk1', 'Other', '', 'p1', 'Creature — Bear');
    const reqs = collectAttackPermanentCosts(
      { battlefield: [hw, bear, tapped, otherAtk] },
      'p1',
      [
        { creatureId: 'hw1', targetPlayerId: 'p2' },
        { creatureId: 'atk1', targetPlayerId: 'p2' },
      ],
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'tap', permanentType: 'creature', count: 1, attackerIds: ['hw1'] });
    expect(describeAttackPermanentCost(reqs[0])).toMatch(/tap an untapped creature/i);
    const targets = buildAttackCostTapValidTargets(
      [hw, bear, tapped, otherAtk],
      'p1',
      new Set(['hw1', 'atk1']),
    );
    expect(targets.map((t) => t.id)).toEqual(['bear1']);
  });

  it('collects Hollow Warrior tap-creature block cost', () => {
    const hw = perm('hw1', 'Hollow Warrior', HW_ORACLE, 'p1', 'Artifact Creature — Golem Warrior');
    const bear = perm('bear1', 'Grizzly Bears', '', 'p1', 'Creature — Bear');
    const reqs = collectBlockTapCreatureCosts(
      { battlefield: [hw, bear] },
      'p1',
      [{ blockerId: 'hw1', attackerId: 'enemy1' }],
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'tap', blockerIds: ['hw1'], count: 1 });
    expect(describeAttackPermanentCost(reqs[0], 'block')).toMatch(/Pay to block/i);
  });

  it('pays Hollow Warrior cost by tapping the chosen creature', async () => {
    const hw = perm('hw1', 'Hollow Warrior', HW_ORACLE, 'p1', 'Artifact Creature — Golem Warrior');
    const bear = perm('bear1', 'Grizzly Bears', '', 'p1', 'Creature — Bear');
    const game: any = {
      state: {
        battlefield: [hw, bear],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } },
      },
      libraries: new Map(),
      bumpSeq() {},
    };
    const result = await payAttackCostPermanentSelections(
      game, 'g1', 'p1', 'tap', ['bear1'], { excludedCombatantIds: ['hw1'] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movedIds).toEqual(['bear1']);
    expect(game.state.battlefield.find((p: any) => p.id === 'bear1')?.tapped).toBe(true);
    expect(game.state.battlefield.find((p: any) => p.id === 'hw1')?.tapped).toBe(false);
  });
});
