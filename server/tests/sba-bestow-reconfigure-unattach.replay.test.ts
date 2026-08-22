import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';

function makeBestowPermanent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nym_1',
    controller: 'p1',
    owner: 'p1',
    attachedTo: 'host_gone',
    card: {
      name: 'Hopeful Eidolon',
      type_line: 'Enchantment Creature — Spirit',
      oracle_text: "Bestow {3}{W} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached to a creature.)\nEnchanted creature gets +1/+1 and has lifelink.\nLifelink",
      power: '1',
      toughness: '1',
    },
    ...overrides,
  };
}

function makeSbaCtx(opts: {
  isReplaying?: boolean;
  permanent?: any;
  gameId?: string;
} = {}) {
  const permanent = opts.permanent ?? makeBestowPermanent();
  return {
    gameId: opts.gameId ?? 'game_sba_unattach',
    isReplaying: Boolean(opts.isReplaying),
    libraries: new Map(),
    bumpSeq: vi.fn(),
    state: {
      seq: 11,
      players: [{ id: 'p1', hasLost: false, life: 40 }],
      life: { p1: 40 },
      battlefield: [permanent],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
      },
      stack: [],
    },
  } as any;
}

describe('SBA bestow/reconfigure unattach replay persistence (inventory #8)', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits reconfigureUnattachPermanent when SBA unattaches a bestowed creature whose host is gone', () => {
    const ctx = makeSbaCtx();
    const before = ctx.state.battlefield[0];
    expect(before.attachedTo).toBe('host_gone');
    expect(before.basePower).toBeUndefined();
    expect(before.baseToughness).toBeUndefined();

    runSBA(ctx);

    const after = ctx.state.battlefield.find((p: any) => p.id === 'nym_1');
    expect(after).toBeTruthy();
    expect(after.attachedTo).toBeUndefined();
    expect(after.basePower).toBe(1);
    expect(after.baseToughness).toBe(1);

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      'game_sba_unattach',
      11,
      'reconfigureUnattachPermanent',
      expect.objectContaining({
        playerId: 'p1',
        reconfigureId: 'nym_1',
        targetCreatureId: 'host_gone',
        restoredBasePower: 1,
        restoredBaseToughness: 1,
        reason: 'sba_target_gone',
      }),
    );
  });

  it('does not emit while isReplaying (applyEvent owns restore)', () => {
    const ctx = makeSbaCtx({ isReplaying: true });
    runSBA(ctx);

    const after = ctx.state.battlefield.find((p: any) => p.id === 'nym_1');
    expect(after?.attachedTo).toBeUndefined();
    expect(after?.basePower).toBe(1);
    expect(after?.baseToughness).toBe(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('applyEvent(reconfigureUnattachPermanent) clears attach pointers and restores printed P/T', () => {
    const game = createInitialGameState('t_sba_unattach_replay');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: p1,
        owner: p1,
        attachments: ['nym_1'],
        attachedEquipment: [],
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        basePower: 2,
        baseToughness: 2,
      },
      {
        id: 'nym_1',
        controller: p1,
        owner: p1,
        attachedTo: 'host_1',
        card: {
          name: 'Hopeful Eidolon',
          type_line: 'Enchantment Creature — Spirit',
          oracle_text: 'Bestow {3}{W}',
          power: '1',
          toughness: '1',
        },
      },
    ];

    game.applyEvent({
      type: 'reconfigureUnattachPermanent',
      playerId: p1,
      reconfigureId: 'nym_1',
      reconfigureName: 'Hopeful Eidolon',
      targetCreatureId: 'host_1',
      restoredBasePower: 1,
      restoredBaseToughness: 1,
      reason: 'sba_target_gone',
    } as any);

    const host = (game.state as any).battlefield.find((p: any) => p.id === 'host_1');
    const nym = (game.state as any).battlefield.find((p: any) => p.id === 'nym_1');
    expect(nym.attachedTo).toBeUndefined();
    expect(nym.basePower).toBe(1);
    expect(nym.baseToughness).toBe(1);
    expect(host.attachments || []).not.toContain('nym_1');
  });
});
