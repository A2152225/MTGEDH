import { describe, expect, it } from 'vitest';
import { ChoiceEventType } from '../src/choiceEventsTypes.js';
import {
  bindEffectProgramChoiceResponse,
  buildEffectProgramFromOracleIR,
  createEffectProgramRuntime,
} from '../src/effectProgram.js';
import { runOracleEffectProgram } from '../src/effectProgramOracleRunner.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import type { GameState } from '../../shared/src/index.js';

const SHADRIX_ORACLE =
  'Flying, double strike\n' +
  'At the beginning of combat on your turn, you may choose two. Each mode must target a different player.\n' +
  '\u2022 Target player creates a 2/1 white and black Inkling creature token with flying.\n' +
  '\u2022 Target player draws a card and loses 1 life.\n' +
  '\u2022 Target player puts a +1/+1 counter on each creature they control.';

function collectChooseModeStep(oracleText = SHADRIX_ORACLE) {
  const ir = parseOracleTextToIR(oracleText, 'Shadrix Silverquill');
  const ability = ir.abilities.find((entry) =>
    /beginning of combat on your turn/i.test(String(entry.triggerCondition || entry.text || '')),
  );
  const step = ability?.steps.find((entry) => entry.kind === 'choose_mode');
  return { ir, ability, step: step as any };
}

function makeState(): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'lib-p1', name: 'Island' }],
        hand: [],
        graveyard: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [{ id: 'lib-p2', name: 'Swamp' }],
        hand: [],
        graveyard: [],
      } as any,
      {
        id: 'p3',
        name: 'P3',
        seat: 2,
        life: 40,
        library: [{ id: 'lib-p3', name: 'Mountain' }],
        hand: [],
        graveyard: [],
      } as any,
    ],
    battlefield: [
      {
        id: 'p1-bear',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        counters: {},
      },
      {
        id: 'p2-elf',
        controller: 'p2',
        owner: 'p2',
        card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '' },
        counters: {},
      },
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    commandZone: {} as any,
    phase: 'beginning_combat' as any,
    active: true,
  } as any;
}

describe('Shadrix Silverquill choose-two distinct-player modes', () => {
  it('parses the combat trigger as an optional choose_mode with three target-player modes', () => {
    const { ability, step } = collectChooseModeStep();

    expect(ability?.steps).toHaveLength(1);
    expect(step).toMatchObject({
      kind: 'choose_mode',
      minModes: 2,
      maxModes: 2,
      optional: true,
      distinctPlayerTargets: true,
    });
    expect(step.modes).toHaveLength(3);
    expect(step.modes.map((mode: any) => mode.steps.map((inner: any) => inner.kind))).toEqual([
      ['create_token'],
      ['draw', 'lose_life'],
      ['add_counter'],
    ]);
    expect(step.modes[1].steps[0]).toMatchObject({ kind: 'draw', who: { kind: 'target_player' } });
    expect(step.modes[1].steps[1]).toMatchObject({ kind: 'lose_life', who: { kind: 'target_player' } });
    expect(step.modes[2].steps[0]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'each creature target player controls' },
    });
  });

  it('lowers distinct-player choose_mode into may, mode, then per-mode player prompts', () => {
    const { step } = collectChooseModeStep();
    const program = buildEffectProgramFromOracleIR({
      id: 'shadrix',
      controllerId: 'p1',
      sourceId: 'shadrix-1',
      sourceName: 'Shadrix Silverquill',
      steps: [step],
    });

    expect(program.steps.map((entry) => `${entry.kind}:${(entry as any).choiceRequest?.type || (entry as any).command?.kind || ''}`)).toEqual([
      'choice:option_choice',
      'choice:mode_selection',
      'choice:player_choice',
      'command:oracle_ir_step',
      'choice:player_choice',
      'command:oracle_ir_step',
      'command:oracle_ir_step',
      'choice:player_choice',
      'command:oracle_ir_step',
    ]);
    expect((program.steps[1] as any).choiceRequest.payload).toMatchObject({
      minModes: 2,
      maxModes: 2,
    });
    expect((program.steps[1] as any).choiceRequest.payload.modes).toHaveLength(3);
  });

  it('applies chosen modes to different players and does not auto-buff the controller', () => {
    const { step } = collectChooseModeStep();
    const program = buildEffectProgramFromOracleIR({
      id: 'shadrix',
      controllerId: 'p1',
      sourceId: 'shadrix-1',
      sourceName: 'Shadrix Silverquill',
      steps: [step],
    });

    let run = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'shadrix-1', sourceName: 'Shadrix Silverquill' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.OPTION_CHOICE);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['yes'],
          cancelled: false,
          timestamp: 1,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'shadrix-1', sourceName: 'Shadrix Silverquill' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.MODE_SELECTION);
    expect((run.pendingChoice?.choiceEvent as any).minModes).toBe(2);
    expect((run.pendingChoice?.choiceEvent as any).maxModes).toBe(2);
    expect((run.pendingChoice?.choiceEvent as any).modes).toHaveLength(3);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['Mode 2', 'Mode 3'],
          cancelled: false,
          timestamp: 2,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'shadrix-1', sourceName: 'Shadrix Silverquill' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.PLAYER_CHOICE);
    expect((run.pendingChoice?.choiceEvent as any).validPlayers.map((player: any) => player.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['p1'],
          cancelled: false,
          timestamp: 3,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'shadrix-1', sourceName: 'Shadrix Silverquill' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.PLAYER_CHOICE);
    expect((run.pendingChoice?.choiceEvent as any).validPlayers.map((player: any) => player.id)).toEqual([
      'p2',
      'p3',
    ]);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['p2'],
          cancelled: false,
          timestamp: 4,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'shadrix-1', sourceName: 'Shadrix Silverquill' },
    );

    expect(run.status).toBe('completed');
    const p1 = run.state.players.find((player) => player.id === 'p1') as any;
    const p2 = run.state.players.find((player) => player.id === 'p2') as any;
    const p1Bear = (run.state.battlefield || []).find((permanent: any) => permanent.id === 'p1-bear') as any;
    const p2Elf = (run.state.battlefield || []).find((permanent: any) => permanent.id === 'p2-elf') as any;

    expect(p1.life).toBe(39);
    expect((p1.hand || []).map((card: any) => card.id)).toEqual(['lib-p1']);
    expect(p2.life).toBe(40);
    expect((p2.hand || []).length).toBe(0);
    expect(Number(p1Bear?.counters?.['+1/+1'] || 0)).toBe(0);
    expect(Number(p2Elf?.counters?.['+1/+1'] || 0)).toBe(1);
  });
});
