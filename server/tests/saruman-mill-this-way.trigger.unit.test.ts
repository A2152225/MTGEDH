import { beforeEach, describe, expect, it } from 'vitest';
import {
  emitTriggersAfterOracleIRApply,
  snapshotBattlefieldForTriggerEmission,
} from '../src/state/modules/oracleIrPostApplyTriggerEmission.js';

const SARUMAN = 'Saruman of Many Colors';
const ORACLE = [
  'Ward—Discard an enchantment, instant, or sorcery card.',
  'Whenever you cast your second spell each turn, each opponent mills two cards. When one or more cards are milled this way, exile target enchantment, instant, or sorcery card with equal or lesser mana value than that spell from among the milled cards. You may cast that card without paying its mana cost.',
].join('\n');

function stateWith(sourceId: string) {
  return {
    seq: 1,
    stack: [] as any[],
    life: { p1: 40, p2: 40 },
    players: [
      { id: 'p1', life: 40, hand: [], graveyard: [] as any[] },
      { id: 'p2', life: 40, hand: [], graveyard: [] as any[] },
    ],
    battlefield: [
      {
        id: 'saruman',
        controller: 'p1',
        card: {
          name: SARUMAN,
          type_line: 'Legendary Creature — Avatar Wizard',
          oracle_text: ORACLE,
        },
      },
    ],
    zones: {},
    sourceId,
  } as any;
}

function ctx(state: any) {
  return {
    state,
    gameId: 'saruman_mill_this_way',
    bumpSeq: () => {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as any;
}

function millResult() {
  return {
    state: {},
    log: [],
    appliedSteps: [{ kind: 'mill', raw: 'each opponent mills two cards' } as any],
    skippedSteps: [],
    automationGaps: [],
    pendingOptionalSteps: [],
  };
}

describe('Saruman of Many Colors milled-this-way rider', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
  });

  it('queues the reflexive exile once when Saruman’s own ability mills cards', () => {
    const state = stateWith('saruman');
    const before = snapshotBattlefieldForTriggerEmission(state);
    state.players[1].graveyard.push(
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
      { id: 'land', name: 'Forest', type_line: 'Basic Land — Forest' },
    );

    emitTriggersAfterOracleIRApply(ctx(state), state, millResult() as any, before, {
      controller: 'p1',
      sourcePermanentId: 'saruman',
    });

    const riders = state.stack.filter((item: any) => item.triggerType === 'mills_this_way');
    expect(riders).toHaveLength(1);
    expect(riders[0].effect).toMatch(/exile target enchantment, instant, or sorcery card/i);
    expect(riders[0].effect).toMatch(/you may cast that card/i);
    expect(riders[0].sourceName).toBe(SARUMAN);
    expect(riders[0].effectData.milledCardIds).toEqual(['bolt', 'land']);
    expect(riders[0].needsTargetSelection).toBe(true);
    expect(state.stack.filter((item: any) => item.triggerType === 'enters')).toHaveLength(0);
  });

  it('does not queue the rider when a different source mills', () => {
    const state = stateWith('other');
    const before = snapshotBattlefieldForTriggerEmission(state);
    state.players[1].graveyard.push({ id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' });

    emitTriggersAfterOracleIRApply(ctx(state), state, millResult() as any, before, {
      controller: 'p1',
      sourcePermanentId: 'other',
    });

    expect(state.stack.filter((item: any) => item.triggerType === 'mills_this_way')).toHaveLength(0);
  });

  it('does not queue the rider when the mill step moves no cards', () => {
    const state = stateWith('saruman');
    const before = snapshotBattlefieldForTriggerEmission(state);

    emitTriggersAfterOracleIRApply(ctx(state), state, millResult() as any, before, {
      controller: 'p1',
      sourcePermanentId: 'saruman',
    });

    expect(state.stack.filter((item: any) => item.triggerType === 'mills_this_way')).toHaveLength(0);
  });
});
