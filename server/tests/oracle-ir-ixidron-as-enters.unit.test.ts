import { afterEach, describe, expect, it } from 'vitest';

import { queueBattlefieldEntryReplacementPromptsAfterOracleIR } from '../src/state/modules/oracleIrBattlefieldEntryPrompts.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const IXIDRON_ORACLE =
  "As this creature enters, turn all other nontoken creatures face down. (They're 2/2 creatures.)\nIxidron's power and toughness are each equal to the number of face-down creatures on the battlefield.";

describe('oracle IR as-enters automatic replacements', () => {
  const gameId = 'oracle_ir_ixidron_as_enters';

  afterEach(() => {
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  it('turns other nontoken creatures face down when Ixidron is put onto the battlefield by IR', () => {
    const ixidron = {
      id: 'ixidron-1',
      controller: 'p1',
      card: {
        id: 'ix-card',
        name: 'Ixidron',
        type_line: 'Creature — Illusion',
        oracle_text: IXIDRON_ORACLE,
      },
    };
    const bear = {
      id: 'bear-1',
      controller: 'p1',
      card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    };
    const token = {
      id: 'token-1',
      controller: 'p1',
      isToken: true,
      card: { id: 'token-card', name: 'Soldier', type_line: 'Creature — Soldier' },
    };
    const state = {
      battlefield: [ixidron, bear, token],
      players: [{ id: 'p1', hand: [] }],
      zones: { p1: { hand: [] } },
    };
    const ctx = { gameId, state } as any;

    queueBattlefieldEntryReplacementPromptsAfterOracleIR(ctx, state, new Set(['bear-1', 'token-1']));

    const nextBear = state.battlefield.find((perm: any) => perm.id === 'bear-1');
    const nextIxidron = state.battlefield.find((perm: any) => perm.id === 'ixidron-1');
    const nextToken = state.battlefield.find((perm: any) => perm.id === 'token-1');
    expect(nextIxidron.card.faceDown).not.toBe(true);
    expect(nextToken.card.faceDown).not.toBe(true);
    expect(nextBear.card.faceDown).toBe(true);
    expect(nextBear.faceUpCard?.name).toBe('Grizzly Bears');
  });
});
