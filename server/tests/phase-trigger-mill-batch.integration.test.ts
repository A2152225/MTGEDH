import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';

function makeLibrary(prefix: string, count = 8) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_lib_${i}`,
    name: `${prefix} Card ${i}`,
    type_line: 'Instant',
    zone: 'library',
  }));
}

describe('phase trigger mill batch', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  it('parses optional you-may mill and Florian look-top X', () => {
    const ashcoat = parseOracleTextToIR('You may mill four cards.', 'Ashcoat of the Shadow Swarm');
    const mill = ashcoat.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'mill');
    expect(mill).toMatchObject({
      kind: 'mill',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 4 },
      optional: true,
    });

    const florian = parseOracleTextToIR(
      'Look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards and put the rest on the bottom of your library in a random order.',
      'Florian, Voldaren Scion',
    );
    const look = florian.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'look_choose_from_top');
    expect(look).toBeTruthy();
    expect((look as any).amount?.kind).toBe('x');
    expect(String((look as any).raw || '')).toMatch(/life your opponents lost this turn/i);
    expect((look as any).destination).toBe('exile');

    const crucible = parseOracleTextToIR(
      'Mill two cards, then exile a nonland card at random from your graveyard.',
      'Wondrous Crucible',
    );
    const steps = crucible.abilities.flatMap((ability) => ability.steps);
    expect(steps.some((step) => step.kind === 'mill' && (step as any).amount?.value === 2)).toBe(true);
    expect(steps.some((step) => step.kind === 'exile' || step.kind === 'move_zone')).toBe(true);
  });

  it('Fraying Sanity mills the enchanted player for cards they put into the graveyard this turn', () => {
    const aura = {
      id: 'fraying_perm',
      controller: 'p1',
      owner: 'p1',
      attachedTo: 'p2',
      tapped: false,
      card: {
        id: 'fraying_card',
        name: 'Fraying Sanity',
        type_line: 'Enchantment — Aura Curse',
        oracle_text:
          'Enchant player\nAt the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      },
    };
    const emitCtx = {
      state: {
        battlefield: [aura],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getEndStepTriggers(emitCtx, 'p1').some((t) => t.permanentId === aura.id)).toBe(true);
    expect(getEndStepTriggers(emitCtx, 'p2').some((t) => t.permanentId === aura.id)).toBe(true);

    const game = createInitialGameState('fraying_sanity_playcheck');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).battlefield = [aura];
    (game.state as any).cardsPutIntoYourGraveyardThisTurn = { [p2]: 3 };
    (game.state as any).zones = {
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p2'), libraryCount: 8 },
    };
    const ctx = game as any;
    ctx.libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(
      ctx,
      p1,
      'Fraying Sanity',
      'enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn',
      {
        type: 'triggered_ability',
        controller: p1,
        source: aura.id,
        permanentId: aura.id,
        triggerType: 'end_step',
      },
    );

    expect((game.state as any).zones[p2].graveyard).toHaveLength(3);
    expect(ctx.libraries.get(p2)).toHaveLength(5);
  });

  it('Dreamborn Muse mills the active player for their hand size', () => {
    const muse = {
      id: 'muse_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'muse_card',
        name: 'Dreamborn Muse',
        type_line: 'Creature — Spirit',
        oracle_text:
          "At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.",
      },
    };
    const emitCtx = {
      state: {
        battlefield: [muse],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getUpkeepTriggersForPlayer(emitCtx, 'p2').some((t) => t.permanentId === muse.id)).toBe(true);

    const game = createInitialGameState('dreamborn_muse_playcheck');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).players = [
      { id: p1, name: 'P1', hand: [] },
      { id: p2, name: 'P2', hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }] },
    ];
    (game.state as any).zones = {
      [p2]: {
        hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
        handCount: 3,
        graveyard: [],
        graveyardCount: 0,
        library: makeLibrary('p2'),
        libraryCount: 8,
      },
    };
    const ctx = game as any;
    ctx.libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(
      ctx,
      p1,
      'Dreamborn Muse',
      'that player mills X cards, where X is the number of cards in their hand',
      {
        type: 'triggered_ability',
        controller: p1,
        triggerType: 'upkeep',
        triggeringPlayer: p2,
        targetPlayerId: p2,
      },
    );

    expect((game.state as any).zones[p2].graveyard).toHaveLength(3);
    expect(ctx.libraries.get(p2)).toHaveLength(5);
  });

  it('Terra mills two on your beginning of combat', () => {
    const terra = {
      id: 'terra_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'terra_card',
        name: 'Terra, Herald of Hope',
        type_line: 'Legendary Creature — Human Wizard Warrior',
        oracle_text: 'Trance — At the beginning of combat on your turn, mill two cards.',
      },
    };
    const emitCtx = {
      state: {
        battlefield: [terra],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getBeginningOfCombatTriggers(emitCtx, 'p1').some((t) => t.permanentId === terra.id)).toBe(true);
    expect(getBeginningOfCombatTriggers(emitCtx, 'p2').some((t) => t.permanentId === terra.id)).toBe(false);

    const game = createInitialGameState('terra_combat_mill_playcheck');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).players = [{ id: p1, name: 'P1' }];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p1'), libraryCount: 8 },
    };
    const ctx = game as any;
    ctx.libraries = new Map([[p1, [...(game.state as any).zones[p1].library]]]);

    executeTriggerEffect(ctx, p1, 'Terra, Herald of Hope', 'mill two cards', {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'beginning_of_combat',
    });

    expect((game.state as any).zones[p1].graveyard).toHaveLength(2);
    expect(ctx.libraries.get(p1)).toHaveLength(6);
  });
});
