import { describe, expect, it } from 'vitest';
import { getCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectCombatDamageTriggers } from '../src/state/modules/triggered-abilities.js';
import { getCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';

const zone = () => ({ hand: [], graveyard: [] as any[], exile: [], library: [] });
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text: string) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name, type_line, oracle_text } });
const ctxOf = (battlefield: any[], turnPlayer = 'p1') => ({ gameId: 'r38t', isReplaying: false, state: { battlefield, stack: [] as any[], turnPlayer, activePlayer: turnPlayer, players: [{ id: 'p1' }, { id: 'p2' }], zones: { p1: zone(), p2: zone() } } } as any);

describe('round 38 legacy Trek wordings', () => {
  it('opponent draws "during your turn" only triggers on the controller turn and strips the qualifier', () => {
    const troi = perm('troi', 'p1', 'Troi', 'Legendary Creature', 'Whenever an opponent draws a card during your turn, create a 1/1 blue Faerie creature token with flying.');
    const mine = getCardDrawTriggers(ctxOf([troi], 'p1'), 'p2', 'p2', 1);
    expect(mine).toHaveLength(1);
    expect(mine[0].effect).toMatch(/^create a 1\/1/);
    expect(getCardDrawTriggers(ctxOf([troi], 'p2'), 'p2', 'p2', 1)).toHaveLength(0);
  });

  it('typed counters put on a self name or "this artifact" trigger with the counter filter and once-per-turn flag', () => {
    const ent = perm('ent', 'p1', 'U.S.S. Enterprise-D, Galaxy-Class', 'Legendary Artifact - Spacecraft', 'Whenever one or more charge counters are put on U.S.S. Enterprise-D for the first time each turn, exile the top card of your library. You may play that card this turn.');
    const hits = getCounterPlacedTriggers(ctxOf([ent]), ent, { charge: 2 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ counterFilter: 'charge', oncePerTurn: true, countersPlaced: 2 });
    expect(getCounterPlacedTriggers(ctxOf([ent]), ent, { '+1/+1': 1 })).toHaveLength(0);
    const door = perm('door', 'p1', 'Door Thing', 'Artifact', 'Whenever one or more charge counters are put on this artifact, draw a card.');
    expect(getCounterPlacedTriggers(ctxOf([door]), door, { charge: 1 })).toHaveLength(1);
  });

  it('Phlox-style counter creature combat damage wording is detected', () => {
    const phlox = perm('phlox', 'p1', 'Phlox', 'Legendary Creature', 'Whenever a creature you control with a counter on it deals combat damage to a player, draw a card.');
    expect(detectCombatDamageTriggers(phlox.card, phlox).map((t: any) => t.triggerType)).toContain('any_counter_creature_combat_damage_to_player');
  });
});
