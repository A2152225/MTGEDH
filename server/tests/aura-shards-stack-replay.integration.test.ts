/**
 * Regression: Resolve All / Always-No drains must pop matching items on event
 * replay. Without that, every historical pushTriggeredAbility (e.g. Aura Shards
 * from the whole game) reappears on the stack after server restart.
 */
import { describe, expect, it } from 'vitest';
import { createContext } from '../src/state/context.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import {
  buildNoUntilTargetsChangeValue,
  fingerprintArtifactEnchantmentTargets,
} from '../../shared/src/mayAutoPreference.js';

function pushAuraShards(ctx: any, id: string, playerId = 'p1') {
  applyEvent(ctx, {
    type: 'pushTriggeredAbility',
    triggerId: id,
    sourceId: 'aura_shards_1',
    sourceName: 'Aura Shards',
    controllerId: playerId,
    description: 'you may destroy target artifact or enchantment.',
    effect: 'you may destroy target artifact or enchantment.',
    triggerType: 'creature_etb',
    mandatory: false,
    card: {
      name: 'Aura Shards',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature enters the battlefield under your control, you may destroy target artifact or enchantment.',
    },
  } as any);
}

describe('Aura Shards stack replay cleanup', () => {
  it('pops resolveAllTriggers count during replay so historical pushes do not accumulate', () => {
    const ctx = createContext('replay_resolve_all_aura_shards');
    (ctx as any).isReplaying = true;
    ctx.state.players = [{ id: 'p1', name: 'P1' } as any];
    ctx.state.stack = [];

    for (let i = 0; i < 16; i++) {
      pushAuraShards(ctx, `aura_trigger_${i}`);
    }
    expect(ctx.state.stack).toHaveLength(16);

    applyEvent(ctx, {
      type: 'resolveAllTriggers',
      by: 'p1',
      count: 16,
    } as any);

    expect(ctx.state.stack).toHaveLength(0);
  });

  it('drains consecutive Always-No Aura Shards on a single resolveTopOfStack replay', () => {
    const ctx = createContext('replay_always_no_aura_shards_drain');
    (ctx as any).isReplaying = true;
    ctx.state.players = [{ id: 'p1', name: 'P1' } as any];
    ctx.state.battlefield = [
      {
        id: 'aura_shards_1',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Aura Shards', type_line: 'Enchantment' },
      },
      {
        id: 'sol_ring_1',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
    ] as any;
    ctx.state.stack = [];
    ctx.state.mayAutoPreferences = {
      p1: {
        'aura shards:you may destroy target artifact or enchantment': 'no',
      },
    };

    for (let i = 0; i < 8; i++) {
      pushAuraShards(ctx, `aura_always_no_${i}`);
    }
    expect(ctx.state.stack).toHaveLength(8);

    // Live drained all 8 in one resolveTopOfStack call / one persisted event.
    applyEvent(ctx, { type: 'resolveTopOfStack', auto: true } as any);

    expect(ctx.state.stack).toHaveLength(0);
  });

  it('drains consecutive no-until-targets Aura Shards on resolveTopOfStack replay', () => {
    const ctx = createContext('replay_no_until_aura_shards_drain');
    (ctx as any).isReplaying = true;
    ctx.state.players = [{ id: 'p1', name: 'P1' } as any];
    ctx.state.battlefield = [
      {
        id: 'aura_shards_1',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Aura Shards', type_line: 'Enchantment' },
      },
      {
        id: 'sol_ring_1',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
    ] as any;
    ctx.state.stack = [];
    const fingerprint = fingerprintArtifactEnchantmentTargets(ctx.state.battlefield);
    ctx.state.mayAutoPreferences = {
      p1: {
        'aura shards:you may destroy target artifact or enchantment':
          buildNoUntilTargetsChangeValue(fingerprint),
      },
    };

    for (let i = 0; i < 8; i++) {
      pushAuraShards(ctx, `aura_no_until_${i}`);
    }

    applyEvent(ctx, { type: 'resolveTopOfStack' } as any);
    expect(ctx.state.stack).toHaveLength(0);
  });
});
