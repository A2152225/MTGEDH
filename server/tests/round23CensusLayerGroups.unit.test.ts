import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects, getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow';
import { applyCreatureDamageFromSource } from '../src/state/modules/combat-damage-processing';
import { recordCreatureDealtDamageToPlayerThisTurn } from '../src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateRuntimeHelpers';
import { recordPlaneswalkerCombatDamage } from '../src/state/modules/turn-handlers/turnCombatDamageRecipientVariantTriggers';
let n = 0;
const P = (name: string, tl: string, o: string, extra: any = {}) => ({ id: 'y' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'd' + n, name, type_line: tl, oracle_text: o, power: '2', toughness: '2', colors: [] }, ...extra });
const st = (bf: any[]) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, zones: { p1: { graveyard: [], hand: [] }, p2: { graveyard: [], hand: [] } }, turnPlayer: 'p1' });
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };
const G = "Karakyk Guardian has hexproof if it hasn't dealt damage yet.";

it('hasDealtDamage: creature-to-creature damage from a source sets it, prevented damage does not', () => {
  const g = P('Karakyk Guardian', 'Creature \u2014 Dragon', G); const b = P('Bear', 'Creature \u2014 Bear', '');
  const s: any = st([g, b]);
  expect(ab(g, s)).toContain('hexproof');
  applyCreatureDamageFromSource({ state: s } as any, g, b, 0);
  expect((g as any).hasDealtDamage).toBeUndefined();
  const r = applyCreatureDamageFromSource({ state: s } as any, g, b, 2);
  expect(r.appliedAmount).toBe(2);
  expect((g as any).hasDealtDamage).toBe(true);
  expect(ab(g, s)).not.toContain('hexproof');
});
it('hasDealtDamage: noncombat damage to a player and combat damage to a planeswalker', () => {
  const g = P('Karakyk Guardian', 'Creature \u2014 Dragon', G); const h = P('Karakyk Guardian', 'Creature \u2014 Dragon', G);
  const s: any = st([g, h]);
  recordCreatureDealtDamageToPlayerThisTurn({ state: s } as any, g, 'p2' as any, 3);
  recordPlaneswalkerCombatDamage({ state: s } as any, h.id, { id: 'pw', controller: 'p2' }, 2);
  expect((g as any).hasDealtDamage).toBe(true); expect((h as any).hasDealtDamage).toBe(true);
});
it('N or more counters: leading form with keywords (Voice of the Blessed)', () => {
  const o = 'As long as this creature has four or more +1/+1 counters on it, it has flying and vigilance.\nAs long as this creature has ten or more +1/+1 counters on it, it has indestructible.';
  const v = P('Voice of the Blessed', 'Creature \u2014 Spirit Cleric', o, { counters: { '+1/+1': 4 } });
  const s = st([v]);
  const a = ab(v, s); expect(a).toContain('flying'); expect(a).toContain('vigilance'); expect(a).not.toContain('indestructible');
  v.counters = { '+1/+1': 10 }; expect(ab(v, s)).toContain('indestructible');
  v.counters = { '+1/+1': 3 }; expect(ab(v, s)).not.toContain('flying');
});
it('N or more counters of any kind adds a creature type (Hero of Bretagard)', () => {
  const h = P('Hero of Bretagard', 'Creature \u2014 Human Warrior', 'As long as this creature has five or more counters on it, it has flying and is an Angel in addition to its other types.', { counters: { '+1/+1': 3, flying: 2 } });
  const s = st([h]);
  expect(ab(h, s)).toContain('flying');
  expect([...getCreatureTypesNow(h)].map((t: any) => String(t).toLowerCase())).toContain('angel');
});
it('trailing form: keyword (Primordial Hydra) and P/T (Armored Scrapgorger)', () => {
  const hy = P('Primordial Hydra', 'Creature \u2014 Hydra', 'This creature has trample as long as it has ten or more +1/+1 counters on it.', { counters: { '+1/+1': 10 } });
  const sc = P('Armored Scrapgorger', 'Creature \u2014 Phyrexian Beast', 'This creature gets +3/+0 as long as it has three or more oil counters on it.', { counters: { oil: 3 } });
  const s = st([hy, sc]);
  expect(ab(hy, s)).toContain('trample');
  expect(getCurrentPowerToughness(sc, s)).toEqual({ power: 5, toughness: 2 });
  sc.counters = { oil: 2 }; syncDerivedContinuousEffects(s);
  expect(getCurrentPowerToughness(sc, s)).toEqual({ power: 2, toughness: 2 });
});
