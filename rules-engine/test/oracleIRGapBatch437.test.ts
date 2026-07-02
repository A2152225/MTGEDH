import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyCopyPermanentStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyExileStep, applyDestroyStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const controllerId = 'p1';

describe('E2 target gap batch 437', () => {
  it('exiles one creature other than enchanted host then copies onto enchanted creature', () => {
    const ir = parseOracleTextToIR(
      'Enchant creature you control\nWhen this Aura enters, exile up to one target creature other than enchanted creature until this Aura leaves the battlefield. Enchanted creature becomes a copy of that creature until this Aura leaves the battlefield.',
      'Secret Invasion',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps).filter((step) => step.kind !== 'unknown');
    const state = {
      players: [{ id: controllerId }],
      battlefield: [
        {
          id: 'aura-1',
          controller: controllerId,
          attachedTo: 'host-1',
          card: { name: 'Secret Invasion', type_line: 'Enchantment — Aura' },
        },
        {
          id: 'host-1',
          controller: controllerId,
          name: 'Enchanted Bear',
          type_line: 'Creature — Bear',
          card: { name: 'Enchanted Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'copy-ref',
          controller: 'p2',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      {
        controllerId,
        sourceId: 'aura-1',
        targetPermanentId: 'copy-ref',
        selectorContext: { chosenObjectIds: ['copy-ref', 'host-1'] },
      } as any,
      { allowOptional: true },
    );

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['exile', 'copy_permanent']);
    const host = (result.state?.battlefield || []).find((perm: any) => perm.id === 'host-1');
    expect(String((host as any)?.name || '')).toBe('Runeclaw Bear');
  });

  it('copies this permanent from a bound battlefield creature or graveyard card', () => {
    const ir = parseOracleTextToIR(
      "Until your next turn, this permanent becomes a copy of up to one target creature on the battlefield or creature card in a graveyard, except his name is this permanent and he's a legendary Human Mercenary Villain creature.",
      'Taskmaster, Mercenary Mimic',
    );
    const step = ir.abilities[0]?.steps[0];
    expect(step?.kind).toBe('copy_permanent');

    const state = {
      players: [
        {
          id: controllerId,
          graveyard: [
            { id: 'gy-elf', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
          ],
        },
      ],
      battlefield: [
        {
          id: 'taskmaster',
          controller: controllerId,
          name: 'Taskmaster, Mercenary Mimic',
          type_line: 'Legendary Creature — Human Mercenary Villain',
          card: { name: 'Taskmaster, Mercenary Mimic', type_line: 'Legendary Creature — Human Mercenary Villain' },
        },
        {
          id: 'bf-ref',
          controller: controllerId,
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    } as GameState;

    const result = applyCopyPermanentStep(
      state,
      step as any,
      {
        controllerId,
        sourceId: 'taskmaster',
        selectorContext: { chosenObjectIds: ['bf-ref'] },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    const self = (result.state?.battlefield || []).find((perm: any) => perm.id === 'taskmaster');
    expect(String((self as any)?.name || '')).toBe('Grizzly Bears');
  });

  it('exiles any number of other target permanents you control', () => {
    const state = {
      players: [{ id: controllerId }],
      battlefield: [
        { id: 'surfer', controller: controllerId, type_line: 'Legendary Creature — Human' },
        { id: 'bear', controller: controllerId, type_line: 'Creature — Bear' },
        { id: 'rock', controller: controllerId, type_line: 'Artifact' },
      ],
    } as GameState;

    const result = applyExileStep(
      state,
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'any number of other target permanents you control' },
        raw: 'exile any number of other target permanents you control',
      } as any,
      {
        controllerId,
        sourceId: 'surfer',
        selectorContext: { chosenObjectIds: ['bear', 'rock'] },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect((result.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['surfer']);
  });

  it('destroys a tapped nonland permanent that player controls', () => {
    const state = {
      players: [{ id: controllerId }, { id: 'p2' }],
      battlefield: [
        {
          id: 'spear',
          controller: controllerId,
          type_line: 'Artifact — Equipment',
        },
        {
          id: 'tapped-rock',
          controller: 'p2',
          tapped: true,
          type_line: 'Artifact',
        },
      ],
    } as GameState;

    const result = applyDestroyStep(
      state,
      {
        kind: 'destroy',
        target: { kind: 'raw', text: 'target tapped nonland permanent that player controls' },
        raw: 'destroy target tapped nonland permanent that player controls',
      } as any,
      {
        controllerId,
        sourceId: 'spear',
        selectorContext: { targetPlayerId: 'p2', chosenObjectIds: ['tapped-rock'] },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect((result.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['spear']);
  });
});
