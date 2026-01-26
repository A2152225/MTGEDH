import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: shares a card type with the exiled card', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_shares_card_type');
  });

  it('returns true when the triggering spell shares a card type with the exiled card', () => {
    const g = createInitialGameState('t_intervening_if_shares_card_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'src_card_1',
        name: 'Test Gatekeeper',
        type_line: 'Creature',
        oracle_text: 'Whenever a player casts a spell, if it shares a card type with the exiled card, do something.'
      },
    } as any);

    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p1] = (g.state as any).zones[p1] || { hand: [], graveyard: [], exile: [] };
    (g.state as any).zones[p1].exile = [
      {
        id: 'ex_1',
        name: 'Exiled Artifact',
        type_line: 'Artifact',
        zone: 'exile',
        exiledWithSourceId: 'src_1',
      },
    ];

    (g.state as any).stack = [
      {
        id: 'stack_1',
        controller: 'p2',
        card: { id: 'spell_1', name: 'Test Artifact Spell', type_line: 'Artifact — Equipment', zone: 'stack' },
        targets: [],
      },
    ];

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_1');
    const res = evaluateInterveningIfClauseDetailed(
      g as any,
      String(p1),
      'if it shares a card type with the exiled card',
      srcPerm,
      { triggeringStackItemId: 'stack_1' } as any
    );

    expect(res.matched).toBe(true);
    expect(res.value).toBe(true);
  });

  it('returns false when the triggering spell does not share a card type with the exiled card', () => {
    const g = createInitialGameState('t_intervening_if_shares_card_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_2',
      controller: p1,
      owner: p1,
      card: { id: 'src_card_2', name: 'Test Gatekeeper', type_line: 'Creature' },
    } as any);

    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p1] = (g.state as any).zones[p1] || { hand: [], graveyard: [], exile: [] };
    (g.state as any).zones[p1].exile = [
      { id: 'ex_2', name: 'Exiled Land', type_line: 'Land', zone: 'exile', exiledWithSourceId: 'src_2' },
    ];

    (g.state as any).stack = [
      {
        id: 'stack_2',
        controller: 'p2',
        card: { id: 'spell_2', name: 'Test Instant', type_line: 'Instant', zone: 'stack' },
        targets: [],
      },
    ];

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_2');
    const res = evaluateInterveningIfClauseDetailed(
      g as any,
      String(p1),
      'if it shares a card type with the exiled card',
      srcPerm,
      { triggeringStackItemId: 'stack_2' } as any
    );

    expect(res.matched).toBe(true);
    expect(res.value).toBe(false);
  });

  it('stays conservative (null) when the exiled card cannot be found from tracked state', () => {
    const g = createInitialGameState('t_intervening_if_shares_card_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_3',
      controller: p1,
      owner: p1,
      card: { id: 'src_card_3', name: 'Mystery Gatekeeper', type_line: 'Creature' },
    } as any);

    (g.state as any).stack = [
      {
        id: 'stack_3',
        controller: 'p2',
        card: { id: 'spell_3', name: 'Test Instant', type_line: 'Instant', zone: 'stack' },
        targets: [],
      },
    ];

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_3');
    const res = evaluateInterveningIfClauseDetailed(
      g as any,
      String(p1),
      'if it shares a card type with the exiled card',
      srcPerm,
      { triggeringStackItemId: 'stack_3' } as any
    );

    expect(res.matched).toBe(true);
    expect(res.value).toBe(null);
  });

  it('stays conservative (null) when triggering stack item is missing', () => {
    const g = createInitialGameState('t_intervening_if_shares_card_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_4',
      controller: p1,
      owner: p1,
      card: { id: 'src_card_4', name: 'Test Gatekeeper', type_line: 'Creature' },
    } as any);

    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p1] = (g.state as any).zones[p1] || { hand: [], graveyard: [], exile: [] };
    (g.state as any).zones[p1].exile = [
      { id: 'ex_4', name: 'Exiled Artifact', type_line: 'Artifact', zone: 'exile', exiledWithSourceId: 'src_4' },
    ];

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_4');
    const res = evaluateInterveningIfClauseDetailed(
      g as any,
      String(p1),
      'if it shares a card type with the exiled card',
      srcPerm,
      { triggeringStackItemId: 'stack_missing' } as any
    );

    expect(res.matched).toBe(true);
    expect(res.value).toBe(null);
  });
});
