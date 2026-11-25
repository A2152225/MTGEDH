/**
 * P2-3 crack-back estimate fixtures.
 */

import { describe, expect, it } from 'vitest';
import {
  CRACK_BACK_DISCOUNT,
  estimateCrackBack,
} from '../src/ai/crackBack.js';
import { creature } from './fixtures/combatAiFixtures.js';

describe('P2-3 estimateCrackBack', () => {
  it('exports the named discount constant', () => {
    expect(CRACK_BACK_DISCOUNT).toBe(0.5);
  });

  it('no blockers: full opposing power gets through', () => {
    const a = creature('a', 6, 6, {}, { controllerId: 'opp' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [a] }],
    });
    expect(out.perOpponent.opp).toBe(6);
    expect(out.worstCase).toBe(6);
    expect(out.tableEstimate).toBe(6);
    expect(out.lethal).toBe(false);
  });

  it('blockers absorb the biggest attackers first', () => {
    const big = creature('big', 8, 8, {}, { controllerId: 'opp' });
    const small = creature('small', 2, 2, {}, { controllerId: 'opp' });
    const blk = creature('blk', 1, 1, {}, { controllerId: 'me' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [blk],
      opponents: [{ id: 'opp', attackers: [big, small] }],
      myId: 'me',
    });
    // Blocker stops big (8 prevented), small (2) gets through.
    expect(out.perOpponent.opp).toBe(2);
  });

  it('one huge opponent vs several small ones: worstCase is the huge', () => {
    const huge = creature('h', 12, 12, {}, { controllerId: 'o1' });
    const s1 = creature('s1', 3, 3, {}, { controllerId: 'o2' });
    const s2 = creature('s2', 3, 3, {}, { controllerId: 'o3' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [
        { id: 'o1', attackers: [huge] },
        { id: 'o2', attackers: [s1] },
        { id: 'o3', attackers: [s2] },
      ],
    });
    expect(out.worstCase).toBe(12);
    // table = 12 + CRACK_BACK_DISCOUNT*(3+3)
    expect(out.tableEstimate).toBe(12 + CRACK_BACK_DISCOUNT * 6);
  });

  it('commander reaching 21 is lethal while life is still 40', () => {
    const cmd = creature('cmd', 5, 5, {}, {
      controllerId: 'opp',
      isCommander: true,
      cardId: 'cmd_card',
    });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [cmd] }],
      commanderDamageTaken: { cmd_card: 16 },
    });
    expect(out.lethal).toBe(true);
  });

  it('commander lethal when taken table is keyed by permanent id', () => {
    const cmd = creature('cmd', 6, 6, {}, {
      controllerId: 'opp',
      isCommander: true,
      cardId: 'card_cmd',
    });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [cmd] }],
      commanderDamageTaken: { cmd: 15 },
    });
    expect(out.lethal).toBe(true);
  });

  it('lethal flips exactly at life boundary', () => {
    const a = creature('a', 10, 10, {}, { controllerId: 'opp' });
    const at = estimateCrackBack({
      lifeAfterCombat: 10,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [a] }],
    });
    expect(at.tableEstimate).toBe(10);
    expect(at.lethal).toBe(true);

    const below = estimateCrackBack({
      lifeAfterCombat: 11,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [a] }],
    });
    expect(below.lethal).toBe(false);
  });

  it('discount reduces contribution of non-worst opponents', () => {
    const a = creature('a', 8, 8, {}, { controllerId: 'o1' });
    const b = creature('b', 8, 8, {}, { controllerId: 'o2' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [
        { id: 'o1', attackers: [a] },
        { id: 'o2', attackers: [b] },
      ],
      discount: 0.5,
    });
    expect(out.worstCase).toBe(8);
    expect(out.tableEstimate).toBe(8 + 0.5 * 8);
  });

  it('custom discount is respected', () => {
    const a = creature('a', 10, 10, {}, { controllerId: 'o1' });
    const b = creature('b', 6, 6, {}, { controllerId: 'o2' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [
        { id: 'o1', attackers: [a] },
        { id: 'o2', attackers: [b] },
      ],
      discount: 0,
    });
    expect(out.tableEstimate).toBe(10);
  });

  it('empty opponents yields zero risk', () => {
    const out = estimateCrackBack({
      lifeAfterCombat: 1,
      myUntappedBlockers: [],
      opponents: [],
    });
    expect(out.worstCase).toBe(0);
    expect(out.tableEstimate).toBe(0);
    expect(out.lethal).toBe(false);
  });

  it('double strike counts double when unblocked', () => {
    const a = creature('a', 4, 4, { doubleStrike: true }, { controllerId: 'opp' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [],
      opponents: [{ id: 'opp', attackers: [a] }],
    });
    expect(out.perOpponent.opp).toBe(8);
  });

  it('blocked non-trample commander does not add commander lethal', () => {
    const cmd = creature('cmd', 5, 5, {}, {
      controllerId: 'opp',
      isCommander: true,
      cardId: 'cmd_card',
    });
    const blk = creature('blk', 5, 5, {}, { controllerId: 'me' });
    const out = estimateCrackBack({
      lifeAfterCombat: 40,
      myUntappedBlockers: [blk],
      opponents: [{ id: 'opp', attackers: [cmd] }],
      commanderDamageTaken: { cmd_card: 16 },
      myId: 'me',
    });
    expect(out.lethal).toBe(false);
    expect(out.perOpponent.opp).toBe(0);
  });
});
