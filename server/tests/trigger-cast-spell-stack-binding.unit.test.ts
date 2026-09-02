import { describe, expect, it } from 'vitest';
import {
  cloneTriggeringStackItemSnapshot,
  findTriggeringSpellOnStack,
} from '../src/state/modules/triggerCastSpellStackBinding.js';

describe('findTriggeringSpellOnStack last-known information', () => {
  const masterWarcraft = {
    id: 'stack_warcraft_1',
    type: 'spell',
    controller: 'p2',
    card: { id: 'warcraft_card', name: 'Master Warcraft', type_line: 'Instant' },
  };
  const warpWorld = {
    id: 'stack_warp_1',
    type: 'spell',
    controller: 'p2',
    card: { id: 'warp_card', name: 'Warp World', type_line: 'Sorcery' },
  };

  it('returns the live bound spell when it is still on the stack', () => {
    const found = findTriggeringSpellOnStack(
      { stack: [warpWorld, masterWarcraft] },
      {
        triggeringStackItemId: 'stack_warcraft_1',
        effectData: {
          triggeringStackItemId: 'stack_warcraft_1',
          triggeringSpell: { id: 'warcraft_card', name: 'Master Warcraft' },
        },
      },
    );
    expect(found?.id).toBe('stack_warcraft_1');
    expect(found?.card?.name).toBe('Master Warcraft');
  });

  it('does not rebind to another live spell after the bound spell left the stack', () => {
    const snapshot = cloneTriggeringStackItemSnapshot(masterWarcraft);
    const found = findTriggeringSpellOnStack(
      { stack: [warpWorld] },
      {
        triggeringStackItemId: 'stack_warcraft_1',
        effectData: {
          triggeringStackItemId: 'stack_warcraft_1',
          triggeringSpell: { id: 'warcraft_card', name: 'Master Warcraft', type_line: 'Instant' },
          triggeringSpellStackItem: snapshot,
        },
      },
    );
    expect(found?.id).toBe('stack_warcraft_1');
    expect(found?.card?.name).toBe('Master Warcraft');
  });

  it('does not rebind by caster when only the triggering spell name is known and that spell left', () => {
    const found = findTriggeringSpellOnStack(
      { stack: [warpWorld] },
      {
        triggeringPlayer: 'p2',
        effectData: {
          casterId: 'p2',
          triggeringSpell: { id: 'warcraft_card', name: 'Master Warcraft', type_line: 'Instant' },
        },
      },
    );
    expect(found?.card?.name).toBe('Master Warcraft');
    expect(found?.id).not.toBe('stack_warp_1');
  });

  it('still recovers a unique remaining caster spell when the trigger has no identity (G1)', () => {
    const found = findTriggeringSpellOnStack(
      { stack: [warpWorld] },
      { triggerType: 'any_player_casts_any', triggeringPlayer: 'p2' },
    );
    expect(found?.id).toBe('stack_warp_1');
  });
});
