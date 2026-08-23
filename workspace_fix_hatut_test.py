from pathlib import Path

# Extend Hatut test with ability/card-id fallback regression
path = Path(r"D:\Git\MTGEDH\server\tests\oracle-ir-hatut-commander-cz-copy.unit.test.ts")
text = path.read_text(encoding="utf-8")
old_end = """    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === hatutStackId || item?.isCopy === true);
    expect(copies).toHaveLength(2);
    expect(stackItems.some((item: any) => item?.id === hatutStackId)).toBe(true);

    appendEventSpy.mockRestore();
  });
});
"""
new_end = """    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === hatutStackId || item?.isCopy === true);
    expect(copies).toHaveLength(2);
    expect(stackItems.some((item: any) => item?.id === hatutStackId)).toBe(true);

    appendEventSpy.mockRestore();
  });

  it('finds this_spell by card id when on-cast trigger is ability-typed without triggeringStackItemId', () => {
    const gameId = 'test_hatut_commander_cz_copies_card_id_fallback';
    const hatutStackId = 'stack_hatut_2';
    const hatutCardId = 'hatut_card_2';

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
              id: hatutCardId,
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text:
                "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.",
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

    // Production on-cast path: sourceObjectType=ability, sourceId=cardId, no triggeringStackItemId.
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: hatutCardId,
      sourceName: 'Hatut Zeraze Strike Force',
      sourceObjectType: 'ability',
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
        id: 'trigger_hatut_on_cast_missing_stack_id',
        source: hatutCardId,
        card: { id: hatutCardId, name: 'Hatut Zeraze Strike Force' },
      },
    });

    expect(bridged).toBe(true);
    const copies = getStackItems(state.stack).filter(
      (item: any) => item?.copiedFromStackItemId === hatutStackId || item?.isCopy === true,
    );
    expect(copies).toHaveLength(2);

    appendEventSpy.mockRestore();
  });
});
"""
if old_end not in text:
    raise SystemExit('hatut test end not found')
path.write_text(text.replace(old_end, new_end, 1), encoding='utf-8')
print('extended hatut test')
