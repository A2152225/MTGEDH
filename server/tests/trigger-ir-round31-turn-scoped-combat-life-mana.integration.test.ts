import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { getBlockTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { detectLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';
import { detectManaModifiers } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers.js';
import { applyDealCombatDamageTriggerQueue } from '../src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const SPELLS: Record<string, [string, string]> = {
  ondu: ['Ondu Rising', 'Awaken 4-{4}{W}\nWhenever a creature attacks this turn, it gains lifelink until end of turn.'],
  cry: ['Battle Cry', 'Untap all white creatures you control.\nWhenever a creature blocks this turn, it gets +0/+1 until end of turn.'],
  cure: ['False Cure', 'Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained.'],
  tide: ['High Tide', 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.'],
  surge: ['Surge to Victory', 'Whenever a creature you control deals combat damage to a player this turn, you gain 1 life.'],
};
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });

function setup(gameId: string, key: string, battlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
  g.state.life = { p1: 40, p2: 40 };
  g.state.battlefield = battlefield;
  g.state.turnNumber = 7;
  g.state.activePlayer = 'p1';
  g.state.zones = { p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 }, p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 } };
  const [name, text] = SPELLS[key];
  g.state.stack = [{ id: 'st_' + key, type: 'spell', controller: 'p1', card: { id: key, name, type_line: key === 'tide' || key === 'cure' ? 'Instant' : 'Sorcery', mana_cost: '{W}', cmc: 1, oracle_text: text }, targets: [] }];
  resolveTopOfStack(g);
  g.state.stack = [];
  return g;
}
const fromTurnScoped = (list: any[]) => list.filter((t: any) => String(t.permanentId || t.source || '').startsWith('turn-scoped:'));

describe('round 31 spell-created "this turn" watchers for combat, life gain and mana', () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });

  it('Ondu Rising: each attacking creature triggers this turn only', () => {
    const a = bear('a1', 'p1'); (a as any).attacking = 'p2';
    const g = setup('r31_ondu', 'ondu', [a]);
    expect(fromTurnScoped(getAttackTriggersForCreatures(g, [a], 'p1', 'p2')).length).toBe(1);
    g.state.turnNumber = 8;
    expect(fromTurnScoped(getAttackTriggersForCreatures(g, [a], 'p1', 'p2')).length).toBe(0);
  });

  it('Battle Cry: a blocking creature triggers', () => {
    const b = bear('b1', 'p2'); (b as any).blocking = ['a1'];
    const g = setup('r31_cry', 'cry', [bear('a1', 'p1'), b]);
    const bt = getBlockTriggersForCreatures(g, [b], 'p2');
    expect(fromTurnScoped(bt).length).toBe(1);
  });

  it('False Cure: any player gaining life triggers', () => {
    const g = setup('r31_cure', 'cure');
    expect(fromTurnScoped(detectLifegainTriggers(g, 'p2', 3)).length).toBe(1);
  });

  it('High Tide: Islands get an extra {U} modifier this turn', () => {
    const g = setup('r31_tide', 'tide');
    const mods = detectManaModifiers(g.state, 'p2');
    expect(mods.some((m: any) => /high tide/i.test(String(m.cardName)) && (m as any).landTypeRequired === 'island')).toBe(true);
    g.state.turnNumber = 8;
    expect(detectManaModifiers(g.state, 'p2').some((m: any) => /high tide/i.test(String(m.cardName)))).toBe(false);
  });

  it('Surge-style: combat damage to a player by your creature triggers', () => {
    const a = bear('a1', 'p1');
    const g = setup('r31_surge', 'surge', [a]);
    const before = g.state.stack.length;
    applyDealCombatDamageTriggerQueue(g, g.state.battlefield, {
      damageToPlayers: { p2: 2 }, lifeGainForPlayers: {}, creaturesDestroyed: [],
      attackersThatDealtDamage: { p2: new Set(['a1']) }, attackerDamageToPlayers: { p2: { a1: 2 } },
    } as any);
    const items = g.state.stack.slice(before);
    expect(items.filter((s: any) => String(s.source || s.permanentId || '').startsWith('turn-scoped:')).length).toBe(1);
  });
});
