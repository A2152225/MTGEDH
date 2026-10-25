import { expect, it } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities';
import { applyPermanentBecomeCopyOfTargetPermanent } from '../src/state/modules/permanent-copy';
import { parseCopyEntryExceptions } from '../src/state/modules/copyEntryExceptions';
import { detectETBPlayerSelection } from '../src/socket/player-selection';
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', pt = ['2','2'], extra: any = {}, colors = ['G']) => {
  const id = 'r9_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id, name, type_line, oracle_text, power: pt[0], toughness: pt[1], colors } } as any;
};
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, life: { p1: 40, p2: 40 }, startingLife: 40, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } }, turnPlayer: 'p1', activePlayer: 'p1', ...extra } as any);
const pt = (perm: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(perm, s); };
const equip = (host: any, name: string, oracle: string, extra: any = {}) => { const e = P(name, 'Artifact \u2014 Equipment', oracle, ['',''], { attachedTo: host.id, ...extra }); host.attachments = [...(host.attachments || []), e.id]; return e; };
const NIGHTMARE = "Flying\nNightmare's power and toughness are each equal to the number of Swamps you control.";

it('as long as you control your commander (commandZone ids and isCommander flag)', () => {
  const o = 'As long as you control your commander, Buddy gets +2/+2.';
  const cmd = P('Boss', 'Legendary Creature \u2014 Elf'); const a = P('Buddy', 'Creature \u2014 Elf', o);
  expect(pt(a, st([a, cmd], { commandZone: { p1: { commanderIds: [cmd.card.id] } } }))).toEqual({ power: 4, toughness: 4 });
  const b = P('Buddy', 'Creature \u2014 Elf', o);
  expect(pt(b, st([b], { commandZone: { p1: { commanderIds: ['elsewhere'] } } }))).toEqual({ power: 2, toughness: 2 });
  const flagged = P('Boss', 'Legendary Creature \u2014 Elf', '', ['2','2'], { isCommander: true }); const c = P('Buddy', 'Creature \u2014 Elf', o);
  expect(pt(c, st([c, flagged]))).toEqual({ power: 4, toughness: 4 });
  const stolen = P('Boss', 'Legendary Creature \u2014 Elf', '', ['2','2'], { isCommander: true, owner: 'p2' }); const d = P('Buddy', 'Creature \u2014 Elf', o);
  expect(pt(d, st([d, stolen]))).toEqual({ power: 2, toughness: 2 });
});
it('Colossus Hammer / Starforged Sword remove flying', () => {
  const b = P('Bird', 'Creature \u2014 Bird', 'Flying'); const e = equip(b, 'Colossus Hammer', 'Equipped creature gets +10/+10 and loses flying.\nEquip {8}');
  const s = st([b, e]); expect(pt(b, s)).toEqual({ power: 12, toughness: 12 });
  expect(permanentHasKeywordAbility(b, 'flying', s.battlefield)).toBe(false);
  const b2 = P('Bird', 'Creature \u2014 Bird', 'Flying'); const e2 = equip(b2, 'Starforged Sword', 'Gift a tapped Fish\nEquipped creature gets +3/+3 and loses flying.\nEquip {3}');
  const s2 = st([b2, e2]); expect(pt(b2, s2)).toEqual({ power: 5, toughness: 5 });
  expect(permanentHasKeywordAbility(b2, 'flying', s2.battlefield)).toBe(false);
});
it('layer 4: Evil Presence makes a Forest a Swamp for counts', () => {
  const f = P('Forest', 'Basic Land \u2014 Forest', '', ['','']); const ep = P('Evil Presence', 'Enchantment \u2014 Aura', 'Enchant land\nEnchanted land is a Swamp.', ['',''], { attachedTo: f.id }); f.attachments = [ep.id];
  const nm = P('Nightmare', 'Creature \u2014 Nightmare Horse', NIGHTMARE, ['*','*']);
  const s = st([f, ep, nm]); expect(getEffectiveBasicLandTypes(s, f)).toEqual(['swamp']);
  expect(pt(nm, s)).toEqual({ power: 1, toughness: 1 });
});
it('layer 4: Leyline of the Guildpact lands are every basic type (counts and opponent-controls)', () => {
  const f = P('Forest', 'Basic Land \u2014 Forest', '', ['','']); const ly = P('Leyline of the Guildpact', 'Enchantment', 'Lands you control are every basic land type in addition to their other types.', ['','']);
  const nm = P('Nightmare', 'Creature \u2014 Nightmare Horse', NIGHTMARE, ['*','*']);
  const s = st([f, ly, nm]); expect(getEffectiveBasicLandTypes(s, f).length).toBe(5);
  expect(pt(nm, s)).toEqual({ power: 1, toughness: 1 });
  const wu = P('Wu Admiral', 'Creature \u2014 Human Soldier', 'Wu Admiral gets +1/+1 as long as an opponent controls an Island.', ['3','3']);
  const f3 = P('Forest', 'Basic Land \u2014 Forest', '', ['',''], { controller: 'p2', owner: 'p2' }); const ly3 = P('Leyline of the Guildpact', 'Enchantment', 'Lands you control are every basic land type in addition to their other types.', ['',''], { controller: 'p2', owner: 'p2' });
  expect(pt(wu, st([wu, f3, ly3]))).toEqual({ power: 4, toughness: 4 });
  const wu2 = P('Wu Admiral', 'Creature \u2014 Human Soldier', 'Wu Admiral gets +1/+1 as long as an opponent controls an Island.', ['3','3']);
  const f4 = P('Forest', 'Basic Land \u2014 Forest', '', ['',''], { controller: 'p2', owner: 'p2' });
  expect(pt(wu2, st([wu2, f4]))).toEqual({ power: 3, toughness: 3 });
});
it('layer 1: Clone copies copiable values only (no counters)', () => {
  const g = P('Grizzly', 'Creature \u2014 Bear', 'Trample', ['2','2'], { counters: { '+1/+1': 2 } });
  const c = P('Clone', 'Creature \u2014 Shapeshifter', 'You may have Clone enter as a copy of any creature on the battlefield.', ['0','0']);
  const s = st([g, c]); expect(applyPermanentBecomeCopyOfTargetPermanent(s, c.id, g.id).applied).toBe(true);
  expect(c.card.name).toBe('Grizzly'); expect(c.card.oracle_text).toBe('Trample');
  expect(pt(c, s)).toEqual({ power: 2, toughness: 2 });
  expect(pt(g, s)).toEqual({ power: 4, toughness: 4 });
});
it('layer 1: copy exceptions (Metamorph, Phantasmal Image, Spark Double, Gargantuan)', () => {
  const g = P('Grizzly', 'Legendary Creature \u2014 Bear', 'Trample');
  const m = P('Phyrexian Metamorph', 'Artifact Creature \u2014 Phyrexian Shapeshifter', "You may have Phyrexian Metamorph enter as a copy of an artifact or creature on the battlefield, except it's an artifact in addition to its other types.", ['0','0']);
  const s = st([g, m]); applyPermanentBecomeCopyOfTargetPermanent(s, m.id, g.id);
  expect(m.card.type_line).toBe('Legendary Artifact Creature \u2014 Bear');
  const im = P('Phantasmal Image', 'Creature \u2014 Illusion', 'You may have Phantasmal Image enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."', ['0','0']);
  const s2 = st([g, im]); applyPermanentBecomeCopyOfTargetPermanent(s2, im.id, g.id);
  expect(im.card.type_line).toBe('Legendary Creature \u2014 Bear Illusion');
  expect(im.card.oracle_text).toContain('When this creature becomes the target of a spell or ability, sacrifice it.');
  const sd = P('Spark Double', 'Creature \u2014 Illusion', "You may have Spark Double enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.", ['0','0']);
  const s3 = st([g, sd]); applyPermanentBecomeCopyOfTargetPermanent(s3, sd.id, g.id);
  expect(sd.card.type_line).toBe('Creature \u2014 Bear');
  const qg = P('Quicksilver Gargantuan', 'Creature \u2014 Shapeshifter', "You may have Quicksilver Gargantuan enter as a copy of any creature on the battlefield, except it's 7/7.", ['7','7']);
  const s4 = st([g, qg]); applyPermanentBecomeCopyOfTargetPermanent(s4, qg.id, g.id);
  expect(pt(qg, s4)).toEqual({ power: 7, toughness: 7 });
  expect(parseCopyEntryExceptions('You may have Clone enter as a copy of any creature on the battlefield.')).toBeNull();
});
it('census: hexproof as long as it entered this turn; indestructible at half starting life', () => {
  const a = P('Thrasta', 'Legendary Creature \u2014 Dinosaur', 'Trample, haste\nThrasta has hexproof as long as it entered this turn.', ['7','7'], { enteredThisTurn: true });
  const s1 = st([a]); pt(a, s1); expect(permanentHasKeywordAbility(a, 'hexproof', s1.battlefield)).toBe(true);
  const a2 = P('Thrasta', 'Legendary Creature \u2014 Dinosaur', 'Trample, haste\nThrasta has hexproof as long as it entered this turn.', ['7','7'], { enteredThisTurn: false });
  const s1b = st([a2]); pt(a2, s1b); expect(permanentHasKeywordAbility(a2, 'hexproof', s1b.battlefield)).toBe(false);
  const o = 'As long as your life total is less than or equal to half your starting life total, Bhaal has indestructible.';
  const b = P('Bhaal', 'Legendary Creature \u2014 Avatar', o);
  const s2 = st([b], { life: { p1: 20, p2: 40 } }); pt(b, s2); expect(permanentHasKeywordAbility(b, 'indestructible', s2.battlefield)).toBe(true);
  const b2 = P('Bhaal', 'Legendary Creature \u2014 Avatar', o);
  const s3 = st([b2], { life: { p1: 21, p2: 40 } }); pt(b2, s3); expect(permanentHasKeywordAbility(b2, 'indestructible', s3.battlefield)).toBe(false);
});
it("census: equipped creature gets +N/+N (Bride's Gown, Mind Carver, Banshee's Blade)", () => {
  const h = P('Hero', 'Legendary Creature \u2014 Human'); const e = equip(h, "Bride's Gown", "Equipped creature gets +2/+0. As long as equipped creature is legendary, it gets an additional +0/+2 and has first strike.\nEquip {2}");
  const s = st([h, e]); expect(pt(h, s)).toEqual({ power: 4, toughness: 4 });
  const b = P('Bear', 'Creature \u2014 Bear'); const e2 = equip(b, "Bride's Gown", "Equipped creature gets +2/+0. As long as equipped creature is legendary, it gets an additional +0/+2 and has first strike.\nEquip {2}");
  expect(pt(b, st([b, e2]))).toEqual({ power: 4, toughness: 2 });
  const c = P('Bear', 'Creature \u2014 Bear'); const e3 = equip(c, 'Mind Carver', 'Equipped creature gets +1/+0.\nDelirium \u2014 Equipped creature gets an additional +3/+1 as long as there are four or more card types among cards in your graveyard.\nEquip {2}');
  const gy = ['Creature \u2014 Elf', 'Instant', 'Land', 'Sorcery'].map((type_line, i) => ({ id: 'mg' + i, name: 'G' + i, type_line }));
  const s3 = st([c, e3]); s3.zones.p1.graveyard = gy; expect(pt(c, s3)).toEqual({ power: 6, toughness: 3 });
  const d = P('Bear', 'Creature \u2014 Bear'); const e4 = equip(d, 'Mind Carver', 'Equipped creature gets +1/+0.\nDelirium \u2014 Equipped creature gets an additional +3/+1 as long as there are four or more card types among cards in your graveyard.\nEquip {2}');
  expect(pt(d, st([d, e4]))).toEqual({ power: 3, toughness: 2 });
  const f = P('Bear', 'Creature \u2014 Bear'); const e5 = equip(f, "Banshee's Blade", "Equipped creature gets +1/+1 for each charge counter on Banshee's Blade.\nWhenever equipped creature deals combat damage, put a charge counter on Banshee's Blade.\nEquip {2}", { counters: { charge: 2 } });
  expect(pt(f, st([f, e5]))).toEqual({ power: 4, toughness: 4 });
});
it('census: enters under the control of an opponent of your choice (Xantcha, Pendant of Prosperity)', () => {
  for (const name of ['Xantcha, Sleeper Agent', 'Pendant of Prosperity']) {
    const short = name.split(',')[0];
    const sel = detectETBPlayerSelection({ name, type_line: 'Artifact', oracle_text: short + ' enters under the control of an opponent of your choice.' } as any);
    expect(sel.required).toBe(true);
    expect((sel as any).allowOpponentsOnly).toBe(true);
    expect((sel as any).effectData?.type).toBe('control_change');
  }
});
