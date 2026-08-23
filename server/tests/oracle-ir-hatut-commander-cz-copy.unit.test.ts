import { describe, expect, it, vi } from 'vitest';

import * as db from '../src/db/index.js';
import { queueCopySpellStackPushFromOracleIRResult } from '../src/state/modules/oracleIrServerCopySpellSync.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
import { resolveCopySpellCount } from '../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('commander cast-from-CZ copy count (Hatut-style)', () => {
  const playerId = 'p_hatut';

  it('resolves tax=4 (two CZ casts) to count 2 via taxById / 2', () => {
    const state: any = {
      commandZone: {
        [playerId]: {
          commanderIds: ['cmd_1'],
          tax: 4,
          taxById: { cmd_1: 4 },
          inCommandZone: [],
        },
      },
    };

    expect(resolveCommanderCastsFromCommandZoneThisGame(state, playerId)).toBe(2);

    const step = {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: {
        kind: 'reference_amount',
        raw: "for each time you've cast your commander from the command zone this game",
      },
      raw: "copy it for each time you've cast your commander from the command zone this game",
    } as const;

    expect(resolveCopySpellCount(state, playerId, step as any)).toBe(2);
  });

  it('pushes that many this_spell copies onto the stack when deferred to server', () => {
    const gameId = 'test_hatut_commander_cz_copies';
    const hatutStackId = 'stack_hatut_1';

    const state: any = {
      commandZone: {
        [playerId]: {
          commanderIds: ['cmd_1'],
          tax: 4,
          taxById: { cmd_1: 4 },
          inCommandZone: [],
        },
      },
      stack: {
        objects: [
          {
            id: hatutStackId,
            type: 'spell',
            controller: playerId,
            card: {
              id: 'hatut_1',
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text:
                "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nWhen this creature enters, destroy up to one target artifact or enchantment.",
            },
          },
        ],
      },
    };

    const copyStep = {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: {
        kind: 'reference_amount',
        raw: "for each time you've cast your commander from the command zone this game",
      },
      raw: "copy it for each time you've cast your commander from the command zone this game",
    } as const;

    // Simulate sticky-zero metadata from a prior buggy IR resolution; server must re-resolve from tax.
    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 0 },
      }],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: hatutStackId,
      sourceName: 'Hatut Zeraze Strike Force',
      sourceObjectType: 'spell',
    });

    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);

    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: 'Hatut Zeraze Strike Force',
      irCtx,
      sourceItem: {
        id: 'trigger_hatut_on_cast',
        triggeringStackItemId: hatutStackId,
      },
    });

    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === hatutStackId || item?.isCopy === true);
    expect(copies).toHaveLength(2);
    expect(stackItems.some((item: any) => item?.id === hatutStackId)).toBe(true);

    appendEventSpy.mockRestore();
  });
});
