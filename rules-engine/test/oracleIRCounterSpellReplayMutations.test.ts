import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function counterState(stack: any[]): GameState {
  return {
    id: 'counter-replay',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    stack,
    battlefield: [],
  } as GameState;
}

describe('counter spell replay mutations', () => {
  it('records a graveyard mutation when a spell is countered', () => {
    const steps = parseOracleTextToIR('Counter target spell.', 'Counterspell').abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(
      counterState([{
        id: 'spell-1',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'spell-card-1', name: 'Cultivate', type_line: 'Sorcery' },
      }]),
      steps,
      { controllerId: 'p1', sourceName: 'Counterspell' },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['counter_spell']);
    expect(result.replayMutations).toEqual([
      expect.objectContaining({
        kind: 'counterStackObject',
        stackItemId: 'spell-1',
        ownerId: 'p2',
        destination: 'graveyard',
        wasSpell: true,
      }),
    ]);
    expect((result.replayMutations?.[0] as any)?.card?.id).toBe('spell-card-1');
  });

  it('records a cease mutation when an activated ability is countered', () => {
    const steps = parseOracleTextToIR('Counter target activated ability.', 'Stifle').abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(
      counterState([{
        id: 'ability-1',
        type: 'activated_ability',
        controller: 'p2',
        description: '{T}: Draw a card.',
      }]),
      steps,
      { controllerId: 'p1', sourceName: 'Stifle', targetSpellId: 'ability-1' },
    );

    expect(result.state.stack).toEqual([]);
    expect(result.replayMutations).toEqual([
      expect.objectContaining({
        kind: 'counterStackObject',
        stackItemId: 'ability-1',
        destination: 'cease',
        wasSpell: false,
      }),
    ]);
  });

  it('records an exile mutation when the counter step exiles the spell', () => {
    const steps = parseOracleTextToIR('Exile all other spells.', 'Summary Dismissal').abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(
      counterState([{
        id: 'spell-1',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'spell-card-1', name: 'Cultivate', type_line: 'Sorcery' },
      }]),
      steps,
      { controllerId: 'p1', sourceId: 'dismissal', sourceName: 'Summary Dismissal' },
    );

    expect(result.replayMutations).toEqual([
      expect.objectContaining({
        kind: 'counterStackObject',
        stackItemId: 'spell-1',
        destination: 'exile',
        wasSpell: true,
      }),
    ]);
    const owner = result.state.players.find((player) => player.id === 'p2') as any;
    expect((owner?.exile || []).map((card: any) => card.id)).toEqual(['spell-card-1']);
  });
});
