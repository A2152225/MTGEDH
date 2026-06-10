import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

vi.mock('../src/state/modules/resolutionPromptEvents.js', () => ({
  queueResolveTopOfStackPrompt: vi.fn(),
}));

import {
  applyRetiredTriggerLegacyCounterThenDraw,
  applyRetiredTriggerLegacyOptionalDiscardThenDraw,
  applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit,
} from '../src/state/modules/oracleIrTriggerLegacyCombinedHandlers.js';
import { queueResolveTopOfStackPrompt } from '../src/state/modules/resolutionPromptEvents.js';

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };

  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  player.hand = [];
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

describe('oracleIrTriggerLegacyCombinedHandlers', () => {
  it('applies counter-then-draw on targeted creatures', () => {
    const game = createInitialGameState('legacy_combined_counter_draw');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1']);

    const state = game.state as any;
    state.battlefield = [{
      id: 'creature-1',
      counters: {},
      card: { name: 'Giant' },
    }];

    expect(applyRetiredTriggerLegacyCounterThenDraw({
      ctx: game as any,
      controller: p1,
      sourceName: 'Source',
      desc: 'Put a +1/+1 counter on target creature, then draw a card.',
      description: 'Put a +1/+1 counter on target creature, then draw a card.',
      triggerItem: { targets: ['creature-1'] },
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters['+1/+1']).toBe(1);
  });

  it('queues optional discard-then-draw choice', () => {
    vi.mocked(queueResolveTopOfStackPrompt).mockClear();

    expect(applyRetiredTriggerLegacyOptionalDiscardThenDraw({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'You may discard a card. If you do, draw a card.',
      description: 'You may discard a card. If you do, draw a card.',
      triggerItem: { source: 'perm-1' },
      state: {},
    })).toBe(true);

    expect(queueResolveTopOfStackPrompt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueResolveTopOfStackPrompt).mock.calls[0][1].optionalDiscardThenDrawChoice).toBe(true);
  });

  it('queues sacrifice-another-permanent benefit choice', () => {
    vi.mocked(queueResolveTopOfStackPrompt).mockClear();

    expect(applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'You may sacrifice another permanent. If you do, you gain two life and draw a card.',
      description: 'You may sacrifice another permanent. If you do, you gain two life and draw a card.',
      triggerItem: { permanentId: 'perm-1' },
      state: {},
    })).toBe(true);

    expect(queueResolveTopOfStackPrompt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueResolveTopOfStackPrompt).mock.calls[0][1].sacrificeAnotherPermanentForBenefitLifeGain).toBe(2);
  });
});
