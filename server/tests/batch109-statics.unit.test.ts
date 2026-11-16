import { describe, expect, it } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  applyBatch109PowerToughnessAdjustment,
  batch109AttackRestrictionReason,
  batch109AttackSourceForcesOthers,
  batch109BlockGroupRestrictionReason,
  batch109PermanentHasKeyword,
  batch109SnowUntapProhibition,
  collectBatch109DamageAdjustments,
  getBatch109BlockRestrictionReason,
  playerHasProtectionFromEachOpponent,
} from '../src/state/modules/batch109Apply.js';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { canPlayerBeTargetedByPlayer } from '../src/rules-engine/targeting-handlers/targetingPlayerProtectionKeyword.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import {
  applyDamageReplacementsMinimized,
  detectDamageReplacementEffects,
} from '../src/state/modules/game-state-effects-handlers/gameStateEffectsReplacementApply.js';
import { summarizeTokenAmountReplacements } from '../src/state/modules/replacementEffectSpec.js';
import { collectAttackPermanentCosts } from '../src/socket/combat-handlers/attackCostPermanentPayment.js';
import { collectEnchantedCreatureBlockPayment } from '../src/state/modules/enchantedBlockPaymentTax.js';
import {
  applyBatch110PowerToughnessAdjustment,
  batch110AdditionalTypes,
  batch110PermanentHasKeyword,
} from '../src/state/modules/batch110Apply.js';

const COMMON = 'Nonartifact creatures get +2/+2 as long as they all share a color.';
const BRAWLER = 'As long as you control a red or white permanent, this creature gets +1/+0 and has first strike.';
const SPHINX = "This creature has hexproof as long as you haven't cast a spell this turn.";
const JOCKEY = "As long as you've cast a noncreature spell this turn, this creature can attack as though it didn't have defender.";
const VIRTUE = "You have protection from each of your opponents.";
const SERPENT = "Krakens, Leviathans, Octopuses, and Serpents you control can't be blocked except by Krakens, Leviathans, Octopuses, and Serpents.";
const CONSCRIPTS = "This creature can't attack unless at least two other creatures attack.\nThis creature can't block unless at least two other creatures block.";
const BEY = 'If this creature attacks, all creatures you control attack if able.';
const RADIANCE = "Snow permanents don't untap during their controllers' untap steps.";
const BILBO = 'If you would create a Food token, instead create a Food token and a Treasure token.';
const GOLDNIGHT = 'If a source would deal damage to you, it deals double that damage to you instead.\nIf a source would deal damage to this creature, it deals double that damage to this creature instead.';
const OJER = "If a red source you control would deal an amount of noncombat damage less than Ojer Axonil's power to an opponent, that source deals damage equal to Ojer Axonil's power instead.";
const SHIELD = 'If a source would deal damage to equipped creature, prevent 2 of that damage.';
const CAMEL = 'As long as this creature is attacking, prevent all damage Deserts would deal to this creature and to creatures banded with this creature.';
const CLAM = 'Each creature you control gets +1/+1 for each +1/+1 counter on it.';
const ZINNIA = 'Zinnia gets +X/+0, where X is the number of other creatures you control with base power 1.';
const KIN = 'Creatures you control get +X/+X, where X is the number of creatures that entered the battlefield under your control this turn.';
const JETMIR = 'Creatures you control also get +1/+0 and have trample as long as you control six or more creatures.\nCreatures you control also get +1/+0 and have double strike as long as you control nine or more creatures.';
const FLESH = 'Creatures you control with +1/+1 counters on them are artifacts in addition to their other types.\nNonartifact creatures get -1/-1.';
const WISP = 'Creatures attacking the last chosen player get +1/+0.';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  const { type_line, power, toughness, colors, counters, ...rest } = extra as any;
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: counters || {},
    ...rest,
    card: {
      id: `${id}-c`,
      name,
      oracle_text: oracle,
      type_line: type_line || 'Creature — Bear',
      power: power ?? '2',
      toughness: toughness ?? '2',
      colors: colors || ['G'],
    },
  };
}

function stateWith(battlefield: any[], extra: Record<string, unknown> = {}) {
  return { battlefield, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], turnPlayer: 'p1', ...extra };
}

describe('B109 census counts finished UI cards', () => {
  it('classifies Street Wraith, Arctic Merfolk, and Karn\'s Sylex as other systems', () => {
    expect(classifyStaticCensusLine('Cycling\u2014Pay 2 life.', 'Street Wraith')?.system).toMatch(/cycling/i);
    expect(classifyStaticCensusLine("Kicker\u2014Return a creature you control to its owner's hand.", 'Arctic Merfolk')?.system).toMatch(/kicker/i);
    expect(classifyStaticCensusLine("Players can't pay life to cast spells or to activate abilities that aren't mana abilities.", "Karn's Sylex")?.system).toMatch(/pay life/i);
  });

  it('still counts Valgavoth and Breathstealer\'s Crypt', () => {
    expect(classifyStaticCensusLine('During your turn, you may play cards exiled with Valgavoth.', 'Valgavoth, Terror Eater')?.system).toBeTruthy();
    expect(classifyStaticCensusLine('If a player would draw a card, instead they draw a card and reveal it.', "Breathstealer's Crypt")?.system).toMatch(/breathstealer/i);
  });
});

describe('B109 statics', () => {
  it('gives nonartifact creatures +2/+2 only while they share a color', () => {
    const cause = perm('cc', 'p1', 'Common Cause', COMMON, { type_line: 'Enchantment' });
    const bear = perm('b', 'p1', 'Bear', '', { colors: ['G'], power: '2', toughness: '2' });
    const elf = perm('e', 'p2', 'Elf', '', { colors: ['G'] });
    const goblin = perm('g', 'p2', 'Goblin', '', { colors: ['R'] });
    expect(parseStaticEffectSpecsFromOraclePermanent(cause as any).some((spec) => String(spec.id).includes('share_a_color'))).toBe(true);
    expect(applyBatch109PowerToughnessAdjustment(bear, stateWith([cause, bear, elf]), 2, 2)).toEqual({ power: 4, toughness: 4 });
    expect(applyBatch109PowerToughnessAdjustment(bear, stateWith([cause, bear, goblin]), 2, 2)).toEqual({ power: 2, toughness: 2 });
  });

  it('gives Battle Brawler first strike and +1/+0 while a listed color is present', () => {
    const brawler = perm('bb', 'p1', 'Battle Brawler', BRAWLER, { colors: ['R'] });
    const state = stateWith([brawler]);
    expect(batch109PermanentHasKeyword(brawler, state, 'first strike')).toBe(true);
    expect(applyBatch109PowerToughnessAdjustment(brawler, state, 2, 2)).toEqual({ power: 3, toughness: 2 });
    brawler.card.colors = [];
    expect(batch109PermanentHasKeyword(brawler, stateWith([brawler]), 'first strike')).toBe(false);
  });

  it('gives Stoic Sphinx hexproof until its controller casts a spell', () => {
    const sphinx = perm('ss', 'p1', 'Stoic Sphinx', SPHINX);
    expect(batch109PermanentHasKeyword(sphinx, stateWith([sphinx]), 'hexproof')).toBe(true);
    const cast = stateWith([sphinx], { spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Instant' } }] });
    expect(batch109PermanentHasKeyword(sphinx, cast, 'hexproof')).toBe(false);
  });

  it('lets Starfleet Spanner Jockey attack after a noncreature spell', () => {
    const jockey = perm('j', 'p1', 'Starfleet Spanner Jockey', JOCKEY, { type_line: 'Creature — Human' });
    const quiet = stateWith([jockey]);
    const cast = stateWith([jockey], { spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Instant' } }] });
    expect(canAttackDespiteDefender(jockey, [jockey], 'p1', quiet)).toBe(false);
    expect(canAttackDespiteDefender(jockey, [jockey], 'p1', cast)).toBe(true);
  });

  it('stops opponents damaging or targeting a player with Absolute Virtue', () => {
    const virtue = perm('av', 'p1', 'Absolute Virtue', VIRTUE, { type_line: 'Creature — Avatar' });
    const state = stateWith([virtue]);
    expect(playerHasProtectionFromEachOpponent(state, 'p1')).toBe(true);
    expect(canPlayerBeTargetedByPlayer('p1' as any, state as any, 'p2' as any)).toBe(false);
    expect(canPlayerBeTargetedByPlayer('p1' as any, state as any, 'p1' as any)).toBe(true);
    const effects = detectDamageReplacementEffects({ state } as any, 'p2', 'p1', true, 'src', false, undefined);
    expect(effects.some((effect) => effect.type === 'cap' && effect.value === 0)).toBe(true);
    const own = detectDamageReplacementEffects({ state } as any, 'p1', 'p1', false, 'src', false, undefined);
    expect(own.some((effect) => effect.type === 'cap')).toBe(false);
  });

  it('limits Serpent of Yawning Depths blockers to the same types', () => {
    const serpent = perm('s', 'p1', 'Serpent of Yawning Depths', SERPENT, { type_line: 'Creature — Serpent' });
    const kraken = perm('k', 'p2', 'Kraken', '', { type_line: 'Creature — Kraken' });
    const bear = perm('b', 'p2', 'Bear', '', { type_line: 'Creature — Bear' });
    expect(getBatch109BlockRestrictionReason(serpent, bear, [serpent, bear])).toMatch(/except/i);
    expect(getBatch109BlockRestrictionReason(serpent, kraken, [serpent, kraken])).toBeNull();
  });

  it('requires Orcish Conscripts to attack and block with two others', () => {
    const orc = perm('o', 'p1', 'Orcish Conscripts', CONSCRIPTS);
    expect(batch109AttackRestrictionReason(orc, ['o'], stateWith([orc]))).toMatch(/2 other/i);
    expect(batch109AttackRestrictionReason(orc, ['o', 'a', 'b'], stateWith([orc]))).toBeNull();
    expect(batch109BlockGroupRestrictionReason([{ blockerId: 'o' }], [orc])).toMatch(/2 other/i);
    expect(batch109BlockGroupRestrictionReason([{ blockerId: 'o' }, { blockerId: 'a' }, { blockerId: 'b' }], [orc, perm('a', 'p1', 'A', ''), perm('b', 'p1', 'B', '')])).toBeNull();
  });

  it('recognizes Viashino Bey forcing the rest of the team', () => {
    expect(batch109AttackSourceForcesOthers(perm('v', 'p1', 'Viashino Bey', BEY))).toBe(true);
  });

  it('stops snow permanents untapping under Freyalise\'s Radiance', () => {
    const radiance = perm('fr', 'p1', "Freyalise's Radiance", RADIANCE, { type_line: 'Enchantment' });
    const snow = perm('land', 'p2', 'Snow-Covered Forest', '', { type_line: 'Basic Snow Land — Forest' });
    const forest = perm('f', 'p2', 'Forest', '', { type_line: 'Basic Land — Forest' });
    const state = stateWith([radiance, snow, forest]);
    expect(batch109SnowUntapProhibition(state.battlefield, snow, state)).toBeTruthy();
    expect(qualifiedUntapProhibitionSource(state.battlefield, snow, state)).toBeTruthy();
    expect(qualifiedUntapProhibitionSource(state.battlefield, forest, state)).toBeNull();
  });
});

describe('B109 replacements', () => {
  it('adds a Treasure when Bilbo\'s controller creates a Food', () => {
    const bilbo = perm('bilbo', 'p1', 'Bilbo, Fellow Conspirator', BILBO, { type_line: 'Legendary Creature — Halfling' });
    const summary = summarizeTokenAmountReplacements(stateWith([bilbo]), 'p1', { tokenName: 'Food' });
    expect(summary.additionalTokens?.map((token) => token.name)).toEqual(['Treasure']);
    const other = summarizeTokenAmountReplacements(stateWith([bilbo]), 'p1', { tokenName: 'Clue' });
    expect(other.additionalTokens || []).toEqual([]);
  });

  it('doubles damage to Goldnight Castigator and to its controller', () => {
    const angel = perm('gc', 'p1', 'Goldnight Castigator', GOLDNIGHT, { type_line: 'Creature — Angel' });
    const state = stateWith([angel]);
    const toYou = detectDamageReplacementEffects({ state } as any, 'p2', 'p1', true, 'src', false, undefined);
    expect(toYou.some((effect) => effect.type === 'double')).toBe(true);
    const toSelf = detectDamageReplacementEffects({ state } as any, 'p2', 'p1', false, 'src', true, 'gc');
    expect(toSelf.some((effect) => effect.type === 'double')).toBe(true);
    expect(applyDamageReplacementsMinimized(3, toYou.filter((effect) => effect.type === 'double')).finalAmount).toBe(6);
  });

  it('raises Ojer Axonil noncombat damage to his power', () => {
    const ojer = perm('oj', 'p1', 'Ojer Axonil, Deepest Might', OJER, { type_line: 'Legendary Creature — God', power: '4', colors: ['R'] });
    (ojer as any).power = 4;
    const shock = perm('bolt', 'p1', 'Shock', '', { type_line: 'Instant', colors: ['R'] });
    const state = stateWith([ojer, shock]);
    const raised = collectBatch109DamageAdjustments(state, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'bolt', isCombatDamage: false });
    expect(raised).toEqual([expect.objectContaining({ type: 'floor', value: 4 })]);
    expect(applyDamageReplacementsMinimized(1, raised as any).finalAmount).toBe(4);
    expect(applyDamageReplacementsMinimized(6, raised as any).finalAmount).toBe(6);
    const combat = collectBatch109DamageAdjustments(state, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'bolt', isCombatDamage: true });
    expect(combat).toEqual([]);
  });

  it('prevents 2 damage to the creature equipped by Shield of the Realm', () => {
    const shield = perm('sh', 'p1', 'Shield of the Realm', SHIELD, { type_line: 'Artifact — Equipment' });
    (shield as any).attachedTo = 'bear';
    const bear = perm('bear', 'p1', 'Bear', '');
    const effects = detectDamageReplacementEffects({ state: stateWith([shield, bear]) } as any, 'p2', 'p1', false, 'src', false, 'bear');
    const prevent = effects.filter((effect) => effect.type === 'add_flat' && effect.value === -2);
    expect(prevent).toHaveLength(1);
    expect(applyDamageReplacementsMinimized(5, prevent).finalAmount).toBe(3);
  });

  it('prevents Desert damage to an attacking Camel and a banded creature', () => {
    const camel = perm('cam', 'p1', 'Camel', CAMEL, { type_line: 'Creature — Camel' });
    (camel as any).attacking = 'p2';
    (camel as any).bandedWith = ['ally'];
    const ally = perm('ally', 'p1', 'Ally', '');
    const desert = perm('des', 'p2', 'Desert', '', { type_line: 'Land — Desert' });
    const state = stateWith([camel, ally, desert]);
    const toCamel = collectBatch109DamageAdjustments(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'des', targetPermanentId: 'cam' });
    expect(toCamel.some((effect) => effect.type === 'prevent')).toBe(true);
    const toAlly = collectBatch109DamageAdjustments(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'des', targetPermanentId: 'ally' });
    expect(toAlly.some((effect) => effect.type === 'prevent')).toBe(true);
    (camel as any).attacking = false;
    const idle = collectBatch109DamageAdjustments(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'des', targetPermanentId: 'cam' });
    expect(idle).toEqual([]);
  });
});

describe('B109 and B110 payment prompts', () => {
  it('asks to sacrifice a land to attack with Exalted Dragon and two Islands for Leviathan', () => {
    const dragon = perm('d', 'p1', 'Exalted Dragon', "This creature can't attack unless you sacrifice a land.");
    const leviathan = perm('l', 'p1', 'Leviathan', "This creature can't attack unless you sacrifice two Islands.");
    const dragonCost = collectAttackPermanentCosts(stateWith([dragon]), 'p1', [{ creatureId: 'd' }]);
    expect(dragonCost).toEqual([expect.objectContaining({ kind: 'sacrifice', permanentType: 'land', count: 1 })]);
    const leviathanCost = collectAttackPermanentCosts(stateWith([leviathan]), 'p1', [{ creatureId: 'l' }]);
    expect(leviathanCost).toEqual([expect.objectContaining({ kind: 'sacrifice', permanentType: 'island', count: 2 })]);
  });

  it('charges Awesome Presence {3} for each creature blocking the enchanted attacker', () => {
    const aura = perm('ap', 'p2', 'Awesome Presence', "Enchanted creature can't be blocked unless defending player pays {3} for each creature they control that's blocking it.", { type_line: 'Enchantment — Aura' });
    (aura as any).attachedTo = 'atk';
    const atk = perm('atk', 'p1', 'Attacker', '');
    const b1 = perm('b1', 'p2', 'Blocker', '');
    const b2 = perm('b2', 'p2', 'Blocker 2', '');
    const tax = collectEnchantedCreatureBlockPayment(stateWith([aura, atk, b1, b2]), 'p2', [
      { blockerId: 'b1', attackerId: 'atk' },
      { blockerId: 'b2', attackerId: 'atk' },
    ]);
    expect(tax).toEqual({ cost: 6, sources: ['Awesome Presence'] });
  });

  it('counts Ranar, Shredder\'s Armor, and the attack and block payments as other systems', () => {
    expect(classifyStaticCensusLine('The first card you foretell each turn costs {0} to foretell.', 'Ranar the Ever-Watchful')?.system).toMatch(/foretell/i);
    expect(classifyStaticCensusLine('Equip\u2014Sacrifice another nonland permanent.', "Shredder's Armor")?.system).toMatch(/equip/i);
    expect(classifyStaticCensusLine("This creature can't attack unless you sacrifice a land.", 'Exalted Dragon')?.system).toMatch(/sacrifice a land/i);
    expect(classifyStaticCensusLine("This creature can't attack unless you sacrifice two Islands.", 'Leviathan')?.system).toMatch(/islands/i);
    expect(classifyStaticCensusLine("Enchanted creature can't be blocked unless defending player pays {3} for each creature they control that's blocking it.", 'Awesome Presence')?.system).toMatch(/pays/i);
  });
});

describe('B110 statics', () => {
  it('adds Clamavus +1/+1 for each +1/+1 counter on that creature', () => {
    const clam = perm('cl', 'p1', 'Clamavus', CLAM, { type_line: 'Creature — Human' });
    const bear = perm('b', 'p1', 'Bear', '', { counters: { '+1/+1': 3 } });
    expect(applyBatch110PowerToughnessAdjustment(bear, stateWith([clam, bear]), 2, 2)).toEqual({ power: 5, toughness: 5 });
  });

  it('gives Zinnia +X/+0 for other base-power-1 creatures', () => {
    const zinnia = perm('z', 'p1', "Zinnia, Valley's Voice", ZINNIA, { type_line: 'Legendary Creature — Bird Bard', power: '1', toughness: '3' });
    const one = perm('a', 'p1', 'Token', '', { power: '1', toughness: '1' });
    const big = perm('b', 'p1', 'Big', '', { power: '4', toughness: '4' });
    expect(applyBatch110PowerToughnessAdjustment(zinnia, stateWith([zinnia, one, big]), 1, 3)).toEqual({ power: 2, toughness: 3 });
  });

  it('pumps Kinbinding by creatures that entered this turn', () => {
    const kin = perm('kin', 'p1', 'Kinbinding', KIN, { type_line: 'Enchantment' });
    const entered = perm('e', 'p1', 'Kithkin', '');
    (entered as any).enteredThisTurn = true;
    const older = perm('o', 'p1', 'Older', '');
    expect(applyBatch110PowerToughnessAdjustment(older, stateWith([kin, entered, older]), 2, 2)).toEqual({ power: 3, toughness: 3 });
  });

  it('adds Jetmir trample at six creatures and double strike at nine', () => {
    const jetmir = perm('j', 'p1', 'Jetmir, Nexus of Revels', JETMIR, { type_line: 'Legendary Creature — Cat Demon' });
    const friends = Array.from({ length: 8 }, (_, i) => perm(`f${i}`, 'p1', 'Cat', ''));
    const six = stateWith([jetmir, ...friends.slice(0, 5)]);
    expect(batch110PermanentHasKeyword(jetmir, six, 'trample')).toBe(true);
    expect(batch110PermanentHasKeyword(jetmir, six, 'double strike')).toBe(false);
    expect(applyBatch110PowerToughnessAdjustment(jetmir, six, 5, 4).power).toBe(6);
    const nine = stateWith([jetmir, ...friends]);
    expect(batch110PermanentHasKeyword(jetmir, nine, 'double strike')).toBe(true);
    expect(applyBatch110PowerToughnessAdjustment(jetmir, nine, 5, 4).power).toBe(7);
  });

  it('makes Flesh Is Weak counters into artifacts and shrinks other creatures', () => {
    const flesh = perm('fl', 'p1', 'The Flesh Is Weak', FLESH, { type_line: 'Enchantment' });
    const pumped = perm('p', 'p1', 'Pumped', '', { counters: { '+1/+1': 1 } });
    const plain = perm('q', 'p2', 'Plain', '');
    const state = stateWith([flesh, pumped, plain]);
    expect(batch110AdditionalTypes(pumped, state)).toEqual(['Artifact']);
    expect(applyBatch110PowerToughnessAdjustment(pumped, state, 2, 2)).toEqual({ power: 2, toughness: 2 });
    expect(applyBatch110PowerToughnessAdjustment(plain, state, 2, 2)).toEqual({ power: 1, toughness: 1 });
  });

  it('pumps creatures attacking Beckoning Will-o\'-Wisp\'s last chosen player', () => {
    const wisp = perm('w', 'p1', "Beckoning Will-o'-Wisp", WISP, { type_line: 'Creature — Spirit' });
    (wisp as any).lastChosenPlayer = 'p2';
    const attacker = perm('a', 'p1', 'Attacker', '');
    (attacker as any).attacking = 'p2';
    const other = perm('b', 'p1', 'Other', '');
    (other as any).attacking = 'p3';
    const state = stateWith([wisp, attacker, other]);
    expect(applyBatch110PowerToughnessAdjustment(attacker, state, 1, 1)).toEqual({ power: 2, toughness: 1 });
    expect(applyBatch110PowerToughnessAdjustment(other, state, 1, 1)).toEqual({ power: 1, toughness: 1 });
  });
});
