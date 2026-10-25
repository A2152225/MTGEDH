import { describe, expect, it, vi } from 'vitest';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';
import { equipSacrificeCandidates, parseEquipSacrificeCost } from '../src/state/modules/equipNonManaCosts.js';

vi.mock('../src/socket/util.js', () => ({ broadcastGame: vi.fn(), emitToPlayer: vi.fn() }));

const creature = (id: string, controller = 'p1') => ({ id, controller, card: { id, name: id, type_line: 'Creature \u2014 Human', oracle_text: '' } });

describe('UI34 Equip\u2014Sacrifice a creature', () => {
  it('parses the sacrifice equip cost alongside mana equips', () => {
    const abilities = parseEquipAbilitiesFromOracle('Equipped creature gets +2/+2.\nEquip\u2014Sacrifice a creature.\nEquip {4}');
    expect(abilities.map((a) => a.cost)).toEqual(['Sacrifice a creature', '{4}']);
    expect(abilities[0].label).toBe('Equip\u2014Sacrifice a creature');
    expect(parseEquipSacrificeCost(abilities[0].cost)).toBe('creature');
    expect(parseEquipSacrificeCost('{4}')).toBeNull();
  });

  it('offers only other creatures you control as sacrifice candidates', () => {
    const state = { battlefield: [creature('a'), creature('b'), creature('c', 'p2'), { id: 'eq', controller: 'p1', card: { type_line: 'Artifact \u2014 Equipment' } }] };
    expect(equipSacrificeCandidates(state, 'p1', 'Sacrifice a creature', ['eq', 'a']).map((p) => p.id)).toEqual(['b']);
  });

  it('queues a sacrifice TARGET_SELECTION, then sacrifices and keeps the original equip target', async () => {
    const { handleEquipSacrificeCostStage } = await import('../src/socket/resolution-handlers/targetSelectionEquipSacrificeCost.js');
    const { ResolutionQueueManager } = await import('../src/state/resolution/index.js');
    const gameId = 'ui34-sac';
    const game: any = { state: { battlefield: [creature('a'), creature('b'), { id: 'eq', controller: 'p1', card: { name: 'Blade', type_line: 'Artifact \u2014 Equipment' } }], zones: { p1: { graveyard: [], graveyardCount: 0 } } }, bumpSeq: vi.fn() };
    const first = handleEquipSacrificeCostStage({} as any, game, gameId, { playerId: 'p1', sourceName: 'Blade' } as any, 'p1', 'eq', 'Sacrifice a creature', ['a'], [{ id: 'a' }]);
    expect(first.done).toBe(true);
    const queued: any = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any).find((s: any) => s.equipSacrificeStage);
    expect(queued.validTargets.map((t: any) => t.id)).toEqual(['b']);
    expect(queued.equipTargetIds).toEqual(['a']);
    const second = handleEquipSacrificeCostStage({} as any, game, gameId, queued, 'p1', 'eq', 'Sacrifice a creature', ['b'], queued.validTargets);
    expect(second.done).toBe(false);
    expect(second.targetIds).toEqual(['a']);
    expect(game.state.battlefield.some((p: any) => p.id === 'b')).toBe(false);
    expect(queued.sacrificedPermanentsForCost).toEqual(['b']);
  });
});
