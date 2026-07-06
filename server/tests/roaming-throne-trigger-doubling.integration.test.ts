import { describe, expect, it } from 'vitest';

import { resolveTriggerStackItemEffectText } from '../src/state/modules/triggerStackItemEffectText.js';
import {
  applyTriggerDoublers,
  detectTriggerDoublers,
  pushTriggerDoublerCopies,
} from '../src/state/modules/triggers/combat.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

describe('Roaming Throne trigger doubling', () => {
  const throneOracle =
    'Ward {2}\n' +
    'As this creature enters, choose a creature type.\n' +
    'This creature is the chosen type in addition to its other types.\n' +
    'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

  it('detects Roaming Throne doubler only when chosenCreatureType is set', () => {
    const withType = detectTriggerDoublers([{
      id: 'throne_1',
      controller: 'p1',
      chosenCreatureType: 'Merfolk',
      card: { name: 'Roaming Throne', oracle_text: throneOracle },
    }], 'p1');

    expect(withType).toHaveLength(1);
    expect(withType[0]).toMatchObject({
      cardName: 'Roaming Throne',
      creatureTypeFilter: 'Merfolk',
      affectsOthersOnly: true,
    });

    const withoutType = detectTriggerDoublers([{
      id: 'throne_1',
      controller: 'p1',
      card: { name: 'Roaming Throne', oracle_text: throneOracle },
    }], 'p1');

    expect(withoutType).toHaveLength(0);
  });

  it('does not double-queue a modal ETB trigger for choose-a-creature-type text', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Roaming Throne',
        type_line: 'Artifact Creature — Golem',
        oracle_text: throneOracle,
      },
      { id: 'throne_1', controller: 'p1' },
    );

    expect(triggers.some((trigger) => trigger.triggerType === 'etb_modal_choice')).toBe(false);
    expect(triggers.some((trigger) => String(trigger.effect || '').trim() === 'a creature type')).toBe(false);
  });

  it('doubles explore triggers from another Merfolk when Roaming Throne has chosen type', () => {
    const state: any = {
      battlefield: [
        {
          id: 'throne_1',
          controller: 'p1',
          chosenCreatureType: 'Merfolk',
          card: { name: 'Roaming Throne', oracle_text: throneOracle, type_line: 'Artifact Creature — Golem' },
        },
        {
          id: 'scout_1',
          controller: 'p1',
          card: {
            name: 'Merfolk Scout',
            type_line: 'Creature — Merfolk Scout',
            oracle_text: 'Whenever this creature explores, draw a card.',
          },
        },
      ],
      stack: [],
    };

    const stackItem = {
      id: 'trigger_scout_explore',
      type: 'triggered_ability',
      controller: 'p1',
      permanentId: 'scout_1',
      source: 'scout_1',
      sourceName: 'Merfolk Scout',
      description: 'Whenever this creature explores, draw a card.',
      effect: 'draw a card',
      triggerType: 'explore',
      mandatory: true,
    };

    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);

    expect(state.stack).toHaveLength(2);
    expect(state.stack[1]).toMatchObject({
      isDoubledTriggerCopy: true,
      effect: 'draw a card',
      permanentId: 'scout_1',
    });
    expect(String(state.stack[1].description || '')).toContain('doubled by Roaming Throne');
  });

  it('does not double triggers from Roaming Throne itself', () => {
    const state: any = {
      battlefield: [{
        id: 'throne_1',
        controller: 'p1',
        chosenCreatureType: 'Golem',
        card: { name: 'Roaming Throne', oracle_text: throneOracle, type_line: 'Artifact Creature — Golem' },
      }],
      stack: [],
    };

    const stackItem = {
      id: 'trigger_throne_etb',
      type: 'triggered_ability',
      controller: 'p1',
      permanentId: 'throne_1',
      source: 'throne_1',
      sourceName: 'Roaming Throne',
      description: 'Choose a creature type.',
      effect: 'choose a creature type',
      triggerType: 'etb',
      mandatory: true,
    };

    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);

    expect(state.stack).toHaveLength(1);
  });

  it('does not double when source creature type does not match throne chosen type', () => {
    const state: any = {
      battlefield: [
        {
          id: 'throne_1',
          controller: 'p1',
          chosenCreatureType: 'Merfolk',
          card: { name: 'Roaming Throne', oracle_text: throneOracle },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: 'Whenever this creature explores, draw a card.',
          },
        },
      ],
      stack: [],
    };

    const stackItem = {
      id: 'trigger_bear_explore',
      type: 'triggered_ability',
      controller: 'p1',
      permanentId: 'bear_1',
      source: 'bear_1',
      sourceName: 'Grizzly Bears',
      description: 'Whenever this creature explores, draw a card.',
      effect: 'draw a card',
      triggerType: 'explore',
      mandatory: true,
    };

    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);

    expect(state.stack).toHaveLength(1);
  });

  it('preserves clean effect text on doubled attack triggers (Myrel + throne)', () => {
    const myrelEffect =
      'Create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control';
    const throne = {
      id: 'throne_1',
      controller: 'p1',
      chosenCreatureType: 'Human',
      card: { name: 'Roaming Throne', oracle_text: throneOracle, type_line: 'Artifact Creature — Golem' },
    };
    const myrel = {
      id: 'myrel_1',
      controller: 'p1',
      card: {
        name: 'Myrel, Shield of Argive',
        type_line: 'Legendary Creature — Human Soldier',
        oracle_text:
          "Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.",
      },
    };

    const doublers = detectTriggerDoublers([throne], 'p1');
    const doubled = applyTriggerDoublers(
      [{
        permanentId: 'myrel_1',
        cardName: 'Myrel, Shield of Argive',
        controllerId: 'p1',
        description: myrelEffect,
        effect: myrelEffect,
        triggerType: 'attacks',
        mandatory: true,
      }],
      doublers,
      'attack',
      myrel,
    );

    expect(doubled).toHaveLength(2);
    expect(String(doubled[1]?.description || '')).toContain('doubled by Roaming Throne');
    expect(doubled[1]?.effect).toBe(myrelEffect);

    const resolved = resolveTriggerStackItemEffectText({
      description: doubled[1]?.description,
      effect: doubled[1]?.effect,
      sourceName: 'Myrel, Shield of Argive',
      permanentId: 'myrel_1',
    });
    expect(resolved).toBe(myrelEffect);
    expect(resolved).not.toContain('doubled by');
  });
});
