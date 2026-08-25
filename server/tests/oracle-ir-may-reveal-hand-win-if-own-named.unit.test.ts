import { afterEach, describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ORACLE_IR_FALLBACK_STEP_KINDS } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { handleMayRevealHandWinIfOwnNamedChoice } from '../src/socket/resolution-handlers/optionChoiceMayRevealHandWinHandlers.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Hedron Alignment' AND is_token = 0.
const HEDRON_ALIGNMENT_ORACLE =
  'Hexproof\nAt the beginning of your upkeep, you may reveal your hand. If you do, you win the game if you own a card named Hedron Alignment in exile, in your hand, in your graveyard, and on the battlefield.\n{1}{U}: Scry 1.';

function collectTriggerSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || [])
    .filter((ability) => String(ability.type || '').toLowerCase() === 'triggered')
    .flatMap((ability) => ability.steps || []);
}

function namedCard(id: string, name: string) {
  return { id, name };
}

function mockIo() {
  const chats: string[] = [];
  return {
    chats,
    to: () => ({
      emit: (_event: string, payload: { message?: string }) => {
        if (payload?.message) chats.push(String(payload.message));
      },
    }),
  } as any;
}

function makeCtx(options: {
  readonly sourceName: string;
  readonly hand?: readonly { id: string; name: string }[];
  readonly graveyard?: readonly { id: string; name: string }[];
  readonly exile?: readonly { id: string; name: string }[];
  readonly battlefieldName?: string;
}) {
  const sourceName = options.sourceName;
  const battlefieldName = options.battlefieldName ?? sourceName;
  const hand = [...(options.hand || [])];
  const graveyard = [...(options.graveyard || [])];
  const exile = [...(options.exile || [])];
  return {
    state: {
      players: [
        { id: 'p1', name: 'P1', life: 40, library: [], hand, graveyard, exile },
        { id: 'p2', name: 'P2', life: 40, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [{
        id: 'bf_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'bf_1', name: battlefieldName, oracle_text: HEDRON_ALIGNMENT_ORACLE, type_line: 'Enchantment' },
      }],
      life: { p1: 40, p2: 40 },
      turnNumber: 3,
      zones: {
        p1: { hand, library: [], graveyard, exile },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
    },
    gameId: 'test_may_reveal_hand_win',
    bumpSeq: () => {},
    libraries: new Map([['p1', []], ['p2', []]]),
  } as any;
}

function applyTrigger(ctx: ReturnType<typeof makeCtx>, sourceName: string) {
  const steps = collectTriggerSteps(HEDRON_ALIGNMENT_ORACLE, sourceName);
  const irCtx = buildOracleIRExecutionContext({
    controllerId: 'p1',
    sourceId: 'bf_1',
    sourceName,
    sourceObjectType: 'ability',
  });
  return applyOracleIRStepsOnServer(ctx, ctx.state, steps, irCtx, { allowOptional: true }, {
    controller: 'p1',
    oracleText: HEDRON_ALIGNMENT_ORACLE,
  });
}

async function choose(ctx: ReturnType<typeof makeCtx>, choiceId: 'reveal' | 'decline', sourceName: string) {
  const io = mockIo();
  await handleMayRevealHandWinIfOwnNamedChoice(
    io,
    ctx,
    ctx.gameId,
    {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName,
      mayRevealHandWinIfOwnNamedChoice: true,
      oracleIrControllerId: 'p1',
      oracleIrSourceName: sourceName,
      description: `${sourceName}: You may reveal your hand.`,
    } as any,
    { playerId: 'p1', selections: choiceId } as any,
  );
  return io;
}

describe('may-reveal-hand if-you-do four-zone named-copy win (Hedron Alignment family)', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('test_may_reveal_hand_win');
  });

  it('parses the dedicated trigger step kind', () => {
    const steps = collectTriggerSteps(HEDRON_ALIGNMENT_ORACLE, 'Hedron Alignment');
    expect(steps.some((step) => step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones')).toBe(true);
    expect(steps.some((step) => step.kind === 'win_game')).toBe(false);
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('may_reveal_hand_then_win_if_own_named_in_zones')).toBe(true);
  });

  it('queues OPTION_CHOICE and does not stamp a winner on apply', () => {
    const ctx = makeCtx({
      sourceName: 'Hedron Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [namedCard('g1', 'Hedron Alignment')],
      exile: [namedCard('e1', 'Hedron Alignment')],
    });
    const result = applyTrigger(ctx, 'Hedron Alignment');
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect(ctx.state.winner).toBeUndefined();
    const queued = ResolutionQueueManager.getQueue(ctx.gameId).steps as any[];
    expect(queued.some((step) =>
      step.type === ResolutionStepType.OPTION_CHOICE
      && step.mayRevealHandWinIfOwnNamedChoice === true
    )).toBe(true);
  });

  it('decline does not win', async () => {
    const ctx = makeCtx({
      sourceName: 'Hedron Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [namedCard('g1', 'Hedron Alignment')],
      exile: [namedCard('e1', 'Hedron Alignment')],
    });
    await choose(ctx, 'decline', 'Hedron Alignment');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeFalsy();
  });

  it('reveal with four owned same-name copies wins', async () => {
    const ctx = makeCtx({
      sourceName: 'Custom Alignment',
      hand: [namedCard('h1', 'Custom Alignment')],
      graveyard: [namedCard('g1', 'Custom Alignment')],
      exile: [namedCard('e1', 'Custom Alignment')],
    });
    await choose(ctx, 'reveal', 'Custom Alignment');
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.status).toBe('finished');
    expect(ctx.state.gameOver).toBe(true);
    expect(String(ctx.state.winReason || '')).toContain('win');
  });

  it('Custom Alignment source plus Hedron Alignment zone copies does not win', async () => {
    const ctx = makeCtx({
      sourceName: 'Custom Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [namedCard('g1', 'Hedron Alignment')],
      exile: [namedCard('e1', 'Hedron Alignment')],
      battlefieldName: 'Hedron Alignment',
    });
    await choose(ctx, 'reveal', 'Custom Alignment');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeFalsy();
  });

  it('missing graveyard copy does not win after reveal', async () => {
    const ctx = makeCtx({
      sourceName: 'Hedron Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [],
      exile: [namedCard('e1', 'Hedron Alignment')],
    });
    await choose(ctx, 'reveal', 'Hedron Alignment');
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeFalsy();
  });
});
