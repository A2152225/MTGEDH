/**
 * Cheap lethal-save blocks for large-combat skip path.
 */

import { describe, expect, it } from 'vitest';
import { planLethalSaveBlocks } from '../src/ai/blockPlannerLethalSave.js';
import { creature } from './fixtures/combatAiFixtures.js';

describe('planLethalSaveBlocks', () => {
  it('returns damage-saving blocks when unblocked damage is lethal', () => {
    const attacker = creature('atk', 5, 5, {}, { controllerId: 'opp' });
    const blocker = creature('blk', 1, 5, {}, { controllerId: 'me' });
    const out = planLethalSaveBlocks({
      defenderId: 'me',
      life: 4,
      attackers: [attacker],
      blockers: [blocker],
    });
    expect(out).not.toBeNull();
    expect(out!.assignments).toEqual([
      { blockerId: 'blk', attackerId: 'atk' },
    ]);
    expect(out!.reason).toMatch(/lethal-save/);
  });

  it('returns null when incoming damage is not lethal', () => {
    const attacker = creature('atk', 2, 2, {}, { controllerId: 'opp' });
    const blocker = creature('blk', 2, 2, {}, { controllerId: 'me' });
    const out = planLethalSaveBlocks({
      defenderId: 'me',
      life: 20,
      attackers: [attacker],
      blockers: [blocker],
    });
    expect(out).toBeNull();
  });
});
