import { beforeEach, describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { maybeApplyOracleIrChoiceStepFromResolution } from '../src/state/modules/oracleIrServerZoneSync.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const CHAOS_WAND =
  "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.";

function makeFourPlayerCtx(gameId: string) {
  const mkLib = (prefix: string) => [
    { id: `${prefix}1`, name: 'Forest', type_line: 'Basic Land — Forest' },
    { id: `${prefix}2`, name: 'Bear', type_line: 'Creature — Bear' },
    { id: `${prefix}3`, name: 'Shock', type_line: 'Instant' },
    { id: `${prefix}4`, name: 'Opt', type_line: 'Instant' },
  ];
  const state: any = {
    players: [
      { id: 'p1', name: 'P1', life: 40, library: mkLib('p1c'), hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', life: 40, library: mkLib('p2c'), hand: [], graveyard: [], exile: [] },
      { id: 'p3', name: 'P3', life: 40, library: mkLib('p3c'), hand: [], graveyard: [], exile: [] },
      { id: 'p4', name: 'P4', life: 40, library: mkLib('p4c'), hand: [], graveyard: [], exile: [] },
    ],
    life: { p1: 40, p2: 40, p3: 40, p4: 40 },
    turnNumber: 5,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      {
        id: 'wand',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'wand_c',
          name: 'Chaos Wand',
          type_line: 'Artifact',
          oracle_text: CHAOS_WAND,
        },
      },
    ],
    zones: {
      p1: { hand: [], library: mkLib('p1c'), graveyard: [], exile: [] },
      p2: { hand: [], library: mkLib('p2c'), graveyard: [], exile: [] },
      p3: { hand: [], library: mkLib('p3c'), graveyard: [], exile: [] },
      p4: { hand: [], library: mkLib('p4c'), graveyard: [], exile: [] },
    },
  };
  return { state, gameId, bumpSeq: () => {}, libraries: new Map() } as any;
}

describe('Chaos Wand activated impulse_exile_top via Oracle IR', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('parses target-opponent requirements for the activated ability', () => {
    const reqs = parseTargetRequirements(CHAOS_WAND);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toContain('opponent');
    expect(reqs.minTargets).toBe(1);
  });

  it('exiles until an instant/sorcery and queues a during-resolution cast choice', () => {
    const gameId = `chaos_wand_${Date.now()}`;
    const ctx = makeFourPlayerCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Chaos Wand',
      oracleText: CHAOS_WAND,
      sourcePermanentId: 'wand',
      targets: ['p2'],
      sourceItem: { id: 'stk_wand', source: 'wand', targets: ['p2'] },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);

    const p2 = ctx.state.players.find((p: any) => p.id === 'p2');
    expect((p2?.exile || []).map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p2?.library?.map((c: any) => c.id)).toEqual(['p2c4', 'p2c1', 'p2c2']);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const castPrompt = (queue?.steps || []).find(
      (step: any) => String(step?.castFromExileCardId || '').trim() === 'p2c3'
        || String(step?.type || '').toLowerCase().includes('option')
        || String(step?.description || '').toLowerCase().includes('cast'),
    );
    expect(castPrompt).toBeTruthy();
  });

  it('accepts targetOpponentId on the source item when targets array is empty', () => {
    const gameId = `chaos_wand_item_${Date.now()}`;
    const ctx = makeFourPlayerCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Chaos Wand',
      oracleText: CHAOS_WAND,
      sourcePermanentId: 'wand',
      sourceItem: { id: 'stk_wand2', source: 'wand', targets: [], targetOpponentId: 'p2' },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    const p2 = ctx.state.players.find((p: any) => p.id === 'p2');
    expect((p2?.exile || []).map((c: any) => c.id)).toEqual(['p2c3']);
  });

  it('queues TARGET_SELECTION when target opponent is unbound (multi-opponent), then resumes', () => {
    const gameId = `chaos_wand_unbound_${Date.now()}`;
    const ctx = makeFourPlayerCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Chaos Wand',
      oracleText: CHAOS_WAND,
      sourcePermanentId: 'wand',
      sourceItem: { id: 'stk_wand3', source: 'wand', targets: [] },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBe(0);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetPrompt = (queue?.steps || []).find(
      (step: any) =>
        String(step?.type || '') === String(ResolutionStepType.TARGET_SELECTION)
        && String(step?.oracleIrChoiceStepJson || '').includes('impulse_exile_top'),
    );
    expect(targetPrompt).toBeTruthy();
    expect((targetPrompt as any).validTargets?.map((t: any) => t.id).sort()).toEqual(['p2', 'p3', 'p4']);

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, targetPrompt, {
      selections: ['p2'],
    });
    expect(resumed).toBeTruthy();
    expect((resumed?.appliedSteps || []).some((step: any) => step.kind === 'impulse_exile_top')).toBe(true);

    const p2 = ctx.state.players.find((p: any) => p.id === 'p2');
    expect((p2?.exile || []).map((c: any) => c.id)).toEqual(['p2c3']);
  });
});
