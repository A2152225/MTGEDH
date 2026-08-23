import { describe, expect, it, vi } from 'vitest';

import * as db from '../src/db/index.js';
import { queueCopySpellStackPushFromOracleIRResult } from '../src/state/modules/oracleIrServerCopySpellSync.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
import { resolveCopySpellCount } from '../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyChooseModeStep } from '../../rules-engine/src/oracleIRExecutorChooseModeStepHandlers.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

const COMMANDER_CZ_COPY_RAW =
  "copy it for each time you've cast your commander from the command zone this game";

const STORM_SUITE = [
  {
    name: 'Echo Storm',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game. You may choose new targets for the copies.\nCreate a token that's a copy of target artifact.",
  },
  {
    name: 'Fury Storm',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game. You may choose new targets for the copies.\nCopy target instant or sorcery spell. You may choose new targets for the copy.",
  },
  {
    name: 'Genesis Storm',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nReveal cards from the top of your library until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order.",
  },
  {
    name: 'Empyrial Storm',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nCreate a 4/4 white Angel creature token with flying.",
  },
  {
    name: 'Skull Storm',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nEach opponent sacrifices a creature of their choice. Each opponent who can't loses half their life, rounded up.",
  },
  {
    name: 'Hatut Zeraze Strike Force',
    oracle:
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nWhen this creature enters, destroy up to one target artifact or enchantment.",
  },
] as const;

describe('commander Storm suite CZ copy counts (generic taxById/2)', () => {
  const playerId = 'p_storm';

  it.each(STORM_SUITE)('$name parses copy_spell reference_amount for CZ casts', ({ name, oracle }) => {
    const ir = parseOracleTextToIR(oracle, name);
    const copyStep = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step: any) => step.kind === 'copy_spell' && step.subject === 'this_spell');
    expect(copyStep).toBeTruthy();
    expect((copyStep as any).copies?.kind).toBe('reference_amount');
    expect(String((copyStep as any).copies?.raw || '')).toMatch(/commander.*command zone.*this game/i);
  });

  it('resolves tax=6 (three CZ casts) to count 3 for every Storm-suite copy_spell step', () => {
    const state: any = {
      commandZone: {
        [playerId]: {
          commanderIds: ['cmd_1'],
          tax: 6,
          taxById: { cmd_1: 6 },
          inCommandZone: [],
        },
      },
    };
    expect(resolveCommanderCastsFromCommandZoneThisGame(state, playerId)).toBe(3);

    for (const { name, oracle } of STORM_SUITE) {
      const ir = parseOracleTextToIR(oracle, name);
      const copyStep = ir.abilities
        .flatMap((ability) => ability.steps || [])
        .find((step: any) => step.kind === 'copy_spell' && step.subject === 'this_spell') as any;
      expect(resolveCopySpellCount(state, playerId, copyStep), name).toBe(3);
    }
  });

  it('Echo Storm server bridge pushes CZ-count this_spell copies', () => {
    const gameId = 'test_echo_storm_commander_cz_copies';
    const stackId = 'stack_echo_1';
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
            id: stackId,
            type: 'spell',
            controller: playerId,
            card: {
              id: 'echo_1',
              name: 'Echo Storm',
              type_line: 'Sorcery',
              oracle_text: STORM_SUITE[0].oracle,
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
      raw: COMMANDER_CZ_COPY_RAW,
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

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: stackId,
      sourceName: 'Echo Storm',
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
      sourceName: 'Echo Storm',
      irCtx,
      sourceItem: {
        id: 'trigger_echo_on_cast',
        triggeringStackItemId: stackId,
      },
    });

    expect(bridged).toBe(true);
    const copies = getStackItems(state.stack).filter(
      (item: any) => item?.copiedFromStackItemId === stackId || item?.isCopy === true,
    );
    expect(copies).toHaveLength(2);
    appendEventSpy.mockRestore();
  });
});

describe('Depth Defiler modal + kicker choose-both', () => {
  const oracle =
    'Devoid (This card has no color.)\n'
    + 'Kicker {C} (You may pay an additional {C} as you cast this spell.)\n'
    + 'When you cast this spell, choose one. If it was kicked, choose both instead.\n'
    + "• Return target creature to its owner's hand.\n"
    + '• Target player draws two cards, then discards a card.';

  it('stamps kickerChooseBoth with unkicked min=max=1 and fixes then-discard who', () => {
    const ir = parseOracleTextToIR(oracle, 'Depth Defiler');
    const choose = ir.abilities
      .flatMap((a) => a.steps || [])
      .find((s: any) => s.kind === 'choose_mode') as any;
    expect(choose?.kickerChooseBoth).toBe(true);
    expect(choose?.minModes).toBe(1);
    expect(choose?.maxModes).toBe(1);
    const mode2 = choose.modes[1];
    expect(mode2.steps[0].kind).toBe('draw');
    expect(mode2.steps[0].who.kind).toBe('target_player');
    expect(mode2.steps[1].kind).toBe('discard');
    expect(mode2.steps[1].who.kind).toBe('target_player');
  });

  it('auto-resolves both modes when wasKicked without selectedModeIds', () => {
    const ir = parseOracleTextToIR(oracle, 'Depth Defiler');
    const choose = ir.abilities
      .flatMap((a) => a.steps || [])
      .find((s: any) => s.kind === 'choose_mode') as any;

    const result = applyChooseModeStep(
      { battlefield: [], players: [] } as any,
      choose,
      { controllerId: 'p1', wasKicked: true } as any,
      {},
      (state, steps) => ({
        state,
        log: [`nested:${steps.map((s: any) => s.kind).join(',')}`],
        appliedSteps: [...steps],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
      }),
    );

    expect(result.kind).toBe('applied');
    expect((result as any).log[0]).toMatch(/2 selected mode/);
  });
});

describe('Distended Mindbender / Mana Vortex on-cast IR wiring', () => {
  it('Distended Mindbender reveal+dual-filter discard is fully IR-wired', () => {
    const body =
      'target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.';
    expect(isTriggerEffectFullyIrWired(body, 'Distended Mindbender')).toBe(true);
    const steps = collectOracleEffectSteps(body, 'Distended Mindbender') as any[];
    expect(steps.map((s) => s.kind)).toEqual(['reveal_hand', 'discard']);
    expect(steps[1].amount).toEqual({ kind: 'number', value: 2 });
    expect(String(steps[1].target?.text || '')).toMatch(/mana value 3 or less/i);
  });

  it('Mana Vortex counter-unless-sacrifice is fully IR-wired', () => {
    const body = 'counter it unless you sacrifice a land.';
    expect(isTriggerEffectFullyIrWired(body, 'Mana Vortex')).toBe(true);
    const steps = collectOracleEffectSteps(body, 'Mana Vortex') as any[];
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('unless_sacrifices');
    expect(steps[0].what?.text).toMatch(/a land/i);
    expect(steps[0].steps?.[0]?.kind).toBe('counter_spell');
  });
});
