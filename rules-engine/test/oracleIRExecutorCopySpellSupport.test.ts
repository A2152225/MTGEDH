import { describe, expect, it } from 'vitest';
import {
  getCopiedSpellReplaySteps,
  getCopiedStackObjectReplaySteps,
  resolveCopiedTargetSpellStackItem,
  resolveCopiedSpellSourceCards,
  resolveThisSpellCopyReplaySteps,
} from '../src/oracleIRExecutorCopySpellSupport';

describe('oracleIRExecutorCopySpellSupport', () => {
  it('parses replay steps from oracle text on card-like objects', () => {
    const steps = getCopiedSpellReplaySteps({
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    });
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(true);
  });

  it('resolves this-spell replay steps from audit copyReplaySteps context', () => {
    const replaySteps = [{ kind: 'destroy', raw: 'destroy target creature.' } as any];
    const resolved = resolveThisSpellCopyReplaySteps({
      steps: [{ kind: 'copy_spell', subject: 'this_spell', raw: 'copy this spell' } as any],
      stepIndex: 0,
      state: { stack: [] } as any,
      ctx: { controllerId: 'p1', copyReplaySteps: replaySteps } as any,
    });
    expect(resolved).toEqual(replaySteps);
  });

  it('resolves copied stack abilities for ability-copy steps', () => {
    const steps = getCopiedStackObjectReplaySteps(
      {
        id: 'stack-ability-1',
        type: 'ability',
        abilityText: 'Draw a card.',
      },
      { kind: 'copy_spell', subject: 'target_spell', target: { kind: 'raw', text: 'that ability' }, raw: 'copy that ability' } as any
    );
    expect(steps.some((step) => step.kind === 'draw')).toBe(true);
  });

  it('finds linked exiled instant cards for linked_exiled_cards copy steps', () => {
    const resolution = resolveCopiedSpellSourceCards({
      state: {
        players: [
          {
            id: 'p1',
            exile: [
              {
                id: 'exile-linked-spell-1',
                name: 'Lightning Bolt',
                type_line: 'Instant',
                oracle_text: 'Lightning Bolt deals 3 damage to any target.',
                exiledWith: 'bf-source',
              },
            ],
          },
        ],
      } as any,
      step: { kind: 'copy_spell', subject: 'linked_exiled_cards', raw: 'copy the exiled card' } as any,
      ctx: { controllerId: 'p1', sourceId: 'bf-source' } as any,
      lastMovedCards: [],
    });
    expect(resolution.cards?.length).toBe(1);
    expect(getCopiedSpellReplaySteps(resolution.cards?.[0]).length).toBeGreaterThan(0);
  });

  it('resolves this-spell replay from a following target_spell copy step', () => {
    const steps = [
      {
        kind: 'copy_spell',
        subject: 'this_spell',
        raw: 'copy it for each time you cast your commander from the command zone this game',
      },
      {
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'target instant or sorcery spell' },
        raw: 'copy target instant or sorcery spell',
      },
    ] as any[];
    const resolved = resolveThisSpellCopyReplaySteps({
      steps,
      stepIndex: 0,
      state: { stack: [] } as any,
      ctx: { controllerId: 'p1' } as any,
    });
    expect(resolved).toEqual([steps[1]]);
  });

  it('selects stack abilities when copying that ability', () => {
    const resolution = resolveCopiedTargetSpellStackItem({
      state: {
        stack: [
          {
            id: 'stack-ability-1',
            type: 'ability',
            controller: 'p1',
            abilityText: 'Draw a card.',
          },
        ],
      } as any,
      step: {
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'that ability' },
        raw: 'copy that ability',
      } as any,
      ctx: { controllerId: 'p1', targetSpellId: 'stack-ability-1' } as any,
    });
    expect(resolution.stackItem?.id).toBe('stack-ability-1');
  });
});
