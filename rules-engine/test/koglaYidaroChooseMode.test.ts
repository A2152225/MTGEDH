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

const KOGLA_ORACLE =
  'When Kogla and Yidaro enters, choose one —\n' +
  '\u2022 It gains trample and haste until end of turn.\n' +
  '\u2022 It fights target creature you don\'t control.\n' +
  '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.';

function collectEtbChooseModeStep(oracleText = KOGLA_ORACLE) {
  const ir = parseOracleTextToIR(oracleText, 'Kogla and Yidaro');
  const ability = ir.abilities.find((entry) =>
    /enters/i.test(String(entry.triggerCondition || entry.text || '')),
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
        library: [],
        hand: [],
        graveyard: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [],
        hand: [],
        graveyard: [],
      } as any,
    ],
    battlefield: [
      {
        id: 'kogla-1',
        controller: 'p1',
        owner: 'p1',
        card: {
          name: 'Kogla and Yidaro',
          type_line: 'Legendary Creature — Ape Dinosaur Turtle',
          oracle_text: KOGLA_ORACLE,
          power: 7,
          toughness: 6,
        },
        power: 7,
        toughness: 6,
        counters: {},
      },
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
    phase: 'main' as any,
    active: true,
  } as any;
}

describe('Kogla and Yidaro choose-one ETB', () => {
  it('parses the ETB as a choose_mode with a self-buff mode and a fight mode', () => {
    const { ability, step } = collectEtbChooseModeStep();

    expect(ability?.steps.filter((entry) => entry.kind === 'choose_mode')).toHaveLength(1);
    expect(step).toMatchObject({
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
    });
    expect(step.modes).toHaveLength(2);
    expect(step.modes[0].steps.map((inner: any) => inner.kind)).toEqual(['grant_temporary_ability']);
    expect(String(step.modes[0].steps[0].target?.text || '')).toMatch(/^it$/i);
    expect(step.modes[1].steps.map((inner: any) => inner.kind)).toEqual(['deal_damage']);
    expect(String(step.modes[1].steps[0].target?.text || '')).toMatch(/target creature you don['’]t control/i);
  });

  it('lowers choose_mode into mode selection before the fight target prompt', () => {
    const { step } = collectEtbChooseModeStep();
    const program = buildEffectProgramFromOracleIR({
      id: 'kogla',
      controllerId: 'p1',
      sourceId: 'kogla-1',
      sourceName: 'Kogla and Yidaro',
      steps: [step],
    });

    expect(program.steps.map((entry) => `${entry.kind}:${(entry as any).choiceRequest?.type || (entry as any).command?.kind || ''}`)).toEqual([
      'choice:mode_selection',
      'command:oracle_ir_step',
      'choice:target_selection',
      'command:oracle_ir_step',
    ]);
    expect((program.steps[0] as any).choiceRequest.payload).toMatchObject({
      minModes: 1,
      maxModes: 1,
    });
    expect((program.steps[0] as any).choiceRequest.payload.modes).toHaveLength(2);
  });

  it('prompts for a creature you do not control only after the fight mode is chosen', () => {
    const { step } = collectEtbChooseModeStep();
    const program = buildEffectProgramFromOracleIR({
      id: 'kogla',
      controllerId: 'p1',
      sourceId: 'kogla-1',
      sourceName: 'Kogla and Yidaro',
      steps: [step],
    });

    let run = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'kogla-1', sourceName: 'Kogla and Yidaro' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.MODE_SELECTION);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['Mode 2'],
          cancelled: false,
          timestamp: 1,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'kogla-1', sourceName: 'Kogla and Yidaro' },
    );
    expect(run.status).toBe('waiting_for_choice');
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.TARGET_SELECTION);
    expect((run.pendingChoice?.choiceEvent as any).validTargets.map((target: any) => target.id)).toEqual(['p2-elf']);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['p2-elf'],
          cancelled: false,
          timestamp: 2,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'kogla-1', sourceName: 'Kogla and Yidaro' },
    );
    expect(run.status).toBe('completed');
  });

  it('does not prompt for a creature target when the haste mode is chosen', () => {
    const { step } = collectEtbChooseModeStep();
    const program = buildEffectProgramFromOracleIR({
      id: 'kogla',
      controllerId: 'p1',
      sourceId: 'kogla-1',
      sourceName: 'Kogla and Yidaro',
      steps: [step],
    });

    let run = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'kogla-1', sourceName: 'Kogla and Yidaro' },
    );
    expect(run.pendingChoice?.choiceEvent.type).toBe(ChoiceEventType.MODE_SELECTION);

    run = runOracleEffectProgram(
      bindEffectProgramChoiceResponse(
        run.runtime,
        {
          eventId: run.pendingChoice!.choiceEvent.id,
          playerId: 'p1',
          selections: ['Mode 1'],
          cancelled: false,
          timestamp: 1,
        },
        run.pendingChoice!.step.bindingKey,
      ),
      { controllerId: 'p1', sourceId: 'kogla-1', sourceName: 'Kogla and Yidaro' },
    );
    expect(run.status).toBe('completed');
    expect(run.pendingChoice).toBeUndefined();
  });
});
