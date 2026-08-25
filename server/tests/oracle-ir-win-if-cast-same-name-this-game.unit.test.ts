import { describe, expect, it, vi } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ORACLE_IR_FALLBACK_STEP_KINDS } from '../src/state/modules/trigger-runtime-wiring.js';
import { detectWinConditions } from '../src/state/modules/game-state-effects.js';
import { WIN_IF_CAST_SAME_NAME_CONDITION_RAW } from '../../rules-engine/src/oracleIRParserWinIfCastSameNameThisGame.js';
import { persistNamedSpellCastThisGame } from '../src/state/modules/namedSpellsCastThisGame.js';
import { copyStackItem } from '../src/state/modules/stack-mechanics.js';
import { recordSpellCastThisTurn } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.js';
import {
  cloneTriggeredSpellCopy,
  consumeDelayedSpellCopiesForCast,
} from '../src/socket/game-actions-handlers/gameActionsSpellCopyHeroicTriggers.js';
import { applyCopyRetargetEvents } from '../src/state/modules/apply-event-handlers/applyEventCopyRetargetEvents.js';
import { queueCopySpellStackPushFromOracleIRResult } from '../src/state/modules/oracleIrServerCopySpellSync.js';
import * as db from '../src/db/index.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Approach of the Second Sun' AND is_token = 0.
const APPROACH_ORACLE =
  "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.";

const MAZES_END_ORACLE =
  "This land enters tapped.\n{T}: Add {C}.\n{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";

function mockIo() {
  return { to: () => ({ emit: () => {} }) } as any;
}

function collectSpellSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function makeSpellCtx(options: {
  readonly sourceName: string;
  readonly namedSpellsCastThisGame?: unknown;
} = { sourceName: 'Custom Second Dawn' }) {
  const library = Array.from({ length: 10 }, (_, i) => ({
    id: `lib_${i}`,
    name: `Filler ${i}`,
  }));
  return {
    state: {
      players: [
        { id: 'p1', name: 'P1', life: 40, library, hand: [], graveyard: [] },
        { id: 'p2', name: 'P2', life: 40, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [],
      stack: [{
        id: 'spell_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'spell_1', name: options.sourceName, type_line: 'Sorcery', oracle_text: APPROACH_ORACLE },
      }],
      life: { p1: 40, p2: 40 },
      turnNumber: 3,
      zones: {
        p1: { hand: [], library, graveyard: [], exile: [] },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      ...(options.namedSpellsCastThisGame !== undefined
        ? { namedSpellsCastThisGame: options.namedSpellsCastThisGame }
        : {}),
    },
    gameId: 'test_win_if_cast_same_name',
    bumpSeq: () => {},
    libraries: new Map([['p1', library], ['p2', []]]),
  } as any;
}

function applySpell(ctx: ReturnType<typeof makeSpellCtx>, sourceName: string, castFromZone: string) {
  const steps = collectSpellSteps(APPROACH_ORACLE, sourceName);
  const irCtx = buildOracleIRExecutionContext({
    controllerId: 'p1',
    sourceId: 'spell_1',
    sourceName,
    sourceObjectType: 'spell',
    castFromZone,
  });
  return applyOracleIRStepsOnServer(ctx, ctx.state, steps, irCtx, { allowOptional: true }, {
    controller: 'p1',
    oracleText: APPROACH_ORACLE,
  });
}

describe('spell win-if-cast-same-name-this-game (Approach of the Second Sun family)', () => {
  it('wires win_game for spell / fallback IR', () => {
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('win_game')).toBe(true);
  });

  it('collects the spell as conditional win_game with otherwise library + life', () => {
    const steps = collectSpellSteps(APPROACH_ORACLE, 'Custom Second Dawn');
    const winIf = steps.find((step) => step.kind === 'conditional') as {
      condition?: { raw?: string };
      steps?: Array<{ kind: string }>;
      elseSteps?: Array<{ kind: string }>;
    } | undefined;
    expect(String(winIf?.condition?.raw || '').toLowerCase()).toBe(WIN_IF_CAST_SAME_NAME_CONDITION_RAW);
    expect((winIf?.steps || []).map((step) => step.kind)).toEqual(['win_game']);
    expect((winIf?.elseSteps || []).map((step) => step.kind)).toEqual(['move_zone', 'gain_life']);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('applies win_game and stamps gameOver without an Approach name check', () => {
    const ctx = makeSpellCtx({
      sourceName: 'Custom Second Dawn',
      namedSpellsCastThisGame: { p1: ['Custom Second Dawn'] },
    });
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.some((step) => step.kind === 'win_game')).toBe(true);
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.status).toBe('finished');
    expect(ctx.state.gameOver).toBe(true);
  });

  it('applies the otherwise library + life path on the first hand-cast', () => {
    const ctx = makeSpellCtx({
      sourceName: 'Custom Second Dawn',
      namedSpellsCastThisGame: { p1: [] },
    });
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('move_zone');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
    expect(ctx.state.life.p1).toBe(47);

    const library = Array.isArray(ctx.state.players?.[0]?.library)
      ? ctx.state.players[0].library
      : (ctx.libraries.get('p1') || []);
    expect(library[6]?.id).toBe('spell_1');
    expect(String(library[6]?.name || '')).toBe('Custom Second Dawn');
    expect((ctx.state.stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
  });

  it('places this card seventh from the top when the library is shorter than seven', () => {
    const shortLibrary = Array.from({ length: 3 }, (_, i) => ({
      id: `lib_${i}`,
      name: `Filler ${i}`,
    }));
    const ctx = makeSpellCtx({
      sourceName: 'Custom Second Dawn',
      namedSpellsCastThisGame: { p1: [] },
    });
    ctx.state.players[0].library = shortLibrary;
    ctx.state.zones.p1.library = shortLibrary;
    ctx.libraries.set('p1', shortLibrary);

    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.map((step) => step.kind)).toContain('move_zone');
    const library = Array.isArray(ctx.state.players?.[0]?.library)
      ? ctx.state.players[0].library
      : (ctx.libraries.get('p1') || []);
    expect(library.length).toBe(4);
    expect(library[Math.min(6, 3)]?.id).toBe('spell_1');
    expect((ctx.state.stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
  });

  it('persists name+id onto namedSpellsCastThisGame from recordSpellCastThisTurn', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    recordSpellCastThisTurn(
      { state: ctx.state },
      'p1',
      { id: 'spell_1', name: 'Custom Second Dawn' },
      'hand',
    );

    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: 'spell_1' }],
    });
  });

  it('does not treat the current sourceId as another same-name cast this game', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    recordSpellCastThisTurn(
      { state: ctx.state },
      'p1',
      { id: 'spell_1', name: 'Custom Second Dawn' },
      'hand',
    );
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
    expect(ctx.state.life.p1).toBe(47);
  });

  it('persists name+id from persistNamedSpellCastThisGame without recordSpellCastThisTurn', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    persistNamedSpellCastThisGame(ctx.state, 'p1', { id: 'replay_spell_1', name: 'Custom Second Dawn' });

    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: 'replay_spell_1' }],
    });
    expect(ctx.state.spellsCastThisTurn).toBeUndefined();
  });

  it('persists a copyStackItem spell under the new controller with the copy id', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    ctx.state.stack[0].source = { cardName: 'Custom Second Dawn', zone: 'stack' };

    const copied = copyStackItem(ctx, 'spell_1', 'p2');
    expect(copied.success).toBe(true);
    expect(String(copied.copy?.id || '')).not.toBe('spell_1');
    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p2: [{ name: 'Custom Second Dawn', id: copied.copy?.id }],
    });
  });

  it('persists cloneTriggeredSpellCopy under the copy id', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    const copied = cloneTriggeredSpellCopy(
      ctx.gameId,
      { state: ctx.state, seq: 0, bumpSeq: ctx.bumpSeq },
      mockIo(),
      {
        permanentId: 'perm_copy',
        cardName: 'Twincast',
        controllerId: 'p1',
        description: 'Whenever you cast an instant or sorcery spell, copy it.',
        effect: 'Copy that spell.',
        spellCondition: 'instant_sorcery',
        mandatory: true,
      } as any,
      'p1',
      'spell_1',
      'spell_1',
    );
    appendEventSpy.mockRestore();

    expect(copied).toBeTruthy();
    expect(String(copied?.id || '')).not.toBe('spell_1');
    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: copied?.id }],
    });
  });

  it('does not double-count cloneTriggeredSpellCopy then copyTriggeredSpellResolve for the same copy', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    const copied = cloneTriggeredSpellCopy(
      ctx.gameId,
      { state: ctx.state, seq: 0, bumpSeq: ctx.bumpSeq },
      mockIo(),
      {
        permanentId: 'perm_copy',
        cardName: 'Twincast',
        controllerId: 'p1',
        description: 'Whenever you cast an instant or sorcery spell, copy it.',
        effect: 'Copy that spell.',
        spellCondition: 'instant_sorcery',
        mandatory: true,
      } as any,
      'p1',
      'spell_1',
      'spell_1',
    );
    appendEventSpy.mockRestore();

    applyCopyRetargetEvents(ctx, {
      type: 'copyTriggeredSpellResolve',
      sourceName: 'Twincast',
      controllerId: 'p1',
      triggeringStackItemId: 'spell_1',
      copiedStackItemId: String(copied?.id || ''),
    } as any);

    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: copied?.id }],
    });
  });

  it('persists consumeDelayedSpellCopiesForCast under the copy id', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    consumeDelayedSpellCopiesForCast(
      ctx.gameId,
      { state: ctx.state, seq: 0, bumpSeq: ctx.bumpSeq },
      mockIo(),
      'p1',
      ctx.state.stack[0].card,
      'spell_1',
      ctx.state.stack[0],
      [{
        controllerId: 'p1',
        spellType: 'instant_or_sorcery',
        sourceName: 'Twincast',
        allowRetargeting: false,
      }],
    );
    appendEventSpy.mockRestore();

    const copies = (ctx.state.stack || []).filter((item: any) => item?.isCopy === true);
    expect(copies).toHaveLength(1);
    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: copies[0].id }],
    });
  });

  it('persists copyTriggeredSpellResolve when it creates a new stack copy', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const handled = applyCopyRetargetEvents(ctx, {
      type: 'copyTriggeredSpellResolve',
      sourceName: 'Twincast',
      controllerId: 'p1',
      triggeringStackItemId: 'spell_1',
      copiedStackItemId: 'copied_spell_replay',
    } as any);

    expect(handled).toBe(true);
    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: 'copied_spell_replay' }],
    });
  });

  it('does not persist retargetSpellCopyResolve for the same copy', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack.push({
      id: 'copied_spell_retarget',
      type: 'spell',
      controller: 'p1',
      isCopy: true,
      targets: ['p1'],
      card: { id: 'copied_spell_retarget', name: 'Custom Second Dawn' },
    });

    applyCopyRetargetEvents(ctx, {
      type: 'retargetSpellCopyResolve',
      stackItemId: 'copied_spell_retarget',
      targets: ['p2'],
    } as any);

    expect(ctx.state.namedSpellsCastThisGame).toBeUndefined();
    expect(ctx.state.stack.find((item: any) => item.id === 'copied_spell_retarget')?.targets).toEqual(['p2']);
  });

  it('persists resolvedSpellCopyResolve when it creates a new stack copy', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    applyCopyRetargetEvents(ctx, {
      type: 'resolvedSpellCopyResolve',
      copiedSpell: {
        id: 'copied_spell_resolved',
        type: 'spell',
        controller: 'p1',
        isCopy: true,
        card: { id: 'copied_spell_resolved', name: 'Custom Second Dawn' },
      },
    } as any);

    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: 'copied_spell_resolved' }],
    });
  });

  it('persists IR stack spell copies and skips ability copies', () => {
    const playerId = 'p1';
    const targetStackId = 'spell_1';
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const copyStep = {
      kind: 'copy_spell',
      subject: 'target_spell',
      allowNewTargets: false,
      raw: 'Copy target instant or sorcery spell you control.',
    } as const;
    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 1 },
      }],
    };
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'stack_fork_1',
      sourceName: 'Fork',
      targetSpellId: targetStackId,
    });
    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, ctx.state, result, {
      controller: playerId,
      sourceName: 'Fork',
      irCtx,
    });
    appendEventSpy.mockRestore();

    const copies = (ctx.state.stack || []).filter((item: any) => item?.isCopy === true);
    expect(bridged).toBe(true);
    expect(copies).toHaveLength(1);
    expect(ctx.state.namedSpellsCastThisGame).toEqual({
      p1: [{ name: 'Custom Second Dawn', id: copies[0].id }],
    });

    const abilityState: any = {
      stack: [{
        id: 'stack_ability_1',
        type: 'ability',
        controller: playerId,
        sourceName: 'Trade Relay',
        card: { id: 'trade_relay_1', name: 'Trade Relay', type_line: 'Artifact' },
      }],
    };
    const abilityStep = {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that ability' },
      allowNewTargets: false,
      raw: 'copy that ability.',
    } as const;
    const abilityResult: any = {
      appliedSteps: [abilityStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: abilityStep.raw,
        metadata: { copyCount: 1 },
      }],
    };
    const abilityIrCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'rings_trigger_1',
      sourceName: 'Rings of Brighthearth',
      targetSpellId: 'stack_ability_1',
    });
    const abilityAppendSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    queueCopySpellStackPushFromOracleIRResult(ctx, abilityState, abilityResult, {
      controller: playerId,
      sourceName: 'Rings of Brighthearth',
      irCtx: abilityIrCtx,
      sourceItem: { id: 'rings_trigger_1', triggeringStackItemId: 'stack_ability_1' },
    });
    abilityAppendSpy.mockRestore();

    expect(abilityState.namedSpellsCastThisGame).toBeUndefined();
  });

  it('does not treat helper persist of the current sourceId as another same-name cast', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    persistNamedSpellCastThisGame(ctx.state, 'p1', { id: 'spell_1', name: 'Custom Second Dawn' });
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
  });

  it('wins after helper persist of a prior distinct id then the current sourceId', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    persistNamedSpellCastThisGame(ctx.state, 'p1', { id: 'replay_spell_0', name: 'Custom Second Dawn' });
    persistNamedSpellCastThisGame(ctx.state, 'p1', { id: 'spell_1', name: 'Custom Second Dawn' });
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.some((step) => step.kind === 'win_game')).toBe(true);
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.status).toBe('finished');
    expect(ctx.state.gameOver).toBe(true);
  });

  it('wins when a copied spell id is on the ledger and the current sourceId is distinct', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    ctx.state.stack[0].type = 'spell';
    const copied = copyStackItem(ctx, 'spell_1', 'p1');
    expect(copied.success).toBe(true);
    persistNamedSpellCastThisGame(ctx.state, 'p1', { id: 'spell_1', name: 'Custom Second Dawn' });
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.some((step) => step.kind === 'win_game')).toBe(true);
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.gameOver).toBe(true);
  });

  it('wins when a prior distinct id with the same name is on the ledger', () => {
    const ctx = makeSpellCtx({ sourceName: 'Custom Second Dawn' });
    recordSpellCastThisTurn(
      { state: ctx.state },
      'p1',
      { id: 'spell_0', name: 'Custom Second Dawn' },
      'hand',
    );
    recordSpellCastThisTurn(
      { state: ctx.state },
      'p1',
      { id: 'spell_1', name: 'Custom Second Dawn' },
      'hand',
    );
    const result = applySpell(ctx, 'Custom Second Dawn', 'hand');

    expect(result.appliedSteps.some((step) => step.kind === 'win_game')).toBe(true);
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.status).toBe('finished');
    expect(ctx.state.gameOver).toBe(true);
  });

  it('keeps Approach of the Second Sun out of the immediate detectWinConditions battlefield scan', () => {
    const ir = parseOracleTextToIR(APPROACH_ORACLE, 'Approach of the Second Sun');
    expect(ir.abilities.some((ability) =>
      (ability.steps || []).some((step) => step.kind === 'conditional'),
    )).toBe(true);

    const ctx = {
      state: {
        battlefield: [{
          id: 'approach_1',
          controller: 'p1',
          card: { name: 'Approach of the Second Sun', oracle_text: APPROACH_ORACLE, type_line: 'Sorcery' },
        }],
      },
    } as any;
    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
  });

  it("keeps Maze's End out of the immediate detectWinConditions battlefield scan", () => {
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'maze_1',
            controller: 'p1',
            card: { name: "Maze's End", oracle_text: MAZES_END_ORACLE, type_line: 'Land' },
          },
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `gate_${i}`,
            controller: 'p1',
            card: { name: `Gate ${i}`, type_line: 'Land — Gate' },
          })),
        ],
      },
    } as any;
    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
  });
});
