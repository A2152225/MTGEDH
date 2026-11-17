import { describe, expect, it } from 'vitest';
import { tryResolveRound67QueuedEffect, removeCounteredStackAbility, uniqueGreatestManaValuePlayer } from '../src/state/modules/triggers/round67EffectResolution.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from '../src/state/modules/triggers/target-metadata.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function ctxWith(state: any, gameId?: string) {
  return { state, gameId, bumpSeq() {} } as any;
}

describe('round 67 effect resolution', () => {
  it('does not treat changing an existing target as a new target requirement', () => {
    const effect = "each player reveals the top card of their library. the player who reveals the card with the greatest mana value may change the target or targets. if two or more cards are tied for greatest, the target or targets remain unchanged.";
    const metadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    expect(hasUnsupportedTargetRequirement(metadata)).toBe(false);
    expect(metadata.requiresTarget).toBeUndefined();
  });

  it('sacrifices the listed permanents and leaves the source', () => {
    const state = {
      battlefield: [
        { id: 'city', controller: 'p1', card: { name: 'City in a Bottle', type_line: 'Artifact' } },
        { id: 'lib', controller: 'p2', card: { name: 'Library of Alexandria', type_line: 'Land' } },
      ],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p2: { graveyard: [] } },
    };
    const game = ctxWith(state);
    const handled = tryResolveRound67QueuedEffect(game, 'p1' as any, 'City in a Bottle', 'their controllers sacrifice them', {
      effectData: { sacrificePermanentIds: ['lib'] },
    });
    expect(handled).toBe(true);
    expect(state.battlefield.map((perm) => perm.id)).toEqual(['city']);
  });

  it('removes a countered ability from the stack', () => {
    const state = { stack: [{ id: 'caused', controller: 'p2', type: 'triggered_ability' }], battlefield: [] };
    const game = ctxWith(state);
    expect(removeCounteredStackAbility(game, 'caused')).toBe(true);
    expect(state.stack).toHaveLength(0);
  });

  it('puts a quest counter and offers the copy only at four', () => {
    const low = {
      battlefield: [{ id: 'fire', controller: 'p1', card: { name: 'Firebender Ascension' }, counters: { quest: 2 } }],
      stack: [{ id: 'atk', controller: 'p1' }],
    };
    const lowGame = ctxWith(low, 'round67-quest-low');
    tryResolveRound67QueuedEffect(
      lowGame,
      'p1' as any,
      'Firebender Ascension',
      'put a quest counter on this enchantment. then if it has four or more quest counters on it, you may copy that ability.',
      { id: 'trig', permanentId: 'fire', triggeringStackItemId: 'atk' },
    );
    expect(low.battlefield[0].counters.quest).toBe(3);
    expect(ResolutionQueueManager.getQueue('round67-quest-low').steps).toHaveLength(0);

    const ready = {
      battlefield: [{ id: 'fire', controller: 'p1', card: { name: 'Firebender Ascension' }, counters: { quest: 3 } }],
      stack: [{ id: 'atk', controller: 'p1', type: 'triggered_ability' }],
    };
    const readyGame = ctxWith(ready, 'round67-quest-ready');
    tryResolveRound67QueuedEffect(
      readyGame,
      'p1' as any,
      'Firebender Ascension',
      'put a quest counter on this enchantment. then if it has four or more quest counters on it, you may copy that ability. you may choose new targets for the copy',
      { id: 'trig', permanentId: 'fire', triggeringStackItemId: 'atk' },
    );
    expect(ready.battlefield[0].counters.quest).toBe(4);
    expect(ResolutionQueueManager.getQueue('round67-quest-ready').steps.length).toBeGreaterThan(0);
    expect(ready.stack.some((item) => item.isCopy)).toBe(false);
  });

  it('picks the unique highest mana value and treats a tie as no change', () => {
    expect(uniqueGreatestManaValuePlayer([
      { playerId: 'p1', manaValue: 1 },
      { playerId: 'p2', manaValue: 4 },
    ])).toBe('p2');
    expect(uniqueGreatestManaValuePlayer([
      { playerId: 'p1', manaValue: 3 },
      { playerId: 'p2', manaValue: 3 },
    ])).toBeNull();
  });

  it('asks the player who revealed the greatest mana value to change targets', () => {
    const state = {
      battlefield: [{ id: 'bear', controller: 'p2', card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' } }],
      stack: [{ id: 'bolt', controller: 'p1', type: 'spell', targets: ['bear'] }],
      players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      zones: {
        p1: { library: [{ name: 'Island', mana_cost: '', cmc: 0 }] },
        p2: { library: [{ name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1 }] },
      },
    };
    const game = ctxWith(state, 'round67-battle');
    const handled = tryResolveRound67QueuedEffect(
      game,
      'p1' as any,
      'Psychic Battle',
      'each player reveals the top card of their library. the player who reveals the card with the greatest mana value may change the target or targets.',
      { triggeringStackItemId: 'bolt' },
    );
    expect(handled).toBe(true);
    const step = ResolutionQueueManager.getQueue('round67-battle').steps[0] as any;
    expect(step.playerId).toBe('p2');
    expect(step.retargetAbilityCopyStackItemId).toBe('bolt');
    expect(String(step.description)).toMatch(/Lightning Bolt/);
  });

  it('schedules an additional combat phase after this phase', () => {
    const state: any = { battlefield: [], stack: [], extraCombats: [] };
    const game = ctxWith(state);
    const handled = tryResolveRound67QueuedEffect(
      game,
      'p1' as any,
      'Balthier and Fran',
      'after this phase, there is an additional combat phase',
      {},
    );
    expect(handled).toBe(true);
    expect(state.extraCombats).toHaveLength(1);
    expect(state.extraCombats[0].source).toBe('Balthier and Fran');
  });
});
