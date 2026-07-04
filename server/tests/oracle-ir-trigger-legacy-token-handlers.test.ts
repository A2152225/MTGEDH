import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import * as triggerEtbEntryEffects from '../src/state/modules/triggerEtbEntryEffects.js';
import {
  applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken,
  applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken,
  applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken,
} from '../src/state/modules/oracleIrTriggerLegacyTokenHandlers.js';

describe('oracleIrTriggerLegacyTokenHandlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates attacking tokens on attack trigger', () => {
    const state = {
      battlefield: [{
        id: 'brimaz',
        attacking: 'p2',
        card: { name: 'Brimaz, King of Oreskos' },
      }],
    };
    const triggerETBEffectsForToken = vi.spyOn(triggerEtbEntryEffects, 'triggerETBEffectsForToken').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Brimaz, King of Oreskos',
      desc: 'Whenever Brimaz attacks, create a 1/1 white Cat Soldier creature token with vigilance that\'s attacking.',
      description: 'Whenever Brimaz attacks, create a 1/1 white Cat Soldier creature token with vigilance that\'s attacking.',
      triggerItem: { triggerType: 'attacks', source: 'brimaz' },
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(2);
    expect(state.battlefield[1].attacking).toBe('p2');
    expect(state.battlefield[1].tapped).toBe(false);
    expect(triggerETBEffectsForToken).toHaveBeenCalledTimes(1);
  });

  it('creates blocking tokens from structured block trigger data', () => {
    const state = {
      battlefield: [
        { id: 'attacker', blockedBy: [] },
        { id: 'brimaz', blocking: ['attacker'], card: { name: 'Brimaz, King of Oreskos' } },
      ],
    };
    const triggerETBEffectsForToken = vi.spyOn(triggerEtbEntryEffects, 'triggerETBEffectsForToken').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Brimaz, King of Oreskos',
      desc: 'Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that\'s blocking that creature.',
      description: 'Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that\'s blocking that creature.',
      triggerItem: {
        triggerType: 'blocks',
        source: 'brimaz',
        value: {
          createTokens: {
            count: 1,
            power: 1,
            toughness: 1,
            type: 'Cat Soldier',
            color: 'white',
            abilities: ['Vigilance'],
          },
        },
      },
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(3);
    expect(state.battlefield[2].blocking).toEqual(['attacker']);
    expect(state.battlefield[0].blockedBy).toContain(state.battlefield[2].id);
    expect(triggerETBEffectsForToken).toHaveBeenCalledTimes(1);
  });

  it('creates attack count-based tokens from structured trigger data', () => {
    const state = {
      battlefield: [
        { id: 'soldier-1', controller: 'p1', card: { type_line: 'Creature — Soldier' } },
        { id: 'soldier-2', controller: 'p1', card: { type_line: 'Creature — Soldier' } },
      ],
    };
    const triggerETBEffectsForToken = vi.spyOn(triggerEtbEntryEffects, 'triggerETBEffectsForToken').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Myrel, Shield of Argive',
      desc: 'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.',
      description: 'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.',
      triggerItem: {
        triggerType: 'attacks',
        effectData: {
          countType: 'soldier',
          power: 1,
          toughness: 1,
          type: 'Soldier',
          color: 'colorless',
          isArtifact: true,
        },
      },
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(4);
    expect(triggerETBEffectsForToken).toHaveBeenCalledTimes(2);
  });
});
