import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyChooseModeStep } from '../src/oracleIRExecutorChooseModeStepHandlers.js';
import type { GameState } from '../../shared/src/index.js';

describe('teamwork choose both', () => {
  const goNutsText =
    'Teamwork 3 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 3 or more.)\n' +
    'Choose one. If this spell was cast using teamwork, choose both instead.\n' +
    '• Draw three cards.\n' +
    '• Go Nuts! deals 3 damage to each opponent.';

  it('parses choose_mode with teamworkChooseBoth and default maxModes 1', () => {
    const ir = parseOracleTextToIR(goNutsText, 'Go Nuts!');
    const chooseMode = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'choose_mode');
    expect(chooseMode).toBeTruthy();
    expect((chooseMode as any).teamworkChooseBoth).toBe(true);
    expect((chooseMode as any).maxModes).toBe(1);
    expect((chooseMode as any).modes?.length).toBe(2);
  });

  it('allows two modes when teamworkWasPaid is true', () => {
    const ir = parseOracleTextToIR(goNutsText, 'Go Nuts!');
    const chooseMode = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'choose_mode') as any;
    const modes = chooseMode.modes || [];
    const selectedModeIds = modes.map((mode: any) => String(mode.label || ''));

    const applyNestedSteps = () => ({
      state: {} as GameState,
      log: [],
      appliedSteps: [],
      skippedSteps: [],
      automationGaps: [],
      pendingOptionalSteps: [],
    });

    const withoutTeamwork = applyChooseModeStep(
      {} as GameState,
      chooseMode,
      { controllerId: 'p1', teamworkWasPaid: false },
      { selectedModeIds: selectedModeIds.slice(0, 2) },
      applyNestedSteps as any,
    );
    expect(withoutTeamwork.kind).toBe('recorded_skip');
    expect((withoutTeamwork as any).reason).toBe('invalid_mode_selection');

    const withTeamwork = applyChooseModeStep(
      {} as GameState,
      chooseMode,
      { controllerId: 'p1', teamworkWasPaid: true },
      { selectedModeIds: selectedModeIds.slice(0, 2) },
      applyNestedSteps as any,
    );
    expect(withTeamwork.kind).toBe('applied');
  });
});
