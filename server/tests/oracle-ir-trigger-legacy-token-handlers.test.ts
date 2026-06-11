import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import * as triggerEtbEntryEffects from '../src/state/modules/triggerEtbEntryEffects.js';
import {
  applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken,
  applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken,
  applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken,
  applyRetiredTriggerLegacyCreateCreatureToken,
  applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount,
  applyRetiredTriggerLegacyEquippedCreatureCopyToken,
  applyRetiredTriggerLegacyPredefinedArtifactTokens,
  applyRetiredTriggerLegacyTypedCountTokenFallbacks,
} from '../src/state/modules/oracleIrTriggerLegacyTokenHandlers.js';
import {
  applyRetiredTriggerLegacyEachOpponentMills,
} from '../src/state/modules/oracleIrTriggerLegacyMillHandlers.js';

describe('oracleIrTriggerLegacyTokenHandlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retired predefined artifact token handler defers to IR uncategorized fallback', () => {
    const state = { battlefield: [] };

    expect(applyRetiredTriggerLegacyPredefinedArtifactTokens({
      ctx: { state, bumpSeq: () => {} } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Trail of Crumbs',
      desc: 'Create a Food token.',
      description: 'Create a Food token.',
      triggerItem: {},
      state,
    })).toBe(false);

    expect(state.battlefield).toHaveLength(0);
  });

  it('retired generic creature token handler defers to IR uncategorized fallback', () => {
    const state = { battlefield: [] };

    expect(applyRetiredTriggerLegacyCreateCreatureToken({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'Create a 1/1 white Soldier creature token with vigilance.',
      description: 'Create a 1/1 white Soldier creature token with vigilance.',
      triggerItem: {},
      state,
    })).toBe(false);

    expect(state.battlefield).toHaveLength(0);
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

  it('retired equipped creature copy token defers to IR uncategorized fallback', () => {
    const state = {
      battlefield: [
        {
          id: 'helm',
          attachedTo: 'creature-1',
          card: { name: 'Helm of the Host', type_line: 'Legendary Artifact — Equipment' },
        },
        {
          id: 'creature-1',
          counters: { '+1/+1': 1 },
          basePower: 4,
          baseToughness: 4,
          card: {
            name: 'Gisela',
            type_line: 'Legendary Creature — Angel',
            oracle_text: 'Flying, first strike',
            keywords: ['Flying', 'First strike'],
          },
        },
      ],
    };

    expect(applyRetiredTriggerLegacyEquippedCreatureCopyToken({
      ctx: { state } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Helm of the Host',
      desc: "create a token that's a copy of equipped creature, except it's not legendary",
      description: "Create a token that's a copy of equipped creature, except it's not legendary.",
      triggerItem: { source: 'helm' },
      state,
    })).toBe(false);

    expect(state.battlefield).toHaveLength(2);
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

  it('creates X tokens based on controlled creature type count', () => {
    const state = {
      battlefield: [
        { id: 'goblin-1', controller: 'p1', card: { type_line: 'Creature — Goblin' } },
        { id: 'goblin-2', controller: 'p1', card: { type_line: 'Creature — Goblin' } },
        { id: 'goblin-3', controller: 'p1', card: { type_line: 'Creature — Goblin' } },
      ],
    };
    const triggerETBEffectsForToken = vi.spyOn(triggerEtbEntryEffects, 'triggerETBEffectsForToken').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Krenko, Mob Boss',
      desc: 'Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
      description: 'Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(6);
    expect(state.battlefield[5].card.colors).toEqual(['R']);
    expect(triggerETBEffectsForToken).toHaveBeenCalledTimes(3);
  });

  it('creates Human Soldier tokens from typed count fallback', () => {
    const state = {
      battlefield: [
        { id: 'human-1', controller: 'p1', card: { type_line: 'Creature — Human' } },
      ],
    };
    const triggerETBEffectsForToken = vi.spyOn(triggerEtbEntryEffects, 'triggerETBEffectsForToken').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyTypedCountTokenFallbacks({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Horn of Gondor',
      desc: 'Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control.',
      description: 'Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(2);
    expect(state.battlefield[1].card.name).toBe('Human Soldier');
    expect(triggerETBEffectsForToken).toHaveBeenCalledTimes(1);
  });
});

describe('oracleIrTriggerLegacyMillHandlers', () => {
  it('retired each-opponent mill defers to IR uncategorized fallback', () => {
    const state: any = { pendingMill: {}, zones: {} };
    const lib = [{ id: 'c1', name: 'Island' }];
    const ctx = {
      libraries: new Map([['p2', lib]]),
    };

    expect(applyRetiredTriggerLegacyEachOpponentMills({
      ctx: ctx as any,
      controller: 'p1' as PlayerID,
      desc: 'Each opponent mills a card.',
      opponents: [{ id: 'p2' }],
      state,
    })).toBe(false);

    expect(state.pendingMill.p2).toBeUndefined();
    expect(lib).toHaveLength(1);
  });
});
