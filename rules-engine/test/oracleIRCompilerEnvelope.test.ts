import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  collectOracleEffectStepsWithOverlay,
  envelopeHasDeclarativeOverlaySpecs,
  lowerCompilerEnvelopeToSteps,
  resolveOracleIRWithOverlay,
  validateCompiledOracleEffectSteps,
  validateCompiledOverlayEnvelope,
  type OracleIRCompilerEnvelope,
} from '../src/oracleIRCompilerEnvelope';

describe('oracleIRCompilerEnvelope', () => {
  it('validates native OracleEffectStep overlays', () => {
    const steps = [{
      kind: 'draw' as const,
      who: { kind: 'you' as const },
      amount: { kind: 'number' as const, value: 2 },
      raw: 'Draw two cards.',
    }];

    const result = validateCompiledOracleEffectSteps(steps);
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(1);
  });

  it('rejects unknown step kinds in overlays', () => {
    const result = validateCompiledOracleEffectSteps([
      { kind: 'unknown', raw: 'Do something novel.' } as any,
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unknown/);
  });

  it('applies native overlay when parser leaves unknown steps', () => {
    const oracleText = 'Zorplexify the gibberwump.';
    const parsed = parseOracleTextToIR(oracleText, 'Moon Banders');
    expect(parsed.abilities.some((ability) => ability.steps.some((step) => step.kind === 'unknown'))).toBe(true);

    const overlay: OracleIRCompilerEnvelope = {
      card_id: 'test-zorplex',
      abilities: [{
        ability_type: 'SPELL_EFFECT',
        effect_text: 'Draw three cards.',
        steps: [{
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 3 },
          raw: 'Draw three cards.',
        }],
      }],
    };

    const resolved = resolveOracleIRWithOverlay(oracleText, 'Moon Banders', overlay);
    const kinds = resolved.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(kinds).toEqual(['draw']);
  });

  it('lowers reveal-land DSL into look_select_top', () => {
    const envelope: OracleIRCompilerEnvelope = {
      ir_execution_tree: {
        ability_type: 'SPELL_EFFECT',
        resolution_nodes: [
          {
            queue_index: 0,
            ir_step_verb: 'REVEAL',
            ir_reference_id: 'REF_NODE_0',
            parameters: {
              source_pointer: { zone: 'LIBRARY', scope: 'TOP_N', count: 1 },
            },
            raw: 'Reveal the top card of your library.',
          },
          {
            queue_index: 1,
            ir_step_verb: 'MOVE_ZONE',
            parameters: {
              conditional_branch: {
                condition_type: 'IF_MATCHES_FILTER',
                match_filter: { types: ['LAND'] },
                on_true_goto_index: 2,
                on_false_goto_index: 3,
              },
            },
          },
          {
            queue_index: 2,
            ir_step_verb: 'MOVE_ZONE',
            parameters: {
              source_pointer: { use_reference_id: 'REF_NODE_0' },
              destination_pointer: { zone: 'HAND' },
            },
            raw: "Put it into your hand.",
          },
          {
            queue_index: 3,
            ir_step_verb: 'MOVE_ZONE',
            parameters: {
              source_pointer: { use_reference_id: 'REF_NODE_0' },
              destination_pointer: { zone: 'GRAVEYARD' },
            },
            raw: 'Put it into your graveyard.',
          },
        ],
      },
    };

    const steps = lowerCompilerEnvelopeToSteps(envelope);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('look_select_top');
  });

  it('collects steps through overlay resolver', () => {
    const overlay: OracleIRCompilerEnvelope = {
      abilities: [{
        ability_type: 'TRIGGERED',
        effect_text: 'Draw a card.',
        steps: [{
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        }],
      }],
    };

    const steps = collectOracleEffectStepsWithOverlay(
      'Whenever you cast a spell, draw a card.',
      'Novel Trigger Card',
      overlay,
      { preferOverlay: true }
    );
    expect(steps.map((step) => step.kind)).toEqual(['draw']);
  });

  it('validates STATIC overlays with static_specs and no executable steps', () => {
    const overlay: OracleIRCompilerEnvelope = {
      abilities: [{
        ability_type: 'STATIC',
        effect_text: 'Creatures you control get +1/+1.',
        steps: [],
        static_specs: [{
          id: 'creatures-plus-one',
          scope: { kind: 'creatures_you_control' },
          grant: { power: 1, toughness: 1 },
        }],
      }],
    };

    expect(envelopeHasDeclarativeOverlaySpecs(overlay)).toBe(true);
    expect(validateCompiledOverlayEnvelope(overlay).ok).toBe(true);
    expect(lowerCompilerEnvelopeToSteps(overlay)).toEqual([]);
  });

  it('applies declarative-only overlay abilities when parser is incomplete', () => {
    const oracleText = 'Creatures you control get +1/+1.';
    const parsed = parseOracleTextToIR(oracleText, 'Novel Anthem');
    const overlay: OracleIRCompilerEnvelope = {
      abilities: [{
        ability_type: 'STATIC',
        effect_text: oracleText,
        steps: [],
        static_specs: [{
          id: 'creatures-plus-one',
          scope: { kind: 'creatures_you_control' },
          grant: { power: 1, toughness: 1 },
        }],
      }],
    };

    const resolved = resolveOracleIRWithOverlay(oracleText, 'Novel Anthem', overlay);
    expect(resolved.abilities[0]?.type).toBe('static');
    expect(resolved.abilities[0]?.steps).toEqual([]);
  });
});
