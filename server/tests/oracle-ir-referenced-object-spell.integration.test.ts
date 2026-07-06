import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../../rules-engine/src/oracleIrTargetBinding.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const MANA_LEAK_TEXT = 'Counter target spell unless its controller pays {3}.';
const BEAST_WITHIN_TEXT =
  'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.';
const DESCENT_OF_THE_DRAGONS_TEXT =
  'Destroy any number of target creatures. For each creature destroyed this way, its controller creates a 4/4 red Dragon creature token with flying.';
const COUNTERBORE_TEXT =
  "Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them.";
const POSSESSIVE_LIBRARY_TOP_TEXT =
  "Exile target creature. Exile the top card of its controller's library.";

function joinFourPlayers(game: ReturnType<typeof createInitialGameState>) {
  const ids = ['p_caster', 'p_victim', 'p_other1', 'p_other2'] as const;
  for (const [index, id] of ids.entries()) {
    game.applyEvent!({ type: 'join', playerId: id, name: id } as any);
    const player = (game.state as any).players.find((entry: any) => entry.id === id);
    if (player) player.seat = index;
  }
  return ids;
}

function seedServerPlayerZones(
  game: ReturnType<typeof createInitialGameState>,
  playerId: PlayerID,
  zones: {
    hand?: any[];
    graveyard?: any[];
    library?: any[];
    exile?: any[];
  },
) {
  const state = game.state as any;
  state.zones = state.zones || {};
  const hand = zones.hand ?? [];
  const graveyard = zones.graveyard ?? [];
  const library = zones.library ?? [];
  const exile = zones.exile ?? [];
  state.zones[playerId] = {
    ...(state.zones[playerId] || {}),
    hand: hand.map((card) => ({ ...card })),
    handCount: hand.length,
    graveyard: graveyard.map((card) => ({ ...card })),
    graveyardCount: graveyard.length,
    exile: exile.map((card) => ({ ...card })),
    exileCount: exile.length,
    libraryCount: library.length,
  };
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(playerId, library.map((card) => ({ ...card })));
}

describe('oracle IR referenced-object spell integration', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('queues unless-pay for the targeted spell controller in a four-player game', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_mana_leak_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim] = joinFourPlayers(game);

    (game.state as any).manaPool = {
      [pVictim]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 },
    };
    (game.state as any).stack = [
      {
        id: 'spell-victim',
        type: 'spell',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'cultivate-card', name: 'Cultivate', type_line: 'Sorcery' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: 'Mana Leak',
      oracleText: MANA_LEAK_TEXT,
      sourceId: 'mana-leak-stack',
      targets: ['spell-victim'],
    });

    expect(outcome.handled).toBe(true);

    const victimSteps = ResolutionQueueManager.getStepsForPlayer(gameId, pVictim);
    const unlessPayStep = victimSteps.find((step) => (step as any)?.oracleIrUnlessPayChoice === true);

    expect(unlessPayStep).toBeTruthy();
    expect((unlessPayStep as any)?.optionalPaymentManaCost).toBe('{3}');
    expect((unlessPayStep as any)?.oracleIrTargetSpellId).toBe('spell-victim');
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, pCaster)).toHaveLength(0);
  });

  it('creates Beast Within token for targeted permanent controller via tryResolveSpellViaOracleIR', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_beast_within_spell_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim] = joinFourPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: pVictim,
        owner: pVictim,
        card: {
          id: 'card1',
          name: 'My Creature',
          type_line: 'Creature',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: 'Beast Within',
      oracleText: BEAST_WITHIN_TEXT,
      sourceId: 'beast-within-stack',
      targets: ['perm_creature'],
    });

    expect(outcome.handled).toBe(true);
    expect(
      ((game.state as any).battlefield || []).some(
        (perm: any) => perm.controller === pVictim && String(perm.card?.name || '').includes('Beast'),
      ),
    ).toBe(true);
    expect(
      ((game.state as any).battlefield || []).some((perm: any) => perm.id === 'perm_creature'),
    ).toBe(false);
  });

  it('creates Beast Within token for targeted permanent controller via applyOracleIRStepsOnServer', () => {
    const gameId = 'oracle_ir_beast_within_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim] = joinFourPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: pVictim,
        owner: pVictim,
        card: {
          id: 'card1',
          name: 'My Creature',
          type_line: 'Creature',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(BEAST_WITHIN_TEXT, 'Beast Within').abilities[0]?.steps ?? [];
    const targetBinding = inferOracleIrTargetBinding((game.state as any), ['perm_creature'], pCaster);
    const baseCtx = oracleIrTargetBindingToBaseContext(targetBinding);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: pCaster,
        sourceId: 'beast-within-stack',
        sourceName: 'Beast Within',
        sourceObjectType: 'spell',
        ...baseCtx,
        selectorContext: baseCtx.selectorContext,
      },
      {
        ...oracleIrTargetBindingToEventHint(targetBinding),
        sourceObjectType: 'spell',
      },
    );

    const result = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: pCaster },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['destroy', 'create_token']);
    expect(
      ((game.state as any).battlefield || []).some(
        (perm: any) => perm.controller === pVictim && String(perm.card?.name || '').includes('Beast'),
      ),
    ).toBe(true);
    expect(
      ((game.state as any).battlefield || []).some((perm: any) => perm.id === 'perm_creature'),
    ).toBe(false);
  });

  it('creates one Dragon per destroyed creature controller via tryResolveSpellViaOracleIR', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_descent_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim, pOther1] = joinFourPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'perm_v1',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'c1', name: 'Victim Creature 1', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: 'perm_v2',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'c2', name: 'Victim Creature 2', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: 'perm_o1',
        controller: pOther1,
        owner: pOther1,
        card: { id: 'c3', name: 'Other Creature', type_line: 'Creature', power: '2', toughness: '2' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: 'Descent of the Dragons',
      oracleText: DESCENT_OF_THE_DRAGONS_TEXT,
      sourceId: 'descent-stack',
      targets: ['perm_v1', 'perm_v2', 'perm_o1'],
    });

    expect(outcome.handled).toBe(true);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((perm: any) => perm.id === 'perm_v1')).toBe(false);
    expect(battlefield.some((perm: any) => perm.id === 'perm_v2')).toBe(false);
    expect(battlefield.some((perm: any) => perm.id === 'perm_o1')).toBe(false);

    const dragons = battlefield.filter((perm: any) => String(perm.card?.name || '').includes('Dragon'));
    expect(dragons).toHaveLength(3);
    expect(dragons.filter((perm: any) => perm.controller === pVictim)).toHaveLength(2);
    expect(dragons.filter((perm: any) => perm.controller === pOther1)).toHaveLength(1);
  });

  it('creates one Dragon per destroyed creature controller via applyOracleIRStepsOnServer', () => {
    const gameId = 'oracle_ir_descent_apply_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim, pOther1] = joinFourPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'perm_v1',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'c1', name: 'Victim Creature 1', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: 'perm_v2',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'c2', name: 'Victim Creature 2', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: 'perm_o1',
        controller: pOther1,
        owner: pOther1,
        card: { id: 'c3', name: 'Other Creature', type_line: 'Creature', power: '2', toughness: '2' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps =
      parseOracleTextToIR(DESCENT_OF_THE_DRAGONS_TEXT, 'Descent of the Dragons').abilities[0]?.steps ?? [];
    const targetBinding = inferOracleIrTargetBinding(
      game.state as any,
      ['perm_v1', 'perm_v2', 'perm_o1'],
      pCaster,
    );
    const baseCtx = oracleIrTargetBindingToBaseContext(targetBinding);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: pCaster,
        sourceId: 'descent-stack',
        sourceName: 'Descent of the Dragons',
        sourceObjectType: 'spell',
        ...baseCtx,
        selectorContext: baseCtx.selectorContext,
      },
      {
        ...oracleIrTargetBindingToEventHint(targetBinding),
        sourceObjectType: 'spell',
      },
    );

    const result = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: pCaster },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['destroy', 'create_token']);

    const battlefield = (game.state as any).battlefield || [];
    const dragons = battlefield.filter((perm: any) => String(perm.card?.name || '').includes('Dragon'));
    expect(dragons).toHaveLength(3);
    expect(dragons.filter((perm: any) => perm.controller === pVictim)).toHaveLength(2);
    expect(dragons.filter((perm: any) => perm.controller === pOther1)).toHaveLength(1);
  });

  it('exiles same-named cards from its controller zones via tryResolveSpellViaOracleIR', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_counterbore_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim] = joinFourPlayers(game);

    (game.state as any).stack = [
      {
        id: 'spell-victim',
        type: 'spell',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'cultivate-card', name: 'Cultivate', type_line: 'Sorcery' },
      },
    ];
    const victim = (game.state as any).players.find((entry: any) => entry.id === pVictim);
    seedServerPlayerZones(game, pVictim, {
      hand: [{ id: 'h1', name: 'Cultivate', type_line: 'Sorcery' }],
      graveyard: [{ id: 'g1', name: 'Cultivate', type_line: 'Sorcery' }],
      library: [
        { id: 'l1', name: 'Island', type_line: 'Land' },
        { id: 'l2', name: 'Cultivate', type_line: 'Sorcery' },
      ],
    });

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: 'Counterbore',
      oracleText: COUNTERBORE_TEXT,
      sourceId: 'counterbore-stack',
      targets: ['spell-victim'],
    });

    expect(outcome.handled).toBe(true);
    const victimAfter = (game.state as any).players.find((entry: any) => entry.id === pVictim);
    expect(victimAfter.hand).toHaveLength(0);
    expect(victimAfter.graveyard).toHaveLength(0);
    expect(victimAfter.library.map((card: any) => card.id)).toEqual(['l1']);
    expect(victimAfter.exile.map((card: any) => card.name)).toEqual(['Cultivate', 'Cultivate', 'Cultivate']);
  });

  it('exiles the top card of its controller library after a targeted creature exile via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_possessive_library_top_4p';
    const game = createInitialGameState(gameId);
    const [pCaster, pVictim] = joinFourPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: pVictim,
        owner: pVictim,
        card: { id: 'card1', name: 'Victim Creature', type_line: 'Creature' },
      },
    ];
    const victim = (game.state as any).players.find((entry: any) => entry.id === pVictim);
    seedServerPlayerZones(game, pVictim, {
      library: [{ id: 'l1', name: 'Island', type_line: 'Land' }],
    });

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: 'Test Pilfer',
      oracleText: POSSESSIVE_LIBRARY_TOP_TEXT,
      sourceId: 'pilfer-stack',
      targets: ['perm_creature'],
    });

    expect(outcome.handled).toBe(true);
    expect((game.state as any).battlefield || []).toHaveLength(0);
    const victimAfter = (game.state as any).players.find((entry: any) => entry.id === pVictim);
    expect(victimAfter.library).toHaveLength(0);
    expect(victimAfter.exile).toHaveLength(2);
    expect(victimAfter.exile.map((card: any) => card.id).sort()).toEqual(['card1', 'l1']);
  });
});
