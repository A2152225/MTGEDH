import { describe, expect, it } from 'vitest';
import { permanentHasKeywordAbility, permanentLosesKeyword } from '../src/permanentKeywordAbilities';
import { oracleTextHasOwnKeyword } from '../src/oracleOwnKeywordText';
import { createCombatCreature } from '../src/combatAutomation';
import { checkEvasionAbilities } from '../src/actions/combat-handlers/combatLegalityHelpers';

function perm(id: string, oracle: string, extra: any = {}, cardExtra: any = {}) {
  return {
    id,
    controller: extra.controller || 'p1',
    owner: extra.controller || 'p1',
    tapped: false,
    counters: {},
    ...extra,
    card: { id: `${id}_card`, name: id, type_line: 'Creature - Human Soldier', oracle_text: oracle, power: '2', toughness: '2', ...cardExtra },
  } as any;
}

describe('accurate keyword detection', () => {
  it('ground creature that references flying is not a flyer', () => {
    const archer = perm('archer', '{T}: This creature deals 2 damage to target creature with flying.', {}, { keywords: [] });
    const plucker = perm('plucker', 'Reach\nWhenever this creature blocks a creature with flying, it gets +2/+0.', {}, { keywords: ['Reach'] });
    expect(permanentHasKeywordAbility(archer, 'flying', [archer])).toBe(false);
    expect(permanentHasKeywordAbility(plucker, 'flying', [plucker])).toBe(false);
    expect(permanentHasKeywordAbility(plucker, 'reach', [plucker])).toBe(true);
    expect(createCombatCreature(archer).keywords.flying).toBe(false);
    expect(oracleTextHasOwnKeyword('Creatures you control have haste, flying.', 'flying')).toBe(false);
    expect(oracleTextHasOwnKeyword('{U}: This creature gains flying until end of turn.', 'flying')).toBe(false);
    expect(oracleTextHasOwnKeyword('Flying, vigilance (This creature can block creatures with flying.)', 'vigilance')).toBe(true);
    expect(oracleTextHasOwnKeyword('Flying, vigilance', 'flying')).toBe(true);
  });

  it('a lord grants flying to others but not itself unless it says so', () => {
    const lord = perm('lord', 'Other creatures you control have flying.', {}, { keywords: ['Flying'] });
    const bear = perm('bear', '');
    const oppBear = perm('oppBear', '', { controller: 'p2' });
    const bf = [lord, bear, oppBear];
    expect(permanentHasKeywordAbility(lord, 'flying', bf)).toBe(false);
    expect(permanentHasKeywordAbility(bear, 'flying', bf)).toBe(true);
    expect(permanentHasKeywordAbility(oppBear, 'flying', bf)).toBe(false);

    const allLord = perm('allLord', 'Creatures you control have flying.', {}, { keywords: ['Flying'] });
    expect(permanentHasKeywordAbility(allLord, 'flying', [allLord])).toBe(true);

    const tribal = perm('tribal', 'Other Soldier creatures you control get +1/+1 and have vigilance.');
    const elf = perm('elf', '', {}, { type_line: 'Creature - Elf' });
    expect(permanentHasKeywordAbility(bear, 'vigilance', [tribal, bear, elf])).toBe(true);
    expect(permanentHasKeywordAbility(elf, 'vigilance', [tribal, bear, elf])).toBe(false);
    expect(permanentHasKeywordAbility(tribal, 'vigilance', [tribal, bear, elf])).toBe(false);
  });

  it('an equipment grant counts', () => {
    const bear = perm('bear', '', { attachedEquipment: ['wings'] });
    const wings = perm('wings', 'Equipped creature gets +1/+1 and has flying and first strike.\nEquip {2}', { attachedTo: 'bear' }, { type_line: 'Artifact - Equipment' });
    expect(permanentHasKeywordAbility(bear, 'flying', [bear, wings])).toBe(true);
    expect(permanentHasKeywordAbility(bear, 'first strike', [bear, wings])).toBe(true);
    expect(permanentHasKeywordAbility(wings, 'flying', [bear, wings])).toBe(false);
  });

  it('counters and temporary abilities count', () => {
    const c = perm('c', '', { counters: { flying: 1 } });
    const t = perm('t', '', { temporaryAbilities: [{ ability: 'trample', expiresAt: 'end_of_turn' }] });
    expect(permanentHasKeywordAbility(c, 'flying', [c])).toBe(true);
    expect(permanentHasKeywordAbility(t, 'trample', [t])).toBe(true);
  });

  it('loses flying removes it', () => {
    const angel = perm('angel', 'Flying', { controller: 'p2' }, { keywords: ['Flying'] });
    const sphere = perm('sphere', 'All creatures lose flying.', {}, { type_line: 'Enchantment' });
    expect(permanentHasKeywordAbility(angel, 'flying', [angel])).toBe(true);
    expect(permanentHasKeywordAbility(angel, 'flying', [angel, sphere])).toBe(false);
    const aura = perm('aura', 'Enchant creature\nEnchanted creature loses flying.', { attachedTo: 'angel' }, { type_line: 'Enchantment - Aura' });
    expect(permanentLosesKeyword(angel, 'flying', [angel, aura])).toBe(true);
    const temp = perm('temp', 'Flying', { temporaryEffects: [{ description: 'loses flying until end of turn' }] });
    expect(permanentHasKeywordAbility(temp, 'flying', [temp])).toBe(false);
    const oppOnly = perm('opp', 'Creatures your opponents control lose flying.', {}, { type_line: 'Enchantment' });
    const own = perm('own', 'Flying', {}, { keywords: ['Flying'] });
    expect(permanentHasKeywordAbility(own, 'flying', [own, oppOnly])).toBe(true);
    expect(permanentHasKeywordAbility(angel, 'flying', [angel, oppOnly])).toBe(false);
  });

  it('evasion: a ground creature can block a "with flying" reference card, not a real flyer', () => {
    const archer = perm('archer', '{T}: This creature deals 2 damage to target creature with flying.', { controller: 'p2', attacking: 'p1' });
    const flyer = perm('flyer', 'Flying', { controller: 'p2', attacking: 'p1' }, { keywords: ['Flying'] });
    const bear = perm('bear', '');
    const bf = [archer, flyer, bear];
    expect(checkEvasionAbilities(bear, archer, bf).canParticipate).toBe(true);
    expect(checkEvasionAbilities(bear, flyer, bf).canParticipate).toBe(false);
    // An attacker with reach does not let a ground creature block its flying.
    const reachFlyer = perm('rf', 'Flying, reach', { controller: 'p2', attacking: 'p1' });
    expect(checkEvasionAbilities(bear, reachFlyer, [reachFlyer, bear]).canParticipate).toBe(false);
  });
});

describe('self can\'t-block detection', () => {
  it('an activated "target creature can\'t block" does not stop the card blocking', async () => {
    const { canPermanentBlock } = await import('../src/actions/combat-handlers/combatLegalityHelpers');
    const heelcutter = perm('heel', 'Dash {2}{R}\nWhenever this creature attacks, target creature can\'t block this turn.');
    const brute = perm('brute', 'This creature can\'t block.');
    const attacker = perm('atk', '', { controller: 'p2', attacking: 'p1' });
    const bf = [heelcutter, brute, attacker];
    expect(canPermanentBlock(heelcutter, attacker, bf).canParticipate).toBe(true);
    expect(canPermanentBlock(brute, attacker, bf).canParticipate).toBe(false);
    const tempCant = perm('tc', '', { temporaryEffects: [{ description: "can't block this turn" }] });
    expect(canPermanentBlock(tempCant, attacker, [...bf, tempCant]).canParticipate).toBe(false);
    const drums = perm('drums', 'Creatures your opponents control can\'t block.', { controller: 'p2' }, { type_line: 'Enchantment' });
    expect(canPermanentBlock(heelcutter, attacker, [...bf, drums]).canParticipate).toBe(false);
  });
});
