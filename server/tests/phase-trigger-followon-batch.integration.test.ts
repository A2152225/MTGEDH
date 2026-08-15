import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getEndStepTriggers, getPostcombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';

function makeLibrary(prefix: string, count = 12) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_lib_${i}`,
    name: `${prefix} Card ${i}`,
    type_line: 'Instant',
    zone: 'library',
  }));
}

describe('phase trigger follow-on batch', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  it('emits Ashcoat and Crucible on your end step only', () => {
    const ashcoat = {
      id: 'ashcoat_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'ashcoat_card',
        name: 'Ashcoat of the Shadow Swarm',
        type_line: 'Legendary Creature — Rat Warlock',
        oracle_text:
          'At the beginning of your end step, you may mill four cards. If you do, return up to two Rat creature cards from your graveyard to your hand.',
      },
    };
    const crucible = {
      id: 'crucible_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'crucible_card',
        name: 'Wondrous Crucible',
        type_line: 'Artifact',
        oracle_text:
          'At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost.',
      },
    };
    const emitCtx = {
      state: {
        battlefield: [ashcoat, crucible],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getEndStepTriggers(emitCtx, 'p1').some((t) => t.permanentId === ashcoat.id)).toBe(true);
    expect(getEndStepTriggers(emitCtx, 'p2').some((t) => t.permanentId === ashcoat.id)).toBe(false);
    expect(getEndStepTriggers(emitCtx, 'p1').some((t) => t.permanentId === crucible.id)).toBe(true);
    expect(getEndStepTriggers(emitCtx, 'p2').some((t) => t.permanentId === crucible.id)).toBe(false);
  });

  it('emits Florian on your postcombat main only', () => {
    const florian = {
      id: 'florian_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'florian_card',
        name: 'Florian, Voldaren Scion',
        type_line: 'Legendary Creature — Vampire Wizard',
        oracle_text:
          'At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards and put the rest on the bottom of your library in a random order. You may play the exiled card this turn.',
      },
    };
    const emitCtx = {
      state: {
        battlefield: [florian],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getPostcombatMainTriggers(emitCtx, 'p1').some((t) => t.permanentId === florian.id)).toBe(true);
    expect(getPostcombatMainTriggers(emitCtx, 'p2').some((t) => t.permanentId === florian.id)).toBe(false);
  });

  it('Court of Cunning mills ten when the controller is the monarch', () => {
    const court = {
      id: 'court_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'court_card',
        name: 'Court of Cunning',
        type_line: 'Enchantment',
        oracle_text:
          "When this enchantment enters, you become the monarch.\nAt the beginning of your upkeep, any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead.",
      },
    };
    const emitCtx = {
      state: {
        battlefield: [court],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getUpkeepTriggersForPlayer(emitCtx, 'p1').some((t) => t.permanentId === court.id)).toBe(true);
    expect(getUpkeepTriggersForPlayer(emitCtx, 'p2').some((t) => t.permanentId === court.id)).toBe(false);

    const game = createInitialGameState('court_of_cunning_playcheck');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).monarch = p1;
    (game.state as any).zones = {
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p2'), libraryCount: 12 },
    };
    const ctx = game as any;
    ctx.libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(
      ctx,
      p1,
      'Court of Cunning',
      "any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead",
      {
        type: 'triggered_ability',
        controller: p1,
        triggerType: 'upkeep',
        targets: [p2],
        targetPlayer: p2,
      },
    );

    expect((game.state as any).zones[p2].graveyard).toHaveLength(10);
    expect(ctx.libraries.get(p2)).toHaveLength(2);
  });
});
