import { describe, expect, it, vi } from 'vitest';

import { ResolutionStepType } from '../src/state/resolution/index.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/socket/util.js', () => ({
  broadcastGame: vi.fn(),
}));

import { handleResolvedSpellCopyChoice } from '../src/socket/resolution-handlers/optionChoiceSpellCopyPrompts.js';

function makeCopiedSpellSnapshot() {
  return {
    id: 'copied_spell_1',
    type: 'spell',
    controller: 'p1',
    name: 'Lightning Bolt',
    card: { id: 'bolt_card_1', name: 'Lightning Bolt' },
  };
}

function makeCopyChoiceStep(snapshot: Record<string, unknown> = makeCopiedSpellSnapshot()) {
  return {
    id: 'resolved_spell_copy_choice_step_1',
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: 'p1',
    sourceId: 'spell_copy_source_1',
    sourceName: 'Echoing Return',
    resolvedSpellCopyChoice: true,
    resolvedSpellCopySnapshot: snapshot,
  } as any;
}

function makeYesResponse() {
  return {
    stepId: 'resolved_spell_copy_choice_step_1',
    playerId: 'p1',
    selections: 'yes',
    cancelled: false,
    timestamp: Date.now(),
  } as any;
}

function makeIoStub() {
  return { to: () => ({ emit: vi.fn() }) } as any;
}

describe('optionChoiceSpellCopyPrompts named-spell ledger', () => {
  it('persists namedSpellsCastThisGame on the applyEvent-missing stack.push fallback', async () => {
    const game: any = {
      seq: 0,
      state: { stack: [] },
      bumpSeq: vi.fn(),
    };

    await handleResolvedSpellCopyChoice(
      makeIoStub(),
      game,
      'g_copy_ledger_fallback',
      makeCopyChoiceStep(),
      makeYesResponse(),
    );

    expect(game.state.stack).toHaveLength(1);
    expect(game.state.stack[0].id).toBe('copied_spell_1');
    expect(game.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Lightning Bolt', id: 'bolt_card_1' }],
    });
  });

  it('does not persist from this handler when applyEvent already handles the copy', async () => {
    const applyEvent = vi.fn();
    const game: any = {
      seq: 0,
      state: { stack: [] },
      bumpSeq: vi.fn(),
      applyEvent,
    };

    await handleResolvedSpellCopyChoice(
      makeIoStub(),
      game,
      'g_copy_ledger_apply_event',
      makeCopyChoiceStep(),
      makeYesResponse(),
    );

    expect(applyEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resolvedSpellCopyResolve' }));
    expect(game.state.stack).toEqual([]);
    expect(game.state.namedSpellsCastThisGame).toBeUndefined();
  });
});
