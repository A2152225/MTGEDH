import { beforeAll, it } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
const CARDS: any = {
  pennant: { name: 'Dawn-Blessed Pennant', type_line: 'Artifact', oracle_text: 'As this artifact enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\nWhenever a permanent you control of the chosen type enters, you gain 1 life.\n{2}, {T}, Sacrifice this artifact: Return target card of the chosen type from your graveyard to your hand.' },
  torque: { name: 'Rimefire Torque', type_line: 'Artifact', oracle_text: 'As this artifact enters, choose a creature type.\nWhenever a permanent you control of the chosen type enters, put a charge counter on this artifact.\n{T}, Remove three charge counters from this artifact: When you next cast an instant or sorcery spell this turn, copy it. You may choose new targets for the copy.' },
};
for (const k of Object.keys(CARDS)) for (const [nm, tl] of [['Elf Tribe', 'Creature - Elf'], ['Goblin Guy', 'Creature - Goblin'], ['Elf Kindred Thing', 'Kindred Artifact - Elf']]) it(k + ' ' + nm, async () => {
  const gid = 'pp_' + k + nm.replace(/ /g, '');
  createGameIfNotExists(gid, 'commander', 40, undefined, 'p1');
  const g: any = ensureGame(gid); g.gameId = gid;
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }]; g.state.life = { p1: 40 };
  g.state.zones = { p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 20 } };
  g.state.battlefield = [{ id: 'src', controller: 'p1', owner: 'p1', chosenCreatureType: 'Elf', counters: {}, card: { id: 'srcc', ...CARDS[k] } }];
  g.state.stack = [{ id: 's1', type: 'spell', controller: 'p1', card: { id: 'e1', name: nm, type_line: tl, oracle_text: '', mana_cost: '{G}' }, targets: [] }];
  resolveTopOfStack(g);
  const trig = g.state.stack.filter((s: any) => s.type === 'triggered_ability');
  console.log('PROBE', k, nm, JSON.stringify(trig.map((t: any) => [t.sourceName, t.triggerType, t.effect])));
  for (let i = 0; i < 3 && g.state.stack.length; i++) resolveTopOfStack(g);
  console.log('PROBE2', k, nm, 'life', g.state.life?.p1, g.state.players[0].life, 'counters', JSON.stringify(g.state.battlefield.find((p: any) => p.id === 'src')?.counters));
});
