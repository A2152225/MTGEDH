import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport.js';
import { parseMoveZoneUpToThatManyFromTheirGraveyard } from '../src/oracleIRExecutorZoneOps.js';
import type { GameState } from '../../shared/src/index.js';
import { requireCorpusCard } from './helpers/cardCorpus.js';

describe('oracle IR gap batch 45', () => {
  it('repairs magus sisters random saga into choose_mode', async () => {
    const card = await requireCorpusCard('Summon: Magus Sisters');
    const ir = parseOracleTextToIR(String(card.oracle_text || ''), card.name);
    const ability = ir.abilities.find((a) => /choose one at random/i.test(String(a.effectText || a.text || '')));
    expect(ability?.steps.some((s) => s.kind === 'unknown')).toBe(false);
    const chooseMode = ability?.steps.find((s) => s.kind === 'choose_mode') as any;
    expect(chooseMode?.modes?.length).toBe(3);
    expect(chooseMode.modes[1].steps.some((s: any) => s.kind === 'add_counter' && s.counter === 'shield')).toBe(true);
  });

  it('parses froghemoth up-to-that-many opponent graveyard exile', () => {
    const text =
      "Whenever this creature deals combat damage to a player, exile up to that many target cards from their graveyard. Put a +1/+1 counter on this creature for each creature card exiled this way. You gain 1 life for each noncreature card exiled this way.";
    const ir = parseOracleTextToIR(text, 'Froghemoth');
    const move = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'move_zone') as any;
    expect(
      parseMoveZoneUpToThatManyFromTheirGraveyard({ kind: 'raw', text: move.what.text })
    ).toEqual({ maxCount: 0, criteria: { cardType: 'any' }, useReferenceAmount: true });
    const addCounter = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'add_counter') as any;
    expect(addCounter?.target?.text).toBe('this creature');
  });

  it('evaluates brain pry they cant condition after failed discard', () => {
    const evaluation = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "they can't" },
      nextState: { players: [], battlefield: [] } as unknown as GameState,
      controllerId: 'p1',
      ctx: { controllerId: 'p1' },
      lastActionOutcome: { kind: 'impossible', stepKind: 'discard' },
      lastConditionalEvaluation: null,
    });
    expect(evaluation).toBe(true);
  });

  it('merges jaya emblem quoted ability without orphan conditional exile', () => {
    const text =
      'You get an emblem with "You may cast instant and sorcery spells from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead."';
    const ir = parseOracleTextToIR(text, 'Jaya Ballard');
    const steps = ir.abilities.flatMap((a) => a.steps);
    expect(steps.some((s) => s.kind === 'conditional')).toBe(false);
    const emblem = steps.find((s) => s.kind === 'create_emblem') as any;
    expect(emblem?.abilities?.[0]).toMatch(/exile it instead/i);
  });

  it('collectStepsFromIrText preserves magus sisters random saga choose_mode', async () => {
    const { collectStepsFromIrText } = await import('../../server/scripts/executor-coverage-audit.ts');
    const text =
      'I, II, III — Choose one at random —\n• Combine Powers! — Put three +1/+1 counters on target creature.\n• Defense! — Put a shield counter on target creature. You gain 3 life.\n• Fight! — This creature fights up to one target creature an opponent controls.';
    const steps = collectStepsFromIrText(text, 'Summon: Magus Sisters');
    const chooseMode = steps.find((s) => s.kind === 'choose_mode') as any;
    expect(chooseMode?.modes?.length).toBe(3);
    expect(steps.some((s) => s.kind === 'unknown')).toBe(false);
  }, 30000);

  it('executes brain pry they cant branch when named discard is impossible', async () => {
    const { collectStepsFromIrText, dryRunOracleSteps } = await import('../../server/scripts/executor-coverage-audit.ts');
    const { hasUnknownIRSteps, loadEffectIrParser } = await import('../../server/scripts/trigger-coverage-audit.ts');
    await loadEffectIrParser();
    const text =
      "Choose a nonland card name. Target player reveals their hand. That player discards a card with that name. If they can't, you draw a card.";
    const steps = collectStepsFromIrText(text, 'Brain Pry');
    const irGaps = hasUnknownIRSteps(text, 'Brain Pry');
    const record = dryRunOracleSteps(steps, 'Brain Pry', irGaps, { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  }, 30000);

  it('applies pharika escape counter metadata without granted graveyard cards', () => {
    const text =
      'This creature escapes with two +1/+1 counters on it. When it enters this way, each opponent sacrifices a non-Gorgon creature of their choice.';
    const ir = parseOracleTextToIR(text, "Pharika's Spawn");
    const modify = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'modify_graveyard_permissions') as any;
    expect(modify?.castedPermanentEntersWithCounters).toEqual({ '+1/+1': 2 });
  });
});
