import { expect, it } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { applyPermanentBecomeCopyOfTargetPermanent } from '../src/state/modules/permanent-copy';
import { isPermanentPreventedFromUntapping } from '../src/state/modules/triggers/turn-phases';
import { getLandwalkUnblockableReason } from '../../shared/src/combatLandwalk';
import { applySpellLifelinkGain, spellHasGrantedLifelink } from '../src/state/modules/spellLifelinkGrant';
import { isCreatureGoaded } from '../src/state/modules/goad-effects';
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', pt = ['2','2'], extra: any = {}, colors = ['G']) => {
  const id = 'r10_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id, name, type_line, oracle_text, power: pt[0], toughness: pt[1], colors } } as any;
};
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, stack: [], life: { p1: 40, p2: 40 }, startingLife: 40, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } }, turnPlayer: 'p1', activePlayer: 'p1', ...extra } as any);
const pt = (perm: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(perm, s); };
const NIGHTMARE = "Flying\nNightmare's power and toughness are each equal to the number of Swamps you control.";

it('Korlash counts lands made Swamps by Evil Presence', () => {
  const f = P('Forest', 'Basic Land \u2014 Forest', '', ['','']);
  const ep = P('Evil Presence', 'Enchantment \u2014 Aura', 'Enchant land\nEnchanted land is a Swamp.', ['',''], { attachedTo: f.id }); f.attachments = [ep.id];
  const sw = P('Swamp', 'Basic Land \u2014 Swamp', '', ['','']);
  const k = P('Korlash, Heir to Blackblade', 'Legendary Creature \u2014 Zombie Warrior', "Korlash, Heir to Blackblade's power and toughness are each equal to the number of Swamps you control.", ['*','*']);
  expect(pt(k, st([f, ep, sw, k]))).toEqual({ power: 2, toughness: 2 });
});
it('Spark Double adds a +1/+1 counter to a creature copy, once', () => {
  const g = P('Grizzly', 'Legendary Creature \u2014 Bear', 'Trample');
  const sd = P('Spark Double', 'Creature \u2014 Illusion', "You may have Spark Double enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.", ['0','0']);
  const s = st([g, sd]); applyPermanentBecomeCopyOfTargetPermanent(s, sd.id, g.id);
  expect(sd.counters['+1/+1']).toBe(1); expect(sd.counters.loyalty).toBeUndefined();
  expect(pt(sd, s)).toEqual({ power: 3, toughness: 3 });
});
it('Clone copying Nightmare keeps the */* CDA', () => {
  const sw = P('Swamp', 'Basic Land \u2014 Swamp', '', ['','']); const sw2 = P('Swamp', 'Basic Land \u2014 Swamp', '', ['','']);
  const nm = P('Nightmare', 'Creature \u2014 Nightmare Horse', NIGHTMARE, ['*','*'], { basePower: 2, baseToughness: 2 });
  const c = P('Clone', 'Creature \u2014 Shapeshifter', 'You may have Clone enter as a copy of any creature on the battlefield.', ['0','0'], { basePower: 0, baseToughness: 0 });
  const s = st([sw, sw2, nm, c]); applyPermanentBecomeCopyOfTargetPermanent(s, c.id, nm.id);
  expect(c.card.power).toBe('*'); expect(pt(c, s)).toEqual({ power: 2, toughness: 2 });
  s.battlefield.push(P('Swamp', 'Basic Land \u2014 Swamp', '', ['','']));
  expect(pt(c, s)).toEqual({ power: 3, toughness: 3 });
});
it('Magnetic Mountain: only blue creatures do not untap', () => {
  const mm = P('Magnetic Mountain', 'Enchantment', "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.", ['',''], {}, ['R']);
  const blue = P('Merfolk', 'Creature \u2014 Merfolk', '', ['1','1'], { tapped: true }, ['U']);
  const green = P('Bear', 'Creature \u2014 Bear', '', ['2','2'], { tapped: true }, ['G']);
  const ctx: any = { state: st([mm, blue, green]) };
  expect(isPermanentPreventedFromUntapping(ctx, blue, 'p1')).toBe(true);
  expect(isPermanentPreventedFromUntapping(ctx, green, 'p1')).toBe(false);
  const ms = P('Meekstone-ish', 'Enchantment', "Creatures don't untap during their controllers' untap steps.", ['','']);
  expect(isPermanentPreventedFromUntapping({ state: st([ms, green]) } as any, green, 'p1')).toBe(true);
});
it("can't be blocked as long as defending player controls an artifact", () => {
  const bb = P('Bouncing Beebles', 'Creature \u2014 Beeble', "Bouncing Beebles can't be blocked as long as defending player controls an artifact.", ['2','2']);
  const art = P('Sol Ring', 'Artifact', '{T}: Add {C}{C}.', ['',''], { controller: 'p2' });
  expect(getLandwalkUnblockableReason(bb, 'p2', [bb, art])).toMatch(/controls an artifact$/);
  expect(getLandwalkUnblockableReason(bb, 'p2', [bb])).toBeUndefined();
  const mine = P('Sol Ring', 'Artifact', '', ['','']);
  expect(getLandwalkUnblockableReason(bb, 'p2', [bb, mine])).toBeUndefined();
});
it('census follow-ups: chosen type/color anthems, goading aura, unblockable aura', () => {
  const e = P('Etchings of the Chosen', 'Enchantment', 'As Etchings of the Chosen enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.', ['',''], { chosenCreatureType: 'Elf' });
  const elf = P('Elf', 'Creature \u2014 Elf'); const bear = P('Bear', 'Creature \u2014 Bear');
  const s = st([e, elf, bear]); expect(pt(elf, s)).toEqual({ power: 3, toughness: 3 }); expect(pt(bear, s)).toEqual({ power: 2, toughness: 2 });
  const cs = P('Caged Sun', 'Artifact', 'As Caged Sun enters, choose a color.\nCreatures you control of the chosen color get +1/+1.', ['',''], { chosenColor: 'green' });
  expect(pt(elf, st([cs, elf]))).toEqual({ power: 3, toughness: 3 });
  const g = P('Bear', 'Creature \u2014 Bear', '', ['2','2'], { controller: 'p2' });
  const a = P('Psychic Impetus', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature gets +2/+2 and is goaded.', ['',''], { attachedTo: g.id }); g.attachments = [a.id];
  const s3 = st([g, a]); expect(pt(g, s3)).toEqual({ power: 4, toughness: 4 }); expect(isCreatureGoaded(g, s3.battlefield)).toBe(true);
});
it('instant and sorcery spells you control have lifelink', () => {
  const rs = P('Radiant Scrollwielder', 'Creature \u2014 Dwarf Cleric', 'Instant and sorcery spells you control have lifelink.\nAt the beginning of your upkeep, exile an instant or sorcery card at random from your graveyard.', ['2','4']);
  const s = st([rs]);
  expect(spellHasGrantedLifelink(s, 'p1', 'Instant')).toBe(true);
  expect(spellHasGrantedLifelink(s, 'p1', 'Creature \u2014 Elf')).toBe(false);
  expect(spellHasGrantedLifelink(s, 'p2', 'Instant')).toBe(false);
  s.stack.push({ id: 'bolt', controller: 'p1', card: { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' } });
  expect(applySpellLifelinkGain({ state: s }, { sourceId: 'bolt', caster: 'p1', amount: 3 })).toBe(3);
  expect(s.life.p1).toBe(43);
  expect(applySpellLifelinkGain({ state: s }, { sourcePermanentId: rs.id, sourceId: 'bolt', caster: 'p1', amount: 3 })).toBe(0);
  s.stack = []; s.batch20ResolvingSpellSource = { id: 'shock', cardId: 'c1', card: { name: 'Shock', type_line: 'Instant' }, targets: [] };
  expect(applySpellLifelinkGain({ state: s }, { sourceId: 'shock', caster: 'p1', amount: 2 })).toBe(2);
  expect(s.life.p1).toBe(45);
});
