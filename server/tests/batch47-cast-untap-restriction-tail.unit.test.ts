import { describe, expect, it } from 'vitest';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text: string, extra: any = {}) => ({ id, controller, card: { name, type_line, oracle_text }, ...extra });
const base = (battlefield: any[] = [], extra: any = {}) => ({ players: [{ id: 'p1' }, { id: 'p2' }], battlefield, turnPlayer: 'p1', phase: 'main1', ...extra });

describe('B47: self cast restrictions', () => {
  const jockey = { name: 'Rock Jockey', type_line: 'Creature - Goblin', oracle_text: "You can't cast this spell if you've played a land this turn.\nYou can't play lands if you cast this spell this turn." };
  it("Rock Jockey: blocked after a land drop", () => {
    expect(castRestrictionTailViolation(base(), 'p1', jockey)).toBeNull();
    expect(castRestrictionTailViolation(base([], { landsPlayedThisTurn: { p1: 1 } }), 'p1', jockey)).toMatch(/land/);
  });
  it('Rakdos: needs an opponent to have lost life', () => {
    const rakdos = { name: 'Rakdos, Lord of Riots', type_line: 'Legendary Creature - Demon', oracle_text: "You can't cast this spell unless an opponent lost life this turn." };
    expect(castRestrictionTailViolation(base(), 'p1', rakdos)).toMatch(/opponent lost life/);
    expect(castRestrictionTailViolation(base([], { lifeLostThisTurn: { p1: 3 } }), 'p1', rakdos)).toMatch(/opponent lost life/);
    expect(castRestrictionTailViolation(base([], { lifeLostThisTurn: { p2: 1 } }), 'p1', rakdos)).toBeNull();
  });
});

describe('B47: battlefield cast restrictions', () => {
  it('Cornered Market blocks a spell sharing a nontoken permanent name', () => {
    const bf = [perm('cm', 'p2', 'Cornered Market', 'Enchantment', "Players can't cast spells with the same name as a nontoken permanent."), perm('b', 'p2', 'Grizzly Bears', 'Creature - Bear', '')];
    expect(castRestrictionTailViolation(base(bf), 'p1', { name: 'Grizzly Bears', type_line: 'Creature - Bear' })).toMatch(/same name/);
    expect(castRestrictionTailViolation(base(bf), 'p1', { name: 'Shock', type_line: 'Instant' })).toBeNull();
    const tokenOnly = [bf[0], perm('t', 'p2', 'Grizzly Bears', 'Creature - Bear', '', { isToken: true })];
    expect(castRestrictionTailViolation(base(tokenOnly), 'p1', { name: 'Grizzly Bears' })).toBeNull();
  });
  it('Angelic Arbiter stops opponents who attacked', () => {
    const bf = [perm('aa', 'p2', 'Angelic Arbiter', 'Creature - Angel', "Each opponent who attacked with a creature this turn can't cast spells.\nEach opponent who cast a spell this turn can't attack with creatures.")];
    expect(castRestrictionTailViolation(base(bf), 'p1', { name: 'Shock' })).toBeNull();
    expect(castRestrictionTailViolation(base(bf, { creaturesAttackedThisTurn: { p1: 2 } }), 'p1', { name: 'Shock' })).toMatch(/attacked/);
    expect(castRestrictionTailViolation(base(bf, { creaturesAttackedThisTurn: { p2: 2 } }), 'p2', { name: 'Shock' })).toBeNull();
  });
  it('Wardscale Dragon silences the defending player only while attacking', () => {
    const text = "Flying\nAs long as Wardscale Dragon is attacking, defending player can't cast spells.";
    expect(castRestrictionTailViolation(base([perm('wd', 'p2', 'Wardscale Dragon', 'Creature - Dragon', text, { attacking: 'p1' })]), 'p1', { name: 'Shock' })).toMatch(/defending/);
    expect(castRestrictionTailViolation(base([perm('wd', 'p2', 'Wardscale Dragon', 'Creature - Dragon', text)]), 'p1', { name: 'Shock' })).toBeNull();
  });
  it('Experimental Frenzy blocks hand casts only, through the live wrapper', () => {
    const bf = [perm('ef', 'p1', 'Experimental Frenzy', 'Enchantment', "You may look at the top card of your library any time.\nYou may play the top card of your library.\nYou can't play lands or cast spells from your hand.")];
    const spell = { name: 'Shock', type_line: 'Instant', mana_cost: '{R}' };
    expect(isSpellCastingProhibitedByStaticRestriction(base(bf), 'p1', spell, 'hand').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base(bf), 'p1', spell, 'library').prohibited).toBe(false);
    expect(isSpellCastingProhibitedByStaticRestriction(base(bf), 'p2', spell, 'hand').prohibited).toBe(false);
  });
});

describe('B47: untap prohibitions', () => {
  const legend = perm('l', 'p1', 'Legend', 'Legendary Creature - Human', '');
  const merc = perm('m', 'p1', 'Merc', 'Creature - Human Mercenary', '');
  const plain = perm('c', 'p1', 'Bear', 'Creature - Bear', '');
  it('legendary creatures', () => {
    const bf = [perm('a', 'p2', 'Arena of the Ancients', 'Legendary Artifact', "Legendary creatures don't untap during their controllers' untap steps."), legend, plain];
    expect(qualifiedUntapProhibitionSource(bf, legend)).toBe('Arena of the Ancients');
    expect(qualifiedUntapProhibitionSource(bf, plain)).toBeNull();
  });
  it('creature subtype plural', () => {
    const bf = [perm('r', 'p2', 'Root Cage', 'Enchantment', "Mercenaries don't untap during their controllers' untap steps."), merc, plain];
    expect(qualifiedUntapProhibitionSource(bf, merc)).toBe('Root Cage');
    expect(qualifiedUntapProhibitionSource(bf, plain)).toBeNull();
  });
  it('creatures with ice counters', () => {
    const iced = { ...plain, id: 'i', counters: { ice: 1 } };
    const bf = [perm('d', 'p2', 'Rimescale Dragon', 'Snow Creature - Dragon', "Creatures with ice counters on them don't untap during their controllers' untap steps."), iced, plain];
    expect(qualifiedUntapProhibitionSource(bf, iced)).toBe('Rimescale Dragon');
    expect(qualifiedUntapProhibitionSource(bf, plain)).toBeNull();
  });
});

describe('B47: census classification', () => {
  it('classifies the cast and untap tail', () => {
    for (const [line, name] of [
      ["You can't cast this spell if you've played a land this turn.", 'Rock Jockey'],
      ["You can't cast this spell unless an opponent lost life this turn.", 'Rakdos, Lord of Riots'],
      ["Players can't cast spells with the same name as a nontoken permanent.", 'Cornered Market'],
      ["Each opponent who attacked with a creature this turn can't cast spells.", 'Angelic Arbiter'],
      ["As long as Wardscale Dragon is attacking, defending player can't cast spells.", 'Wardscale Dragon'],
      ["You can't play lands or cast spells from your hand.", 'Experimental Frenzy'],
    ]) expect(sys(line, name)).toContain('castRestrictionTailFamilies');
    expect(sys("Legendary creatures don't untap during their controllers' untap steps.")).toContain('untapQualifierProhibitions');
    expect(sys("Mercenaries don't untap during their controllers' untap steps.")).toContain('untapQualifierProhibitions');
    expect(sys("Creatures with ice counters on them don't untap during their controllers' untap steps.")).toContain('untapQualifierProhibitions');
  });
});
