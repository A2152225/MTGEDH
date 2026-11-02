import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { triggerETBEffectsForToken } from '../src/state/modules/triggerEtbEntryEffects-handlers/triggerEtbTokenEntryEffects.js';
import { getTurnScopedSpellTriggerSources } from '../src/state/modules/triggers/turnScopedSpellTriggers.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const SPELLS: Record<string, string> = {
  glimpse: 'Whenever you cast a creature spell this turn, draw a card.',
  frenzy: 'All creatures get -1/-1 until end of turn. Whenever a creature dies this turn, you gain 1 life.',
  rite: 'Whenever a creature or enchantment you control enters this turn, draw a card.\nDraw a card.',
  hunter: 'Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.',
};
const bear = (id: string, controller = 'p1') => ({ id, controller, owner: 'p1', tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });

function setup(gameId: string, key: string, battlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
  g.state.battlefield = battlefield;
  g.state.turnNumber = 5;
  const lib = Array.from({ length: 5 }, (_, i) => ({ id: 'l' + i, name: 'Island', type_line: 'Basic Land - Island' }));
  g.state.zones = { p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: lib, libraryCount: 5 }, p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 } };
  g.state.stack = [{ id: 'st_' + key, type: 'spell', controller: 'p1', card: { id: key, name: key, type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, oracle_text: SPELLS[key] }, targets: [] }];
  resolveTopOfStack(g);
  g.state.stack = [];
  return g;
}

describe('round 30 spell-created "this turn" trigger sources for other event families', () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });

  it('Glimpse of Nature: creature spells cast this turn trigger; noncreature and next turn do not', () => {
    const g = setup('r30_glimpse', 'glimpse');
    const creature = { id: 'cs', name: 'Elf', type_line: 'Creature - Elf', oracle_text: '' };
    expect(getSpellCastTriggers(g, 'p1', creature).length).toBe(1);
    expect(getSpellCastTriggers(g, 'p1', { id: 'x', name: 'Shock', type_line: 'Instant', oracle_text: '' }).length).toBe(0);
    expect(getSpellCastTriggers(g, 'p2', creature).length).toBe(0);
    g.state.turnNumber = 6;
    expect(getSpellCastTriggers(g, 'p1', creature).length).toBe(0);
  });

  it('Death Frenzy: any creature dying this turn triggers', () => {
    const b = bear('b1', 'p2');
    const g = setup('r30_frenzy', 'frenzy', [b]);
    const res = getDeathTriggers(g, b, 'p2');
    expect(res.length).toBe(1);
    expect(String((res[0] as any).source?.controllerId || (res[0] as any).controllerId || (res[0] as any).source?.controller || '')).toContain('p1');
    g.state.turnNumber = 6;
    expect(getDeathTriggers(g, b, 'p2').length).toBe(0);
  });

  it('Rite of Harmony: entry clauses stay with the IR temporary ETB window (no double trigger)', () => {
    const g = setup('r30_rite', 'rite');
    expect(getTurnScopedSpellTriggerSources(g.state).length).toBe(0);
    const b = bear('b2'); g.state.battlefield.push(b);
    triggerETBEffectsForPermanent(g, b, 'p1');
    expect(g.state.stack.length).toBe(1);
  });

  it('context-bound clauses ("that creature") are not registered', () => {
    const g = setup('r30_hunter', 'hunter');
    expect(getTurnScopedSpellTriggerSources(g.state).length).toBe(0);
  });
});
