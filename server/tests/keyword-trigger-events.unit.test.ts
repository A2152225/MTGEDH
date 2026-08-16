import { describe, expect, it } from 'vitest';

import {
  hasActivatedExhaustAbility,
  isExhaustAbilityText,
  markExhaustAbilityActivated,
  resetExhaustAbilityActivations,
} from '../src/state/modules/keywordActivationState.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if.js';
import {
  processDetectedAbilityActivatedTriggers,
  processDetectedFirebendingResolvedTriggers,
} from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { createInitialGameState } from '../src/state/index.js';

describe('keyword trigger event wiring', () => {
  it('tracks Exhaust independently by ability and resets it each turn', () => {
    const state: any = {};
    expect(isExhaustAbilityText('Exhaust — {2}, {T}: Draw a card. Activate only once.')).toBe(true);
    markExhaustAbilityActivated(state, 'source', 0);
    expect(hasActivatedExhaustAbility(state, 'source', 0)).toBe(true);
    expect(hasActivatedExhaustAbility(state, 'source', 1)).toBe(false);
    resetExhaustAbilityActivations(state);
    expect(hasActivatedExhaustAbility(state, 'source', 0)).toBe(false);
  });

  it('restores an Exhaust activation from its persisted ability index', () => {
    const game = createInitialGameState('keyword-exhaust-replay');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'exhaust-source',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Exhaust source', type_line: 'Artifact', oracle_text: 'Exhaust — {T}: Draw a card.' },
    }];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: 'p1',
      permanentId: 'exhaust-source',
      abilityId: 'exhaust-source-ability-0',
      activatedAbilityIndex: 0,
      exhaustAbility: true,
    } as any);

    expect(hasActivatedExhaustAbility(game.state, 'exhaust-source', 0)).toBe(true);
  });

  it('emits Oracle-detected Exhaust and Firebending observers without card-name routing', () => {
    const state: any = {
      battlefield: [
        {
          id: 'watcher',
          controller: 'p1',
          card: { name: 'Custom observer', oracle_text: 'Whenever you activate an exhaust ability, draw a card.' },
        },
        {
          id: 'fire-watcher',
          controller: 'p2',
          card: { name: 'Another custom observer', oracle_text: 'Whenever a player firebends, draw a card.' },
        },
        { id: 'source', controller: 'p1', card: { name: 'Source', oracle_text: '' } },
      ],
      stack: [],
    };
    const ctx: any = { state };
    processDetectedAbilityActivatedTriggers(ctx, {
      activatedBy: 'p1',
      sourcePermanentId: 'source',
      isManaAbility: false,
      isExhaustAbility: true,
    });
    processDetectedFirebendingResolvedTriggers(ctx, { playerId: 'p1', sourcePermanentId: 'source', amount: 2 });
    expect(state.stack).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'watcher', triggerType: 'ability_activated' }),
      expect.objectContaining({ source: 'fire-watcher', triggerType: 'firebending_resolved' }),
    ]));
  });

  it('detects Increment and evaluates cast mana at trigger and resolution time', () => {
    const source = {
      id: 'incrementer',
      controller: 'p1',
      basePower: 2,
      baseToughness: 4,
      card: { name: 'Incrementer', type_line: 'Creature — Human', oracle_text: 'Increment' },
    };
    const triggers = detectSpellCastTriggers(source.card, source);
    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ spellCondition: 'any', effect: 'Put a +1/+1 counter on this creature.' }),
    ]));

    const spell = { id: 'spell', manaSpentTotal: 5 };
    const ctx: any = { state: { battlefield: [source], stack: [spell] } };
    const text = "Whenever you cast a spell, if this permanent is a creature and the amount of mana spent to cast that spell is greater than this creature's power or this creature's toughness, put a +1/+1 counter on this creature.";
    expect(isInterveningIfSatisfied(ctx, 'p1', text, source, { triggeringStackItemId: 'spell' })).toBe(true);
    spell.manaSpentTotal = 2;
    expect(isInterveningIfSatisfied(ctx, 'p1', text, source, { triggeringStackItemId: 'spell' })).toBe(false);
  });
});
