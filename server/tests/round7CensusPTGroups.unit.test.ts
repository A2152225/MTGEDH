import { expect, it } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', pt = ['2','2'], extra: any = {}) => {
  const id = 'pz_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id, name, type_line, oracle_text, power: pt[0], toughness: pt[1], colors: ['G'] } } as any;
};
const st = (bf: any[], gy: any[] = []) => ({ battlefield: bf, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: gy, handCount: 0, graveyardCount: gy.length }, p2: { hand: [], graveyard: [], handCount: 0 } }, turnPlayer: 'p1' } as any);
// Each label ends with the expected P/T: "expect N" (N/N) or "expect P/T".
const show = (label: string, perm: any, s: any) => {
  syncDerivedContinuousEffects(s);
  const m = label.match(/expect (-?\d+)(?:\/(-?\d+))?/)!;
  expect(getCurrentPowerToughness(perm, s), label).toEqual({ power: Number(m[1]), toughness: Number(m[2] ?? m[1]) });
};
it('round 7 P/T census groups: Flayer, Polygoyf, Vampirism, Serra\'s Boon, Sulam Djinn and already-working groups', () => {
  { const b = P('Bear','Creature \u2014 Elf'); const e = P('Etchings of the Chosen','Enchantment','As Etchings of the Chosen enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.',['',''],{chosenCreatureType:'Elf'}); show('chosenType +1 expect 3', b, st([b,e])); }
  { const b = P('Bear','Creature \u2014 Elf'); const e = P('Caged Sun','Artifact','As Caged Sun enters, choose a color.\nCreatures you control of the chosen color get +1/+1.',['',''],{chosenColor:'green'}); show('chosenColor +1 expect 3', b, st([b,e])); }
  { const gy = [{id:'g1',type_line:'Artifact Creature \u2014 Golem'},{id:'g2',type_line:'Land'},{id:'g3',type_line:'Instant'}].map((c:any)=>({...c,name:c.id})); const f = P('Grim Flayer','Creature \u2014 Human Warrior','Trample\nGrim Flayer gets +2/+2 as long as there are four or more card types among cards in your graveyard.',['2','2']); show('flayer 4 types expect 4', f, st([f],gy)); }
  { const gy = [{id:'g1',type_line:'Artifact Creature \u2014 Golem'},{id:'g2',type_line:'Land'},{id:'g3',type_line:'Instant'},{id:'g4',type_line:'Sorcery'}].map((c:any)=>({...c,name:c.id})); const f = P('Polygoyf','Creature \u2014 Lhurgoyf',"Polygoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.",['*','1+*']); show('polygoyf expect 5/6', f, st([f],gy)); }
  { const b = P('Bear','Creature \u2014 Bear'); const o = P('O','Creature \u2014 Bear'); const v = P('Vampirism','Enchantment \u2014 Aura','Enchant creature\nEnchanted creature gets +1/+1 for each other creature you control.',['',''],{attachedTo:b.id}); b.attachments=[v.id]; show('vampirism expect 3', b, st([b,o,v])); }
  { const b = P('Bear','Creature \u2014 Bear'); const v = P("Serra's Boon",'Enchantment \u2014 Aura','Enchant creature\nEnchanted creature gets +1/+2 as long as it\'s white. Otherwise, it gets -2/-1.',['',''],{attachedTo:b.id}); b.attachments=[v.id]; show('serras boon green expect 0/1', b, st([b,v])); }
  { const b = P('Bear','Creature \u2014 Bear'); const v = P('Aether Tunnel','Enchantment \u2014 Aura','Enchant creature\nEnchanted creature gets +1/+0 and can\'t be blocked.',['',''],{attachedTo:b.id}); b.attachments=[v.id]; show('aether expect 3/2', b, st([b,v])); }
  { const b = P('Bear','Creature \u2014 Bear'); const v = P('Psychic Impetus','Enchantment \u2014 Aura','Enchant creature\nEnchanted creature gets +2/+2 and is goaded.',['',''],{attachedTo:b.id}); b.attachments=[v.id]; show('impetus expect 4', b, st([b,v])); }
  { const d = P('Sulam Djinn','Creature \u2014 Djinn','Sulam Djinn gets +2/+2 as long as green is the most common color among all permanents or is tied for most common.',['6','6']); show('djinn green expect 8', d, st([d])); }
  { const b = P('Bear','Creature \u2014 Bear'); const v = P("Bride's Gown",'Artifact \u2014 Equipment','Equipped creature gets +2/+0. It gets an additional +0/+2 and has first strike as long as it\'s equipped by Groom\'s Finery... Equip {2}',['',''],{attachedTo:b.id}); b.attachments=[v.id]; show('gown expect 4/2', b, st([b,v])); }
});
