import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src/types.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { getMaxHandSizeForPlayer } from '../src/state/modules/handSizeUtils.js';
import { recordTurnStartedForPlayer, firstTurnsCastViolation } from '../src/state/modules/firstTurnsCastRestriction.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';
import { listAmplifyEligibleCards } from '../src/state/modules/amplifyEntry.js';
import { collectBatch23DamageCapSpecs, damageSourceIsInstantOrSorcerySpell } from '../src/state/modules/replacementBatch23DamageCap.js';
import { overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { findStaticSkipDrawStepSource } from '../../rules-engine/src/phaseTransitionTriggers.js';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { canBlock, parseCreatureKeywords, type CombatCreature } from '../src/state/modules/combat-mechanics.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Enchantment', extra: Record<string, unknown> = {}) =>
  ({ id, controller, owner: controller, card: { id: id + 'c', name, type_line: type, oracle_text: oracle }, ...extra });
// Single fixture adapter: tests build plain state objects.
const gs = (o: Record<string, unknown>): GameState => o as unknown as GameState;

describe('batch23 maximum hand size', () => {
  it('set, increase, reduce, opponents', () => {
    expect(computeStaticMaxHandSize([perm('a', 'p1', 'Null Profusion', 'Your maximum hand size is two.')], 'p1')).toBe(2);
    expect(computeStaticMaxHandSize([perm('a', 'p1', 'Trusted Advisor', 'Your maximum hand size is increased by two.')], 'p1')).toBe(9);
    expect(computeStaticMaxHandSize([perm('a', 'p1', 'Thought Eater', 'Your maximum hand size is reduced by three.')], 'p1')).toBe(4);
    const miser = [perm('a', 'p1', 'Locust Miser', "Each opponent's maximum hand size is reduced by two.")];
    expect(computeStaticMaxHandSize(miser, 'p2')).toBe(5);
    expect(computeStaticMaxHandSize(miser, 'p1')).toBe(7);
    expect(getMaxHandSizeForPlayer({ battlefield: miser }, 'p2')).toBe(5);
  });
});

describe('batch23 first turns cast restriction', () => {
  const avenger = { name: 'Serra Avenger', type_line: 'Creature - Angel', oracle_text: "You can't cast this spell during your first, second, or third turns of the game.\nFlying, vigilance" };
  it('counts own turns', () => {
    const s = gs({ players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [], turnPlayer: 'p1' });
    for (let i = 0; i < 3; i++) recordTurnStartedForPlayer(s);
    expect(firstTurnsCastViolation(s, 'p1', avenger)).toContain('turn 3');
    expect(findOracleCastingLimitViolation(s, 'p1', avenger).prohibited).toBe(true);
    recordTurnStartedForPlayer(s);
    expect(firstTurnsCastViolation(s, 'p1', avenger)).toBeNull();
    expect(firstTurnsCastViolation(gs({ ...s, turnPlayer: 'p2', turnsStartedByPlayer: { p1: 1 } }), 'p1', avenger)).toBeNull();
  });
});

describe('batch23 amplify', () => {
  it('adds counters per revealed sharing card', () => {
    const brute = perm('z', 'p1', 'Zombie Brute', 'Amplify 1 (As this creature enters, put a +1/+1 counter on it for each Zombie card you reveal in your hand.)\nTrample', 'Creature - Zombie');
    const state = { zones: { p1: { hand: [
      { id: 'h1', name: 'Gravedigger', type_line: 'Creature - Zombie' },
      { id: 'h2', name: 'Bear', type_line: 'Creature - Bear' },
      { id: 'h3', name: 'Mirror Entity', type_line: 'Creature - Shapeshifter', oracle_text: 'Changeling' },
    ] } } };
    expect(listAmplifyEligibleCards(state, brute, 'p1').map(c => c.id)).toEqual(['h1', 'h3']);
  });
});

describe('batch23 Forethought Amulet cap', () => {
  const AMULET = 'If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to you instead.';
  it('caps instant/sorcery damage to its controller', () => {
    const [spec] = collectBatch23DamageCapSpecs(AMULET.toLowerCase(), { sourcePermanentId: 'fa', sourceController: 'p1', sourceName: 'Forethought Amulet' });
    expect(spec.instead).toEqual({ modify: 'cap', value: 2 });
    const state = { battlefield: [], stack: [{ id: 's1', card: { id: 'bolt', type_line: 'Instant' } }, { id: 's2', card: { id: 'ench', type_line: 'Creature' } }] };
    expect(damageSourceIsInstantOrSorcerySpell(state, 's1')).toBe(true);
    expect(damageSourceIsInstantOrSorcerySpell(state, 's2')).toBe(false);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'bolt' }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'ench' }, state)).toBe(false);
  });
});

describe('batch23 Fasting skips the draw step', () => {
  it('detects the optional skip', () => {
    const bf = [perm('f', 'p1', 'Fasting', 'If you would begin your draw step, you may skip that step instead.')];
    expect(findStaticSkipDrawStepSource(gs({ battlefield: bf }), 'p1')).toBeUndefined();
    Object.assign(bf[0], { optionalDrawStepSkipTurn: 3 });
    expect(findStaticSkipDrawStepSource({ ...gs({ battlefield: bf }), turnNumber: 3 }, 'p1')).toBe('Fasting');
    expect(findStaticSkipDrawStepSource(gs({ battlefield: bf }), 'p2')).toBeUndefined();
  });
});

describe('batch23 defender variants', () => {
  it('Demon Wall with a counter, Ogre Jailbreaker with a Gate', () => {
    const wall = perm('w', 'p1', 'Demon Wall', "Defender, flying\nAs long as Demon Wall has a counter on it, it can attack as though it didn't have defender.", 'Creature - Demon Wall');
    expect(canAttackDespiteDefender(wall, [wall], 'p1')).toBe(false);
    const wall2 = { ...wall, counters: { '-1/-1': 1 } };
    expect(canAttackDespiteDefender(wall2, [wall2], 'p1')).toBe(true);
    const ogre = perm('o', 'p1', 'Ogre Jailbreaker', "Defender\nOgre Jailbreaker can attack as though it didn't have defender as long as you control a Gate.", 'Creature - Ogre Rogue');
    expect(canAttackDespiteDefender(ogre, [ogre], 'p1')).toBe(false);
    const gate = perm('g', 'p1', 'Guildgate', '', 'Land - Gate');
    expect(canAttackDespiteDefender(ogre, [ogre, gate], 'p1')).toBe(true);
  });
});

describe('batch23 combat-mechanics block shadow as though', () => {
  it('canBlock honours the keyword', () => {
    const mk = (p: ReturnType<typeof perm>): CombatCreature => ({ ...p, protections: [], abilities: [], keywords: parseCreatureKeywords(p.card, p, { battlefield: [p] }) } as unknown as CombatCreature);
    const shade = mk(perm('s', 'p2', 'Soltari', 'Shadow', 'Creature - Soltari'));
    const dryad = mk(perm('d', 'p1', 'Heartwood Dryad', 'Heartwood Dryad can block creatures with shadow as though it had shadow.', 'Creature - Dryad'));
    const bear = mk(perm('b', 'p1', 'Bear', '', 'Creature - Bear'));
    expect(canBlock(shade, dryad).legal).toBe(true);
    expect(canBlock(shade, bear).legal).toBe(false);
  });
});
