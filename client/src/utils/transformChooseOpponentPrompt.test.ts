import { describe, expect, it } from 'vitest';
import {
  isTransformChooseOpponentTargetStep,
  toTransformChooseOpponentPlayerPrompt,
} from './transformChooseOpponentPrompt';

const step = {
  id: 's1',
  type: 'target_selection',
  transformChooseOpponent: true,
  sourceName: 'Shinryu, Transcendent Rival',
  sourceImage: 'https://example/shinryu.jpg',
  description: 'As Shinryu, Transcendent Rival transforms, choose an opponent.',
  targetTypes: ['player'],
  validTargets: [
    { id: 'p2', label: 'Nia', description: 'Opponent', type: 'player' },
    { id: 'p3', label: 'Ori', description: 'Opponent', type: 'player' },
  ],
};

describe('transformChooseOpponent player picker', () => {
  it('recognizes the Shinryu/Zenos TARGET_SELECTION step', () => {
    expect(isTransformChooseOpponentTargetStep(step)).toBe(true);
    expect(isTransformChooseOpponentTargetStep({ type: 'target_selection', validTargets: step.validTargets })).toBe(false);
  });

  it('maps opponents onto the existing PlayerTargetSelectionModal shape', () => {
    const prompt = toTransformChooseOpponentPlayerPrompt(step, { life: { p2: 31, p3: 28 } });
    expect(prompt).toEqual(expect.objectContaining({
      stepId: 's1',
      title: 'Shinryu, Transcendent Rival',
      opponentOnly: true,
      isOptional: false,
    }));
    expect(prompt?.players).toEqual([
      { id: 'p2', name: 'Nia', isSelf: false, isOpponent: true, life: 31 },
      { id: 'p3', name: 'Ori', isSelf: false, isOpponent: true, life: 28 },
    ]);
  });
});
