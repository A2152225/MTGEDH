import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: exiled with it', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_exiled_with_it');
  });

  it('returns true when exile-zone tags show a card exiled with the source permanent', () => {
    const g = createInitialGameState('t_intervening_if_exiled_with_it');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'src_card_1',
        name: 'Test Source',
        type_line: 'Artifact',
        oracle_text: 'At the beginning of your upkeep, if a card is exiled with it, draw a card.'
      },
    } as any);

    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p1] = (g.state as any).zones[p1] || { hand: [], graveyard: [], exile: [] };
    (g.state as any).zones[p1].exile = [
      {
        id: 'ex_1',
        name: 'Exiled Thing',
        type_line: 'Instant',
        zone: 'exile',
        exiledWithSourceId: 'src_1',
        exiledWithSourceName: 'Test Source',
      },
    ];

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_1');
    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if a card is exiled with it', srcPerm);
    expect(res.matched).toBe(true);
    expect(res.value).toBe(true);
  });

  it('can safely return false for linked-exile permanents when no linked exiles are tracked', () => {
    const g = createInitialGameState('t_intervening_if_exiled_with_it');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'oring_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'oring_card',
        name: 'Oblivion Ring',
        type_line: 'Enchantment',
        oracle_text: 'When Oblivion Ring enters, exile another target nonland permanent until Oblivion Ring leaves the battlefield.'
      },
    } as any);

    const oring = (g.state as any).battlefield.find((p: any) => p?.id === 'oring_1');
    const resNo = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if a card is exiled with it', oring);
    expect(resNo.matched).toBe(true);
    expect(resNo.value).toBe(false);

    // Add a linked-exile bookkeeping entry -> becomes true.
    (g.state as any).linkedExiles = [
      {
        id: 'linked_1',
        exilingPermanentId: 'oring_1',
        exilingPermanentName: 'Oblivion Ring',
        exiledCardId: 'victim_card',
        exiledCard: { id: 'victim_card', name: 'Victim' },
        exiledCardName: 'Victim',
        originalOwner: p1,
        originalController: p1,
        returnCondition: 'ltb',
      },
    ];

    const resYes = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if a card is exiled with it', oring);
    expect(resYes.matched).toBe(true);
    expect(resYes.value).toBe(true);
  });

  it('stays conservative (null) when there is no tracked evidence', () => {
    const g = createInitialGameState('t_intervening_if_exiled_with_it');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield.push({
      id: 'src_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'src_card_2',
        name: 'Mystery Source',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your upkeep, if a card is exiled with it, you gain 1 life.'
      },
    } as any);

    const srcPerm = (g.state as any).battlefield.find((p: any) => p?.id === 'src_2');
    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if a card is exiled with it', srcPerm);
    expect(res.matched).toBe(true);
    expect(res.value).toBe(null);
  });
});
