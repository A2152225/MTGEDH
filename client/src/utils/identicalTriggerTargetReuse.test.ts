import { afterEach, describe, expect, it } from 'vitest';
import {
  clearIdenticalTriggerTargetReuse,
  countIdenticalTriggersWaiting,
  identicalTriggerKeyForStep,
  rememberTargetForIdenticalTriggers,
  takeReusableTriggerTargets,
} from './identicalTriggerTargetReuse';

const warstormStep = (id: string) => ({
  id,
  type: 'target_selection',
  targetedTriggeredAbility: true,
  sourceName: 'Warstorm Surge',
  description: 'Warstorm Surge: Choose any target',
  targetDescription: 'any target',
});

describe('identicalTriggerTargetReuse', () => {
  afterEach(() => clearIdenticalTriggerTargetReuse());

  it('counts the other identical triggers you control on the stack', () => {
    const stack = [
      { id: 't1', type: 'triggered_ability', name: 'Warstorm Surge', controller: 'me' },
      { id: 't2', type: 'triggered_ability', name: 'Auriok Champion', controller: 'me' },
      { id: 't3', type: 'triggered_ability', name: 'Warstorm Surge', controller: 'me' },
      { id: 't4', type: 'triggered_ability', name: 'Warstorm Surge', controller: 'opp' },
      { id: 't5', type: 'triggered_ability', name: 'Warstorm Surge', controller: 'me' },
    ];
    expect(countIdenticalTriggersWaiting(stack, 'Warstorm Surge', 'me')).toBe(3);
    expect(countIdenticalTriggersWaiting(stack, 'Warstorm Surge', 'me', 't5')).toBe(2);
  });

  it('offers reuse with only two triggers: the resolving one is already off the stack', () => {
    const stack = [{ id: 't1', type: 'triggered_ability', sourceName: 'Warstorm Surge', controller: 'me' }];
    expect(countIdenticalTriggersWaiting(stack, 'Warstorm Surge', 'me', 't2')).toBe(1);
  });

  it('reuses the target for exactly the covered triggers, then stops', () => {
    const key = identicalTriggerKeyForStep(warstormStep('s1'))!;
    rememberTargetForIdenticalTriggers('g1', key, ['opp'], 2);
    expect(takeReusableTriggerTargets('g1', warstormStep('s2'), ['opp', 'bear'])).toEqual(['opp']);
    expect(takeReusableTriggerTargets('g1', warstormStep('s3'), ['opp', 'bear'])).toEqual(['opp']);
    expect(takeReusableTriggerTargets('g1', warstormStep('s4'), ['opp', 'bear'])).toBeNull();
  });

  it('asks again once the remembered target is no longer legal', () => {
    const key = identicalTriggerKeyForStep(warstormStep('s1'))!;
    rememberTargetForIdenticalTriggers('g1', key, ['wall'], 3);
    expect(takeReusableTriggerTargets('g1', warstormStep('s2'), ['opp'])).toBeNull();
    expect(takeReusableTriggerTargets('g1', warstormStep('s3'), ['opp', 'wall'])).toBeNull();
  });

  it('ignores different abilities and non-trigger target prompts', () => {
    const key = identicalTriggerKeyForStep(warstormStep('s1'))!;
    rememberTargetForIdenticalTriggers('g1', key, ['opp'], 3);
    expect(takeReusableTriggerTargets('g1', { ...warstormStep('x'), sourceName: 'Purphoros', description: 'Purphoros: Choose any target' }, ['opp'])).toBeNull();
    expect(identicalTriggerKeyForStep({ ...warstormStep('y'), targetedTriggeredAbility: undefined })).toBeUndefined();
    expect(takeReusableTriggerTargets('g1', warstormStep('s2'), ['opp'])).toEqual(['opp']);
  });
});
