import { describe, expect, it } from 'vitest';
import { calculateMaxLandsPerTurn } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsLandPlayDraw.js';
import { landPlayRestrictionCap } from '../src/state/modules/landPlayRestrictionFamilies.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import { chooseUntapType } from '../src/state/modules/untapTypeChoiceRestriction.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text: string, extra: any = {}) => ({ id, controller, card: { name, type_line, oracle_text }, ...extra });
const JOCKEY = "You can't cast this spell if you've played a land this turn.\nYou can't play lands if you cast this spell this turn.";
const MATRIX = "As long as Storage Matrix is untapped, each player chooses artifact, creature, or land during their untap step. That player can untap only permanents of the chosen type this step.";

describe('B48: land play restrictions', () => {
  it('Rock Jockey stops its controller playing lands only on the turn it was cast', () => {
    const cast = perm('rj', 'p1', 'Rock Jockey', 'Creature - Goblin', JOCKEY, { enteredFromCast: true, enteredThisTurn: true });
    expect(landPlayRestrictionCap([cast], 'p1')?.cap).toBe(0);
    expect(landPlayRestrictionCap([cast], 'p2')).toBeNull();
    expect(landPlayRestrictionCap([{ ...cast, enteredThisTurn: false, summoningSickness: false }], 'p1')).toBeNull();
    expect(landPlayRestrictionCap([{ ...cast, enteredFromCast: false }], 'p1')).toBeNull();
    expect(calculateMaxLandsPerTurn({ state: { battlefield: [cast] } } as any, 'p1')).toBe(0);
  });
  it('"can\'t play more than one land each turn" caps land plays at one', () => {
    const law = perm('rl', 'p2', 'Rule Keeper', 'Enchantment', "Each player can't play more than one land each turn.");
    const azusa = perm('az', 'p1', 'Azusa, Lost but Seeking', 'Legendary Creature - Human Monk', 'You may play two additional lands on each of your turns.');
    expect(calculateMaxLandsPerTurn({ state: { battlefield: [azusa] } } as any, 'p1')).toBe(3);
    expect(calculateMaxLandsPerTurn({ state: { battlefield: [azusa, law] } } as any, 'p1')).toBe(1);
    const opp = perm('o', 'p2', 'Opp Keeper', 'Enchantment', "Your opponents can't play more than one land each turn.");
    expect(landPlayRestrictionCap([opp], 'p1')?.cap).toBe(1);
    expect(landPlayRestrictionCap([opp], 'p2')).toBeNull();
  });
});

describe('B48: Storage Matrix untap choice', () => {
  const matrix = perm('sm', 'p2', 'Storage Matrix', 'Artifact', MATRIX);
  it('defaults to the type with the most tapped permanents', () => {
    const bf = [matrix, perm('l1', 'p1', 'Forest', 'Basic Land - Forest', '', { tapped: true }), perm('l2', 'p1', 'Island', 'Basic Land - Island', '', { tapped: true }), perm('c1', 'p1', 'Bear', 'Creature - Bear', '', { tapped: true })];
    expect(chooseUntapType(bf, 'p1')).toBe('land');
    expect(qualifiedUntapProhibitionSource(bf, bf[3])).toBe('Storage Matrix');
    expect(qualifiedUntapProhibitionSource(bf, bf[1])).toBeNull();
    expect(qualifiedUntapProhibitionSource(bf, bf[3], { untapTypeChoice: { p1: 'creature' } })).toBeNull();
  });
  it('a tapped Storage Matrix does nothing, including when it untaps this step', () => {
    const tapped = { ...matrix, controller: 'p1', tapped: true };
    const bf: any[] = [tapped, perm('l1', 'p1', 'Forest', 'Basic Land - Forest', '', { tapped: true }), perm('l2', 'p1', 'Plains', 'Basic Land - Plains', '', { tapped: true }), perm('c1', 'p1', 'Bear', 'Creature - Bear', '', { tapped: true })];
    untapPermanentsForPlayer({ state: { battlefield: bf, players: [{ id: 'p1' }] } } as any, 'p1');
    expect(bf.every((p) => !p.tapped)).toBe(true);
  });
  it('an untapped Storage Matrix limits the untap step', () => {
    const bf: any[] = [matrix, perm('l1', 'p1', 'Forest', 'Basic Land - Forest', '', { tapped: true }), perm('l2', 'p1', 'Plains', 'Basic Land - Plains', '', { tapped: true }), perm('c1', 'p1', 'Bear', 'Creature - Bear', '', { tapped: true })];
    untapPermanentsForPlayer({ state: { battlefield: bf, players: [{ id: 'p1' }, { id: 'p2' }] } } as any, 'p1');
    expect(bf[1].tapped).toBe(false);
    expect(bf[3].tapped).toBe(true);
  });
});

describe('B48: census classifier late-batch module', () => {
  it('classifies the B48 families', () => {
    expect(sys("You can't play lands if Rock Jockey was cast this turn.", 'Rock Jockey')).toMatch(/landPlayRestrictionFamilies/);
    expect(sys("You can't play lands if you cast this spell this turn.", 'Rock Jockey')).toMatch(/landPlayRestrictionFamilies/);
    expect(sys("Each player can't play more than one land each turn.")).toMatch(/landPlayRestrictionFamilies/);
    expect(sys('As long as Storage Matrix is untapped, each player chooses artifact, creature, or land during their untap step.', 'Storage Matrix')).toMatch(/untapTypeChoiceRestriction/);
  });
});
