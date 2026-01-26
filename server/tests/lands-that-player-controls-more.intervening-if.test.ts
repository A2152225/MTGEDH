import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Intervening-if land count vs that player', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_upkeep_intervening_if_that_player_more_lands_than_you');
    ResolutionQueueManager.removeQueue('t_upkeep_intervening_if_that_player_more_lands_than_each_other');
  });

  it('evaluates "if that player controls more lands than you" for opponent-upkeep triggers', () => {
    const g = createInitialGameState('t_upkeep_intervening_if_that_player_more_lands_than_you');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any).push({
      id: 'lands_than_you_watcher_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'lands_than_you_watcher_card_1',
        name: 'More Lands Than You Watcher',
        type_line: 'Enchantment',
        oracle_text:
          "At the beginning of each opponent's upkeep, if that player controls more lands than you, that player loses 1 life.",
      },
      tapped: false,
    });

    // Give p1 2 lands.
    (g.state.battlefield as any).push({
      id: 'p1_land_1',
      controller: p1,
      owner: p1,
      card: { id: 'p1_land_1_card', name: 'Plains', type_line: 'Land — Plains', oracle_text: '' },
      tapped: false,
    });
    (g.state.battlefield as any).push({
      id: 'p1_land_2',
      controller: p1,
      owner: p1,
      card: { id: 'p1_land_2_card', name: 'Island', type_line: 'Land — Island', oracle_text: '' },
      tapped: false,
    });

    // Give p2 2 lands => condition false (not more than you).
    (g.state.battlefield as any).push({
      id: 'p2_land_1',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_1_card', name: 'Swamp', type_line: 'Land — Swamp', oracle_text: '' },
      tapped: false,
    });
    (g.state.battlefield as any).push({
      id: 'p2_land_2',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_2_card', name: 'Mountain', type_line: 'Land — Mountain', oracle_text: '' },
      tapped: false,
    });

    const triggersFalse = getUpkeepTriggersForPlayer(g as any, p2);
    expect(triggersFalse.some((t) => t?.cardName === 'More Lands Than You Watcher')).toBe(false);

    // Now p2 has 3 lands => condition true.
    (g.state.battlefield as any).push({
      id: 'p2_land_3',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_3_card', name: 'Forest', type_line: 'Land — Forest', oracle_text: '' },
      tapped: false,
    });

    const triggersTrue = getUpkeepTriggersForPlayer(g as any, p2);
    expect(triggersTrue.some((t) => t?.cardName === 'More Lands Than You Watcher')).toBe(true);
  });

  it('evaluates "if that player controls more lands than each other player" for each-player-upkeep triggers', () => {
    const g = createInitialGameState('t_upkeep_intervening_if_that_player_more_lands_than_each_other');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any).push({
      id: 'rivalry_style_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'rivalry_style_card_1',
        name: 'Most Lands Watcher',
        type_line: 'Enchantment',
        oracle_text:
          "At the beginning of each player's upkeep, if that player controls more lands than each other player, that player loses 1 life.",
      },
      tapped: false,
    });

    // p1 has 2 lands.
    (g.state.battlefield as any).push({
      id: 'p1_land_a',
      controller: p1,
      owner: p1,
      card: { id: 'p1_land_a_card', name: 'Plains', type_line: 'Land — Plains', oracle_text: '' },
      tapped: false,
    });
    (g.state.battlefield as any).push({
      id: 'p1_land_b',
      controller: p1,
      owner: p1,
      card: { id: 'p1_land_b_card', name: 'Island', type_line: 'Land — Island', oracle_text: '' },
      tapped: false,
    });

    // p2 has 3 lands.
    (g.state.battlefield as any).push({
      id: 'p2_land_a',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_a_card', name: 'Swamp', type_line: 'Land — Swamp', oracle_text: '' },
      tapped: false,
    });
    (g.state.battlefield as any).push({
      id: 'p2_land_b',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_b_card', name: 'Mountain', type_line: 'Land — Mountain', oracle_text: '' },
      tapped: false,
    });
    (g.state.battlefield as any).push({
      id: 'p2_land_c',
      controller: p2,
      owner: p2,
      card: { id: 'p2_land_c_card', name: 'Forest', type_line: 'Land — Forest', oracle_text: '' },
      tapped: false,
    });

    // On p1 upkeep: p1 does NOT have more lands than each other player => no trigger.
    const p1Upkeep = getUpkeepTriggersForPlayer(g as any, p1);
    expect(p1Upkeep.some((t) => t?.cardName === 'Most Lands Watcher')).toBe(false);

    // On p2 upkeep: p2 DOES have more lands than each other player => trigger.
    const p2Upkeep = getUpkeepTriggersForPlayer(g as any, p2);
    expect(p2Upkeep.some((t) => t?.cardName === 'Most Lands Watcher')).toBe(true);
  });
});
