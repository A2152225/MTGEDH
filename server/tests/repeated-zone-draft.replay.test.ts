import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';

describe('repeated zone draft replay', () => {
  it('replays an auction pick with owner differing from controller and enters tapped', () => {
    const card = {
      id: 'sol_ring_1',
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    };

    const ctx: any = {
      isReplaying: true,
      state: {
        players: [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ],
        zones: {
          p1: { hand: [], graveyard: [], exile: [{ ...card, zone: 'exile' }], exileCount: 1 },
          p2: { hand: [], graveyard: [], exile: [], exileCount: 0 },
        },
        battlefield: [],
        stack: [],
      },
      libraries: new Map(),
      bumpSeq: () => undefined,
    };

    applyEvent(ctx, {
      type: 'effectProgramZoneMove',
      playerId: 'p2',
      fromPlayerId: 'p1',
      ownerId: 'p1',
      controllerId: 'p2',
      cardId: card.id,
      fromZone: 'exile',
      toZone: 'battlefield',
      permanentId: 'perm_sol',
      card,
      tapped: true,
      entersTapped: true,
    } as any);

    expect(ctx.state.zones.p1.exile).toEqual([]);
    expect(ctx.state.battlefield).toHaveLength(1);
    expect(ctx.state.battlefield[0]).toMatchObject({
      id: 'perm_sol',
      owner: 'p1',
      controller: 'p2',
      tapped: true,
    });
  });

  it('exposes REPEATED_ZONE_DRAFT as a resolution step type', () => {
    expect(ResolutionStepType.REPEATED_ZONE_DRAFT).toBe('repeated_zone_draft');
  });
});
