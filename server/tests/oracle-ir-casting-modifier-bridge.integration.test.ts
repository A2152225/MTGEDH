import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  getDynamicBattlefieldCostReduction,
  spellHasChosenTypeFlashGrant,
  spellHasConvokeForCast,
  syncCastingModifierGrantsFromOracleIRResult,
} from '../src/state/modules/casting-modifiers.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { calculateConvokeOptions } from '../src/socket/game-actions.js';

describe('oracle IR casting modifier bridge', () => {
  const p1 = 'p1' as PlayerID;

  function setupGame() {
    const game = createInitialGameState('oracle_ir_casting_modifier_bridge');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).turnNumber = 4;
    (game.state as any).battlefield = [
      {
        id: 'wand_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'wand_card',
          name: 'Wand of the Worldsoul',
          type_line: 'Artifact — Equipment',
          oracle_text: '{T}: The next spell you cast this turn has convoke.',
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
      {
        id: 'sol_ring_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'sol_ring_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
        },
      },
    ];
    return game;
  }

  it('bridges Wand convoke grant from grant_static_ability IR steps', () => {
    const game = setupGame();
    const applied = syncCastingModifierGrantsFromOracleIRResult(
      game.state,
      p1,
      'Wand of the Worldsoul',
      {
        appliedSteps: [{
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'The next spell you cast this turn' },
          abilities: ['convoke'],
          duration: 'static',
          raw: 'The next spell you cast this turn has convoke',
        }],
      },
    );
    expect(applied).toBe(1);
    expect((game.state as any).convokeGrants?.length).toBeGreaterThan(0);

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
  });

  it('applyOracleIRStepsOnServer mirrors casting modifier grants after IR execution', () => {
    const game = setupGame();
    const steps = [{
      kind: 'grant_static_ability' as const,
      target: { kind: 'raw' as const, text: 'The next spell you cast this turn' },
      abilities: ['convoke'],
      duration: 'static' as const,
      raw: 'The next spell you cast this turn has convoke',
    }];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'wand_1',
      sourceName: 'Wand of the Worldsoul',
      sourceObjectType: 'ability',
    } as any, { sourceObjectType: 'ability' });

    applyOracleIRStepsOnServer(
      { state: game.state, gameId: 'oracle_ir_casting_modifier_bridge' } as any,
      game.state,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: p1 },
    );

    const divination = {
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
    };
    expect(spellHasConvokeForCast(game.state, p1, divination, 'hand')).toBe(true);
  });

  it('bridges next-spell affinity for artifacts from grant_static_ability IR steps', () => {
    const game = setupGame();
    const applied = syncCastingModifierGrantsFromOracleIRResult(
      game.state,
      p1,
      'Tezzeret, Cruel Captain',
      {
        appliedSteps: [{
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'The next spell you cast this turn' },
          abilities: ['affinity for artifacts'],
          duration: 'static',
          raw: 'The next spell you cast this turn has affinity for artifacts',
        }],
      },
    );
    expect(applied).toBe(1);

    const instant = {
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
    };
    const reduction = getDynamicBattlefieldCostReduction(game.state, p1, instant);
    expect(reduction.generic).toBe(2);
    expect(reduction.messages.join(' ')).toMatch(/affinity for artifacts/i);
  });

  it('bridges noncreature-only affinity grants from trigger IR text', () => {
    const game = setupGame();
    const applied = syncCastingModifierGrantsFromOracleIRResult(
      game.state,
      p1,
      'Don & Raph, Hard Science',
      {
        appliedSteps: [{
          kind: 'grant_static_ability',
          raw: 'The next noncreature spell you cast this turn has affinity for artifacts',
          target: { kind: 'raw', text: 'The next noncreature spell you cast this turn' },
          abilities: ['affinity for artifacts'],
          duration: 'static',
        }],
      },
    );
    expect(applied).toBe(1);

    const sorcery = {
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
    };
    const creature = {
      id: 'bear_spell_1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
    };

    expect(getDynamicBattlefieldCostReduction(game.state, p1, sorcery).generic).toBe(2);
    expect(getDynamicBattlefieldCostReduction(game.state, p1, creature).generic).toBe(0);
  });

  it('bridges chosen-type flash grants when trigger item carries source permanent', () => {
    const game = setupGame();
    (game.state as any).battlefield.push({
      id: 'icon_1',
      controller: p1,
      owner: p1,
      chosenCreatureType: 'Elf',
      card: {
        name: "Progenitor's Icon",
        type_line: 'Artifact',
        oracle_text:
          'As this artifact enters, choose a creature type.\n{T}: The next spell of the chosen type you cast this turn can be cast as though it had flash.',
      },
    });

    const applied = syncCastingModifierGrantsFromOracleIRResult(
      game.state,
      p1,
      "Progenitor's Icon",
      {
        appliedSteps: [{
          kind: 'grant_static_ability',
          raw: 'The next spell of the chosen type you cast this turn can be cast as though it had flash',
          target: { kind: 'raw', text: 'The next spell of the chosen type you cast this turn' },
          abilities: ['flash'],
          duration: 'static',
        }],
      },
      { source: 'icon_1' },
    );
    expect(applied).toBe(1);
    expect(spellHasChosenTypeFlashGrant(game.state, p1, {
      type_line: 'Creature — Elf Warrior',
    })).toBe(true);
    expect(spellHasChosenTypeFlashGrant(game.state, p1, {
      type_line: 'Creature — Goblin Scout',
    })).toBe(false);
  });
});
