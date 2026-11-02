import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects, getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { getEffectiveColors } from '../src/state/modules/effectiveColors';
import { hasSelfAllColorsCDA } from '../src/state/modules/selfAllColorsCDA';
import { permanentRejectsAuraSpellTargets } from '../src/rules-engine/auraSpellTargetRestriction';
import { trackCreatureDamageToPlayer } from '../src/state/modules/turn-handlers/turnCombatDamageTracking';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities';
let n = 0;
const P = (name: string, tl: string, o: string, extra: any = {}) => ({ id: 'x' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'c' + n, name, type_line: tl, oracle_text: o, power: '2', toughness: '2', colors: [] }, ...extra });
const st = (bf: any[]) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, zones: { p1: { graveyard: [], hand: [] }, p2: { graveyard: [], hand: [] } }, turnPlayer: 'p1' });
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };

it('is all colors: trailing color-identity sentence (Fallaji Wayfarer)', () => {
  const f = P('Fallaji Wayfarer', 'Creature \u2014 Human Scout', "Fallaji Wayfarer is all colors. This ability doesn\u2019t affect its color identity.");
  expect(hasSelfAllColorsCDA(f.card)).toBe(true);
  const s = st([f]); syncDerivedContinuousEffects(s);
  expect([...getEffectiveColors(f, s)].map(String).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
});
it('each nonland permanent you control is all colors (Leyline of the Guildpact), lands and opponents excluded', () => {
  const art = P('Rock', 'Artifact', ''); const land = P('Forest', 'Basic Land \u2014 Forest', ''); const opp = P('Opp Rock', 'Artifact', '', { controller: 'p2' });
  const src = P('Leyline of the Guildpact', 'Enchantment', 'Each nonland permanent you control is all colors.');
  const s = st([art, land, opp, src]); syncDerivedContinuousEffects(s);
  expect([...getEffectiveColors(art, s)].length).toBe(5);
  expect([...getEffectiveColors(land, s)].length).toBe(0);
  expect([...getEffectiveColors(opp, s)].length).toBe(0);
});
it("can't be the target of Aura spells: self subject only", () => {
  expect(permanentRejectsAuraSpellTargets(P('Bartel Runeaxe', 'Legendary Creature \u2014 Giant Warrior', "Vigilance\nBartel Runeaxe can't be the target of Aura spells."))).toBe(true);
  expect(permanentRejectsAuraSpellTargets(P('Tetsuo Umezawa', 'Legendary Creature \u2014 Human Archer', "Tetsuo Umezawa can\u2019t be the target of Aura spells.\n{U}{B}{B}{R}, {T}: Destroy target tapped or blocking creature."))).toBe(true);
  expect(permanentRejectsAuraSpellTargets(P('Bear', 'Creature \u2014 Bear', ''))).toBe(false);
});
it("hexproof if it hasn't dealt damage yet (Karakyk Guardian) turns off once it deals damage", () => {
  const g = P('Karakyk Guardian', 'Creature \u2014 Dragon', "Flying, vigilance, trample\nKarakyk Guardian has hexproof if it hasn't dealt damage yet.");
  const s: any = st([g]);
  expect(ab(g, s)).toContain('hexproof');
  trackCreatureDamageToPlayer({ state: s } as any, g.id, g.card.name, 'p2', 3);
  expect((g as any).hasDealtDamage).toBe(true);
  expect(ab(g, s)).not.toContain('hexproof');
});
it('enchanted creature loses flying (Grounded) is observable as a keyword loss', () => {
  const b = P('Bird', 'Creature \u2014 Bird', 'Flying');
  const a = { ...P('Grounded', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature loses flying.'), attachedTo: b.id };
  expect(permanentHasKeywordAbility(b, 'flying', [b])).toBe(true);
  expect(permanentHasKeywordAbility(b, 'flying', [b, a])).toBe(false);
});
