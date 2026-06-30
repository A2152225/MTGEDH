import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { hasConvokeAlternateCost, hasPayableAlternateCost } from '../src/state/modules/alternate-costs.js';
import {
  getDynamicBattlefieldCostReduction,
  getMiracleCastInfo,
  grantNextSpellConvoke,
  spellHasConvokeForCast,
  tryApplyCastingModifierGrantsFromText,
} from '../src/state/modules/casting-modifiers.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { calculateConvokeOptions } from '../src/socket/game-actions.js';

describe('casting modifiers integration', () => {
  const p1 = 'p1' as PlayerID;

  function setupGame() {
    const game = createInitialGameState('casting_modifiers_test');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).turnNumber = 4;
    (game.state as any).battlefield = [
      {
        id: 'island_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'island_card',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
      },
    ];
    return game;
  }

  it('grants convoke to the next spell via Wand-style ability text', () => {
    const game = setupGame();
    const applied = tryApplyCastingModifierGrantsFromText(
      game.state,
      p1,
      'The next spell you cast this turn has convoke.',
      'Wand of the Worldsoul',
    );
    expect(applied).toBe(true);

    const lightningBolt = {
      id: 'bolt_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    };

    expect(spellHasConvokeForCast(game.state, p1, lightningBolt, 'hand')).toBe(true);
    const convokeOptions = calculateConvokeOptions(game, p1, lightningBolt, 'hand');
    expect(convokeOptions.availableCreatures).toHaveLength(1);
    expect(convokeOptions.grantSources).toContain('Wand of the Worldsoul');

    const oneDrop = {
      id: 'one_drop_1',
      name: 'Consider',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Surveil 1.',
    };
    expect(hasConvokeAlternateCost({ state: game.state } as any, p1, oneDrop, undefined, 'hand')).toBe(true);
  });

  it('grants convoke to the first historic spell each turn from a static permanent', () => {
    const game = setupGame();
    (game.state as any).battlefield.push({
      id: 'peri_brown',
      controller: p1,
      owner: p1,
      card: {
        id: 'peri_card',
        name: 'Peri Brown',
        type_line: 'Legendary Creature — Human',
        oracle_text: 'The first historic spell you cast each turn has convoke.',
      },
    });

    const solRing = {
      id: 'sol_ring_1',
      name: 'Sol Ring',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text: '{T}: Add {C}{C}.',
    };

    expect(spellHasConvokeForCast(game.state, p1, solRing, 'hand')).toBe(true);

    (game.state as any).spellsCastThisTurn = [{
      casterId: p1,
      card: { type_line: 'Artifact', name: 'Already Cast' },
    }];
    expect(spellHasConvokeForCast(game.state, p1, solRing, 'hand')).toBe(false);
  });

  it('detects granted miracle on enchantments from Aminatou-style static text', () => {
    const game = setupGame();
    (game.state as any).battlefield.push({
      id: 'aminatou',
      controller: p1,
      owner: p1,
      card: {
        id: 'aminatou_card',
        name: 'Aminatou, Veil Piercer',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}.',
      },
    });

    const enchantment = {
      id: 'enchant_1',
      name: 'Oblivion Ring',
      type_line: 'Enchantment',
      mana_cost: '{2}{W}',
      oracle_text: 'When Oblivion Ring enters, exile another target nonland permanent.',
      isFirstDrawnThisTurn: true,
    };

    const miracleInfo = getMiracleCastInfo(game.state, p1, enchantment);
    expect(miracleInfo).toEqual(expect.objectContaining({
      hasMiracle: true,
      miracleCost: '{W}',
      source: 'granted',
      sourceName: 'Aminatou, Veil Piercer',
    }));
  });

  it('reduces creature spell costs by life gained this turn for Ezzaroot Channeler', () => {
    const game = setupGame();
    (game.state as any).lifeGainedThisTurn = { [p1]: 3 };
    (game.state as any).battlefield.push({
      id: 'ezzaroot',
      controller: p1,
      owner: p1,
      card: {
        id: 'ezzaroot_card',
        name: 'Ezzaroot Channeler',
        type_line: 'Creature — Treefolk Druid',
        oracle_text:
          'Creature spells you cast cost {X} less to cast, where X is the amount of life you gained this turn.',
      },
    });

    const creature = {
      id: 'creature_1',
      name: 'Elvish Mystic',
      type_line: 'Creature — Elf Druid',
      mana_cost: '{G}',
    };

    const reduction = getDynamicBattlefieldCostReduction(game.state, p1, creature);
    expect(reduction.generic).toBe(3);
    expect(reduction.messages.join(' ')).toMatch(/Ezzaroot Channeler/);
  });

  it('grants convoke only to noncreature spells cast from exile via Party Thrasher', () => {
    const game = setupGame();
    (game.state as any).battlefield.push({
      id: 'party_thrasher',
      controller: p1,
      owner: p1,
      card: {
        id: 'party_thrasher_card',
        name: 'Party Thrasher',
        type_line: 'Creature — Lizard Wizard',
        oracle_text:
          'Noncreature spells you cast from exile have convoke. (Each creature you tap while casting a noncreature spell from exile pays for {1} or one mana of that creature\'s color.)',
      },
    });

    const sorcery = {
      id: 'sorcery_exile_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text: 'Draw two cards.',
    };
    const creature = {
      id: 'creature_exile_1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
      colors: ['G'],
    };

    expect(spellHasConvokeForCast(game.state, p1, sorcery, 'exile')).toBe(true);
    expect(spellHasConvokeForCast(game.state, p1, creature, 'exile')).toBe(false);
    expect(spellHasConvokeForCast(game.state, p1, sorcery, 'hand')).toBe(false);
    expect(hasConvokeAlternateCost(game as any, p1, sorcery, undefined, 'exile')).toBe(true);
    expect(hasConvokeAlternateCost(game as any, p1, sorcery, undefined, 'hand')).toBe(false);
    expect(hasPayableAlternateCost(game as any, p1, sorcery, undefined, 'exile')).toBe(true);
    expect(hasPayableAlternateCost(game as any, p1, sorcery, undefined, 'hand')).toBe(false);

    const convokeOptions = calculateConvokeOptions(game, p1, sorcery, 'exile');
    expect(convokeOptions.grantSources).toContain('Party Thrasher');
    expect(convokeOptions.availableCreatures.length).toBeGreaterThan(0);
  });

  it('applies Wand convoke grant through executeTriggerEffect on activated abilities', () => {
    const game = setupGame();
    executeTriggerEffect(
      game as any,
      p1,
      'Wand of the Worldsoul',
      'The next spell you cast this turn has convoke.',
      {
        type: 'ability',
        controller: p1,
        activatedAbilityText: 'The next spell you cast this turn has convoke.',
      },
    );

    const divination = {
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text: 'Draw two cards.',
    };
    expect(spellHasConvokeForCast(game.state, p1, divination, 'hand')).toBe(true);
  });

  it('applies delayed affinity for artifacts to non-artifact spells', () => {
    const game = setupGame();
    (game.state as any).battlefield.push({
      id: 'sol_ring_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'sol_ring_card',
        name: 'Sol Ring',
        type_line: 'Artifact',
      },
    });
    tryApplyCastingModifierGrantsFromText(
      game.state,
      p1,
      'The next spell you cast this turn has affinity for artifacts.',
      'Tezzeret, Cruel Captain',
    );

    const instant = {
      id: 'consider_1',
      name: 'Consider',
      type_line: 'Instant',
      mana_cost: '{U}',
    };
    const reduction = getDynamicBattlefieldCostReduction(game.state, p1, instant);
    expect(reduction.generic).toBe(1);
  });
});
