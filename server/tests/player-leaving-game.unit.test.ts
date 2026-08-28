import { describe, expect, it } from 'vitest';
import { buildCostAdjustmentPlan } from '../src/state/modules/cost-adjustments.js';
import { detectManaModifiers, getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities.js';
import { removeLeavingPlayerGameObjects } from '../src/state/modules/playerLeavingGame.js';
import { recomputeContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { resolvePlayers } from '../../rules-engine/src/oracleIRExecutorPlayerResolvePlayers.js';
import {
  getActivePriorityPlayers,
  reassignPriorityIfHolderCannotReceive,
} from '../src/state/modules/priorityEligibility.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';

function player(id: string, flags: { hasLost?: boolean; eliminated?: boolean } = {}) {
  return { id, name: id, hasLost: flags.hasLost === true, eliminated: flags.eliminated === true };
}

describe('defeated player global effects', () => {
  it('removes a lost player\'s permanents from the battlefield without killing remaining cards', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'moon',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Blood Moon', type_line: 'Enchantment', oracle_text: 'Nonbasic lands are Mountains.' },
        },
        {
          id: 'bear',
          controller: 'p1',
          owner: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'token',
          controller: 'p2',
          owner: 'p2',
          isToken: true,
          card: { name: 'Soldier', type_line: 'Creature — Soldier Token' },
        },
      ],
      zones: {},
    };

    const removed = removeLeavingPlayerGameObjects(state, 'p2');
    expect(removed.sort()).toEqual(['moon', 'token']);
    expect(state.battlefield.map((perm: any) => perm.id)).toEqual(['bear']);
    expect(state.zones.p2.exile.some((card: any) => card.name === 'Blood Moon')).toBe(true);
    expect(state.zones.p2.exile.some((card: any) => card.name === 'Soldier')).toBe(false);
  });

  it('stops Crusade-style anthems from a defeated controller even if the permanent is still on the battlefield', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'crusade',
          controller: 'p2',
          card: {
            name: 'Crusade',
            type_line: 'Enchantment',
            oracle_text: 'White creatures get +1/+1.',
          },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: {
            name: 'Savannah Lions',
            type_line: 'Creature — Cat',
            colors: ['W'],
            color_identity: ['W'],
            oracle_text: '',
            power: '2',
            toughness: '1',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state);
    expect(merged.perPermanent.get('bear')).toMatchObject({ pDelta: 0, tDelta: 0 });
  });

  it('stops Sphere of Resistance taxes from a defeated controller', () => {
    const state = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [{
        id: 'sphere',
        controller: 'p2',
        card: {
          name: 'Sphere of Resistance',
          type_line: 'Artifact',
          oracle_text: 'Spells cost {1} more to cast.',
        },
      }],
    };

    const spell = {
      id: 'bolt',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      colors: ['R'],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', spell).genericAdjustment).toBe(0);
  });

  it('stops Blood Moon from a defeated controller', () => {
    const state = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'moon',
          controller: 'p2',
          card: {
            name: 'Blood Moon',
            type_line: 'Enchantment',
            oracle_text: 'Nonbasic lands are Mountains.',
          },
        },
        {
          id: 'tower',
          controller: 'p1',
          card: {
            name: 'Command Tower',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
          },
        },
      ],
    };

    expect(detectManaModifiers(state, 'p1').some((modifier) => modifier.cardName === 'Blood Moon')).toBe(false);
    expect(getEffectiveBasicLandTypes(state, state.battlefield[1])).toEqual([]);
  });

  it('does not include defeated players in each-opponent copy targets', () => {
    const state = {
      players: [
        player('p1'),
        player('p2', { hasLost: true }),
        player('p3'),
      ],
    };
    const ids = resolvePlayers(state as any, { kind: 'each_opponent' }, { controllerId: 'p1' } as any);
    expect(ids).toEqual(['p3']);
  });

  it('still resolves "you" for a controller with stale leftGame after reconnect', () => {
    const state = {
      players: [
        { id: 'p1', name: 'P1', leftGame: true, conceded: true, departureMode: 'leave' },
        player('p2'),
      ],
    };
    expect(resolvePlayers(state as any, { kind: 'you' }, { controllerId: 'p1' } as any)).toEqual(['p1']);
  });

  it('drops a defeated player from the priority circle', () => {
    const state = {
      players: [
        { id: 'p1', name: 'P1', seat: 0 },
        { id: 'p2', name: 'P2', seat: 1, hasLost: true, eliminated: true },
        { id: 'p3', name: 'P3', seat: 2 },
      ],
      priority: 'p2',
    };
    expect(getActivePriorityPlayers({ state }).map((entry) => entry.id)).toEqual(['p1', 'p3']);
    expect(reassignPriorityIfHolderCannotReceive({ state })).toBe(true);
    expect(state.priority).toBe('p3');
  });

  it('clears a defeated player\'s resolution prompts when they leave', () => {
    const gameId = 'test_leave_clears_hive_mind_prompts';
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p2',
      description: 'Choose new targets for the copy',
      validTargets: [{ id: 'p1', type: 'player' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const state: any = {
      gameId,
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [],
      stack: [
        { id: 'copy_1', controller: 'p2', type: 'spell', copiedBySourceName: 'Hive Mind' },
        { id: 'bolt_1', controller: 'p1', type: 'spell' },
      ],
    };

    removeLeavingPlayerGameObjects(state, 'p2', { gameId });
    expect(state.stack.map((item: any) => item.id)).toEqual(['bolt_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, 'p2')).toHaveLength(0);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('returns another player\'s stolen permanent instead of exiling it', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'bear',
          controller: 'p2',
          owner: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'moon',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Blood Moon', type_line: 'Enchantment', oracle_text: 'Nonbasic lands are Mountains.' },
        },
      ],
      controlChangeEffects: [
        {
          permanentId: 'bear',
          originalController: 'p1',
          newController: 'p2',
          duration: 'eot',
          appliedAt: 1,
        },
      ],
      zones: {},
    };

    const removed = removeLeavingPlayerGameObjects(state, 'p2');
    expect(removed).toEqual(['moon']);
    expect(state.battlefield).toEqual([
      expect.objectContaining({ id: 'bear', controller: 'p1', owner: 'p1' }),
    ]);
    expect(state.zones.p2?.exile?.some((card: any) => card.name === 'Bear')).toBeFalsy();
    expect(state.controlChangeEffects).toBeUndefined();
  });

  it('takes owned permanents with the leaving player even if someone else controls them', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'donated',
          controller: 'p1',
          owner: 'p2',
          card: { name: 'Sol Ring', type_line: 'Artifact' },
        },
      ],
      zones: {},
    };

    const removed = removeLeavingPlayerGameObjects(state, 'p2');
    expect(removed).toEqual(['donated']);
    expect(state.battlefield).toEqual([]);
    expect(state.zones.p2.exile.some((card: any) => card.name === 'Sol Ring')).toBe(true);
  });

  it('returns untracked stolen permanents to a living owner', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'gilded',
          controller: 'p2',
          owner: 'p1',
          card: { name: 'Gilded Drake', type_line: 'Creature — Drake' },
        },
      ],
      zones: {},
    };

    expect(removeLeavingPlayerGameObjects(state, 'p2')).toEqual([]);
    expect(state.battlefield).toEqual([
      expect.objectContaining({ id: 'gilded', controller: 'p1', owner: 'p1' }),
    ]);
  });

  it('unattaches another player\'s equipment from a defeated player\'s creature', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'bear',
          controller: 'p2',
          owner: 'p2',
          attachedEquipment: ['sword'],
          isEquipped: true,
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'sword',
          controller: 'p1',
          owner: 'p1',
          attachedTo: 'bear',
          equippedCreatureId: 'bear',
          card: { name: 'Sword of Feast and Famine', type_line: 'Artifact — Equipment' },
        },
      ],
      zones: {},
    };

    const removed = removeLeavingPlayerGameObjects(state, 'p2');
    expect(removed).toEqual(['bear']);
    expect(state.battlefield.map((perm: any) => perm.id)).toEqual(['sword']);
    expect(state.battlefield[0].controller).toBe('p1');
    expect(state.battlefield[0].attachedTo).toBeUndefined();
    expect(state.battlefield[0].equippedCreatureId).toBeUndefined();
  });

  it('unattaches another player\'s aura from a defeated player\'s creature', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'bear',
          controller: 'p2',
          owner: 'p2',
          attachments: ['pacifism'],
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'pacifism',
          controller: 'p1',
          owner: 'p1',
          attachedTo: 'bear',
          enchanting: 'bear',
          enchantedPermanentId: 'bear',
          card: { name: 'Pacifism', type_line: 'Enchantment — Aura' },
        },
      ],
      zones: {},
    };

    removeLeavingPlayerGameObjects(state, 'p2');
    expect(state.battlefield.map((perm: any) => perm.id)).toEqual(['pacifism']);
    expect(state.battlefield[0].attachedTo).toBeUndefined();
    expect(state.battlefield[0].enchanting).toBeUndefined();
    expect(state.battlefield[0].enchantedPermanentId).toBeUndefined();
  });

  it('unattaches a curse when the enchanted player leaves', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'curse',
          controller: 'p1',
          owner: 'p1',
          attachedTo: 'p2',
          enchantedPlayerId: 'p2',
          card: { name: "Curse of Disturbance", type_line: 'Enchantment — Aura Curse' },
        },
      ],
      zones: {},
    };

    removeLeavingPlayerGameObjects(state, 'p2');
    expect(state.battlefield).toHaveLength(1);
    expect(state.battlefield[0].attachedTo).toBeUndefined();
    expect(state.battlefield[0].enchantedPlayerId).toBeUndefined();
  });

  it('clears host attachment lists when the leaving player owned the aura', () => {
    const state: any = {
      players: [player('p1'), player('p2', { hasLost: true })],
      battlefield: [
        {
          id: 'lion',
          controller: 'p1',
          owner: 'p1',
          attachments: ['pacifism'],
          attachedEquipment: ['sword'],
          isEquipped: true,
          card: { name: 'Savannah Lions', type_line: 'Creature — Cat', power: '2', toughness: '1' },
        },
        {
          id: 'pacifism',
          controller: 'p2',
          owner: 'p2',
          attachedTo: 'lion',
          card: { name: 'Pacifism', type_line: 'Enchantment — Aura' },
        },
        {
          id: 'sword',
          controller: 'p2',
          owner: 'p2',
          attachedTo: 'lion',
          card: { name: 'Bonesplitter', type_line: 'Artifact — Equipment' },
        },
      ],
      zones: {},
    };

    const removed = removeLeavingPlayerGameObjects(state, 'p2');
    expect(removed.sort()).toEqual(['pacifism', 'sword']);
    expect(state.battlefield).toEqual([
      expect.objectContaining({
        id: 'lion',
        attachments: [],
        attachedEquipment: [],
        isEquipped: false,
      }),
    ]);
  });
});
