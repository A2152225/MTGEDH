import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import {
  isImpossibleFaceUpNonPermanentBattlefieldCard,
  repairNonPermanentBattlefieldGhosts,
} from '../src/state/modules/stackReplayUtils.js';

function createCtx() {
  return {
    isReplaying: true,
    state: {
      players: [{ id: 'p1', name: 'P1' }],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
      },
      battlefield: [],
      stack: [],
    },
    libraries: new Map(),
    bumpSeq: () => undefined,
  } as any;
}

describe('face-up instant/sorcery battlefield guards', () => {
  it('rejects effectProgramZoneMove inserting a face-up sorcery onto the battlefield', () => {
    const card = {
      id: 'warp_1',
      name: 'Warp World',
      type_line: 'Sorcery',
      oracle_text: '',
    };
    const ctx = createCtx();
    ctx.state.zones.p1.hand = [{ ...card, zone: 'hand' }];
    ctx.state.zones.p1.handCount = 1;

    applyEvent(ctx, {
      type: 'effectProgramZoneMove',
      playerId: 'p1',
      fromPlayerId: 'p1',
      cardId: card.id,
      fromZone: 'hand',
      toZone: 'battlefield',
      permanentId: 'perm_warp',
      card,
    } as any);

    expect(ctx.state.battlefield).toEqual([]);
    expect(ctx.state.zones.p1.hand).toEqual([]);
    expect(ctx.state.zones.p1.graveyard.map((entry: any) => entry.id)).toEqual(['warp_1']);
  });

  it('rejects putCardFromHandOntoBattlefield for a face-up instant', () => {
    const card = {
      id: 'guff_1',
      name: 'Guff Rewrites History',
      type_line: 'Instant',
      oracle_text: '',
    };
    const ctx = createCtx();
    ctx.state.zones.p1.hand = [{ ...card, zone: 'hand' }];
    ctx.state.zones.p1.handCount = 1;

    applyEvent(ctx, {
      type: 'putCardFromHandOntoBattlefield',
      playerId: 'p1',
      cardId: card.id,
      permanentId: 'perm_guff',
      card,
    } as any);

    expect(ctx.state.battlefield).toEqual([]);
    expect(ctx.state.zones.p1.graveyard.map((entry: any) => entry.id)).toEqual(['guff_1']);
  });

  it('allows face-down morph/manifest instant onto the battlefield', () => {
    const card = {
      id: 'manifest_instant',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      faceDown: true,
    };
    const ctx = createCtx();
    ctx.state.zones.p1.hand = [{ ...card, zone: 'hand' }];
    ctx.state.zones.p1.handCount = 1;

    expect(isImpossibleFaceUpNonPermanentBattlefieldCard(card, { faceDown: true })).toBe(false);

    applyEvent(ctx, {
      type: 'putCardFromHandOntoBattlefield',
      playerId: 'p1',
      cardId: card.id,
      permanentId: 'perm_manifest',
      card,
      faceDown: true,
    } as any);

    expect(ctx.state.battlefield).toHaveLength(1);
    expect(ctx.state.battlefield[0].id).toBe('perm_manifest');
    expect(ctx.state.zones.p1.graveyard).toEqual([]);
  });

  it('repairs a resolved sorcery ghost before it can linger on the battlefield', () => {
    const card = {
      id: 'auction_1',
      name: "Thieves' Auction",
      type_line: 'Sorcery',
    };
    const ctx = createCtx();
    ctx.state.zones.p1.graveyard = [{ ...card, zone: 'graveyard' }];
    ctx.state.zones.p1.graveyardCount = 1;
    ctx.state.battlefield = [{
      id: 'stack_auction',
      controller: 'p1',
      owner: 'p1',
      card: { ...card, zone: 'battlefield' },
    }];

    expect(repairNonPermanentBattlefieldGhosts(ctx)).toBe(1);
    expect(ctx.state.battlefield).toEqual([]);
    expect(ctx.state.zones.p1.graveyard.map((entry: any) => entry.id)).toEqual(['auction_1']);
  });
});
