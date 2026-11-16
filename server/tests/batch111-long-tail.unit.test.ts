import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import {
  applyBatch111BasePowerToughness,
  applyBatch111PowerToughnessAdjustment,
  batch111AddedColor,
  batch111AdditionalTypes,
  batch111AttackRestrictionReason,
  batch111BlockRestrictionReason,
  batch111LosesCreature,
  batch111PermanentHasKeyword,
  collectBatch111DamageAdjustments,
} from '../src/state/modules/batch111Apply.js';
import { getMaximumBlockers } from '../src/socket/combat-handlers/combatBatch30BlockLimits.js';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { applyBeneficialReplacements, detectDamageReplacementEffects } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsReplacementApply.js';
import { queueSkipDrawReplacementStep } from '../src/state/modules/zones-handlers/zonesDrawReplacementSkipDrawQueue.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';

function perm(id: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    card: { name, oracle_text: oracle, type_line: 'Creature — Bear', power: '2', toughness: '2' },
    ...extra,
  };
}

describe('batch 111 long-tail statics and replacements', () => {
  it('parses a static spec for the enchanted, chosen-type, and graveyard lines', () => {
    const mask = 'Enchanted creature gets +2/+2 for each other enchantment on the battlefield.';
    const plague = 'All creatures of the chosen type get -1/-1.';
    const doc = 'As long as there are eight or more cards in your graveyard, Doc Ock has base power and toughness 8/8.';
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('a', 'Ancestral Mask', mask, { attachedTo: 'host' }) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('b', 'Engineered Plague', plague) as any).length).toBeGreaterThan(0);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('c', 'Doc Ock', doc) as any).length).toBeGreaterThan(0);
  });

  it('adds enchanted power per other enchantment and replaces a base power from the graveyard', () => {
    const host = perm('host', 'Bear', '', { card: { name: 'Bear', oracle_text: '', type_line: 'Creature — Bear', power: '2', toughness: '2' } });
    const mask = perm('mask', 'Ancestral Mask', 'Enchanted creature gets +2/+2 for each other enchantment on the battlefield.', {
      attachedTo: 'host',
      card: { name: 'Ancestral Mask', oracle_text: 'Enchanted creature gets +2/+2 for each other enchantment on the battlefield.', type_line: 'Enchantment — Aura' },
    });
    const other = perm('other', 'Glory', '', { card: { name: 'Glory', oracle_text: '', type_line: 'Enchantment' } });
    const state = { battlefield: [host, mask, other] };
    expect(applyBatch111PowerToughnessAdjustment(host, state, 2, 2)).toEqual({ power: 4, toughness: 4 });

    const doc = perm('doc', 'Doc Ock', 'As long as there are eight or more cards in your graveyard, Doc Ock has base power and toughness 8/8.');
    const full = { battlefield: [doc], zones: { p1: { graveyard: new Array(8).fill({ name: 'Card' }) } } };
    expect(applyBatch111BasePowerToughness(doc, full, 2, 2)).toEqual({ power: 8, toughness: 8 });
    expect(applyBatch111BasePowerToughness(doc, { battlefield: [doc], zones: { p1: { graveyard: [] } } }, 2, 2)).toEqual({ power: 2, toughness: 2 });
  });

  it('sets goblin colors, forest types, and removes a creature below the graveyard count', () => {
    const crusade = perm('d', "Dralnu's Crusade", 'All Goblins are black and are Zombies in addition to their other creature types.');
    const goblin = perm('g', 'Goblin', '', { card: { name: 'Goblin', oracle_text: '', type_line: 'Creature — Goblin', colors: ['R'] } });
    const state = { battlefield: [crusade, goblin] };
    expect(batch111AddedColor(goblin, state)).toEqual(['B']);
    expect(getEffectiveColors(goblin, state)).toEqual(['B']);
    expect(batch111AdditionalTypes(goblin, state)).toContain('Zombie');

    const life = perm('life', 'Life and Limb', 'Forests you control are 1/1 green Elf creatures that are still lands.');
    const forest = perm('forest', 'Forest', '', { card: { name: 'Forest', oracle_text: '', type_line: 'Basic Land — Forest' } });
    const woods = { battlefield: [life, forest] };
    expect(batch111AdditionalTypes(forest, woods)).toEqual(expect.arrayContaining(['Creature', 'Elf']));
    expect(applyBatch111BasePowerToughness(forest, woods, 0, 0)).toEqual({ power: 1, toughness: 1 });

    const triad = perm('triad', 'The Warring Triad', "As long as there are fewer than eight cards in your graveyard, The Warring Triad isn't a creature.");
    expect(batch111LosesCreature(triad, { battlefield: [triad], zones: { p1: { graveyard: [] } } })).toBe(true);
    expect(batch111LosesCreature(triad, { battlefield: [triad], zones: { p1: { graveyard: new Array(8).fill({}) } } })).toBe(false);
  });

  it('blocks an attack without enough exile and a block by a non-Wall', () => {
    const ketramose = perm('k', 'Ketramose', "Ketramose can't attack or block unless there are seven or more cards in exile.");
    const reason = batch111AttackRestrictionReason(ketramose, ['k'], { battlefield: [ketramose], zones: { p1: { exile: [] } } }, 'p2');
    expect(reason).toMatch(/7 or more cards in exile/i);
    const allowed = batch111AttackRestrictionReason(ketramose, ['k'], {
      battlefield: [ketramose],
      zones: { p1: { exile: new Array(7).fill({}) } },
    }, 'p2');
    expect(allowed).toBeNull();

    const aura = perm('inv', 'Invisibility', "Enchanted creature can't be blocked except by Walls.", {
      attachedTo: 'atk',
      card: { name: 'Invisibility', oracle_text: "Enchanted creature can't be blocked except by Walls.", type_line: 'Enchantment — Aura' },
    });
    const atk = perm('atk', 'Bear', '');
    const bear = perm('blk', 'Bear', '', { controller: 'p2' });
    const wall = perm('wall', 'Wall', '', { controller: 'p2', card: { name: 'Wall', oracle_text: '', type_line: 'Creature — Wall' } });
    expect(batch111BlockRestrictionReason(atk, bear, [atk, aura, bear])).toMatch(/wall/i);
    expect(batch111BlockRestrictionReason(atk, wall, [atk, aura, wall])).toBeNull();
  });

  it('caps how many creatures can block a Boar and lets a big defender attack', () => {
    const boar = perm('boar', 'Boar', '', { card: { name: 'Boar', oracle_text: '', type_line: 'Creature — Boar' } });
    const lord = perm('lord', 'Boar Umbra', 'Boars you control can\'t be blocked by more than one creature.');
    expect(getMaximumBlockers(boar, [boar, lord])).toBe(1);
    const bigCard = { name: 'Karsus', oracle_text: "As long as Karsus's power is 5 or greater, Karsus can attack as though it didn't have defender.", type_line: 'Creature — Bear', power: '5', toughness: '5' };
    const smallCard = { ...bigCard, power: '2', toughness: '2' };
    const big = perm('kar', 'Karsus', bigCard.oracle_text, { power: 5, card: bigCard });
    const small = perm('kar', 'Karsus', smallCard.oracle_text, { power: 2, card: smallCard });
    expect(canAttackDespiteDefender(big, [big], 'p1', { battlefield: [big] })).toBe(true);
    expect(canAttackDespiteDefender(small, [small], 'p1', { battlefield: [small] })).toBe(false);
  });

  it('doubles a red spell and turns 4 or more damage into 3', () => {
    const servant = perm('fs', 'Fire Servant', 'If a red instant or sorcery spell you control would deal damage, it deals double that damage instead.');
    const presence = perm('dp', 'Divine Presence', 'If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.');
    const state = {
      battlefield: [servant, presence],
      stack: [{ id: 'bolt', card: { id: 'bolt', type_line: 'Instant', colors: ['R'] } }],
    };
    const doubled = detectDamageReplacementEffects({ state } as any, 'p1', 'p2', true, 'bolt', false);
    expect(applyBeneficialReplacements(3, doubled.filter((effect) => effect.type === 'double')).finalAmount).toBe(6);
    const capped = detectDamageReplacementEffects({ state } as any, 'p1', 'p2', true, 'bolt', false);
    expect(applyBeneficialReplacements(5, capped.filter((effect) => effect.type === 'cap_if_at_least')).finalAmount).toBe(3);
    expect(applyBeneficialReplacements(2, capped.filter((effect) => effect.type === 'cap_if_at_least')).finalAmount).toBe(2);
    expect(collectBatch111DamageAdjustments(state, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'bolt' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'double' }), expect.objectContaining({ type: 'cap_if_at_least', threshold: 4, value: 3 })]),
    );
  });

  it('queues an optional skip for any draw and grants flying after noncombat damage', () => {
    const familiar = perm('of', 'Obstinate Familiar', 'If you would draw a card, you may skip that draw instead.');
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [familiar], players: [{ id: 'p1' }, { id: 'p2' }] });
    expect(specs.some((spec: any) => spec.effectId === 'skip-draw-step-replacement')).toBe(true);
    const gameId = 'batch111-skip-draw';
    expect(queueSkipDrawReplacementStep({ gameId } as any, 'p1', { sourceName: 'Obstinate Familiar', sourcePermanentId: 'of' }, 0)).toBe(true);
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any).at(-1) as any;
    expect(step?.description).toMatch(/skip this draw/i);
    expect(step?.options?.map((option: any) => option.id)).toEqual(['draw', 'skip_draw']);

    const whip = perm('w', 'Whiplash Wordsmith', 'As long as an opponent was dealt noncombat damage this turn, this creature has flying and haste.');
    const quiet = { battlefield: [whip], noncombatDamageReceivedThisTurn: {} };
    expect(batch111PermanentHasKeyword(whip, quiet, 'flying')).toBe(false);
    expect(batch111PermanentHasKeyword(whip, { battlefield: [whip], noncombatDamageReceivedThisTurn: { p2: 1 } }, 'haste')).toBe(true);
  });
});
