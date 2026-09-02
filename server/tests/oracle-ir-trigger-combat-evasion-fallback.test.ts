import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRFallbackForTriggeredEffect } from '../src/state/modules/stackExecuteTriggerEffectIrFallbackUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

beforeEach(() => {
  // Direct calls to applyOracleIRFallbackForTriggeredEffect no-op when IR primary
  // owns the effect (shouldSkipTriggerUncategorizedFallback). This file pins that
  // fallback seam; keep PRIMARY=0 even if the process set ORACLE_IR_CENSUS_*.
  process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
  process.env.ORACLE_IR_SPELL_PRIMARY = '0';
});

describe('oracle IR trigger fallback — combat evasion + counter-scaled modify_pt', () => {
  it('applies counter-scaled +X/+X via uncategorized IR fallback (Hydra Trainer exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('hydra_counter_scaled_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'hydra_trainer',
        controller: p1,
        counters: { '+1/+1': 2 },
        card: { name: 'Hydra Trainer', type_line: 'Creature' },
      },
      {
        id: 'counter_target',
        controller: p1,
        card: { name: 'Counter Target', type_line: 'Creature' },
      },
      {
        id: 'charge_relic',
        controller: p1,
        counters: { charge: 1 },
        card: { name: 'Charge Relic', type_line: 'Artifact' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = 'hydra_counter_scaled_fallback';
    const effectText =
      'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control';

    const applied = applyOracleIRFallbackForTriggeredEffect(ctx, p1, 'Hydra Trainer', effectText, {
      source: 'hydra_trainer',
      targets: ['counter_target'],
    });

    expect(applied).toBeGreaterThan(0);
    const target = (game.state as any).battlefield.find((perm: any) => perm.id === 'counter_target');
    expect(target?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('does not mirror an old P/T modifier again when a later Oracle IR effect resolves', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('temporary_pt_mirror_dedupe');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Target', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    }];

    const ctx = game as any;
    ctx.gameId = 'temporary_pt_mirror_dedupe';
    expect(applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'First Effect',
      'target creature gets -0/-2 until end of turn.',
      { source: 'first-source', targets: ['target-1'] },
    )).toBeGreaterThan(0);

    expect(applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Later Effect',
      'you gain 1 life.',
      { source: 'later-source' },
    )).toBeGreaterThan(0);

    const target = (game.state as any).battlefield[0];
    expect(target.temporaryPTMods).toEqual([
      expect.objectContaining({
        power: 0,
        toughness: -2,
        source: 'first-source',
        expiresAt: 'end_of_turn',
      }),
    ]);
  });

  it('applies self unblockable + scry via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('self_unblockable_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'self-1',
      controller: p1,
      card: { name: 'Clockwork Droid', type_line: 'Creature — Construct' },
    }];
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = 'self_unblockable_fallback';
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue('self_unblockable_fallback');

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Clockwork Droid',
      "It can't be blocked this turn and you scry 1.",
      { source: 'self-1', permanentId: 'self-1' },
    );

    expect(applied).toBeGreaterThan(0);
    const self = (game.state as any).battlefield[0];
    expect(self.temporaryAbilities?.some((entry: any) =>
      String(entry?.ability || '').toLowerCase().includes("can't be blocked"),
    )).toBe(true);

    const queue = ResolutionQueueManager.getQueue('self_unblockable_fallback');
    expect(queue.steps.some((step: any) =>
      step.type === ResolutionStepType.SCRY && step.playerId === p1 && step.scryCount === 1,
    )).toBe(true);

    ResolutionQueueManager.removeQueue('self_unblockable_fallback');
  });

  it('applies self combat damage prevention via uncategorized IR fallback (Oketra exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('oketra_combat_prevent_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'oketra-1',
      controller: p1,
      card: { name: "Oketra's Avenger", type_line: 'Creature — Zombie Warrior' },
    }];

    const ctx = game as any;
    ctx.gameId = 'oketra_combat_prevent_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      "Oketra's Avenger",
      'prevent all combat damage that would be dealt to it this turn.',
      { source: 'oketra-1', permanentId: 'oketra-1' },
    );

    expect(applied).toBeGreaterThan(0);
    const self = (game.state as any).battlefield[0];
    expect(self.temporaryAbilities?.some((entry: any) =>
      /prevent all combat damage that would be dealt to (?:it|this creature) this turn/i.test(
        String(entry?.ability || ''),
      ),
    )).toBe(true);
  });

  it('applies target unblockable via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('target_unblockable_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Giant', type_line: 'Creature — Giant' },
    }];

    const ctx = game as any;
    ctx.gameId = 'target_unblockable_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "Up to one target creature can't be blocked this turn.",
      { targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    const target = (game.state as any).battlefield[0];
    expect(target.temporaryAbilities?.some((entry: any) =>
      String(entry?.ability || '').toLowerCase().includes("can't be blocked"),
    )).toBe(true);
  });

  it('applies low-power self unblockable via uncategorized IR fallback (Trueheart Twins exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('low_power_unblockable_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'self-1',
      controller: p1,
      card: { name: 'Trueheart Twins', type_line: 'Creature — Warrior' },
    }];

    const ctx = game as any;
    ctx.gameId = 'low_power_unblockable_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Trueheart Twins',
      "This creature can't be blocked by creatures with power 2 or less this turn.",
      { source: 'self-1', permanentId: 'self-1' },
    );

    expect(applied).toBeGreaterThan(0);
    const self = (game.state as any).battlefield[0];
    expect(self.temporaryAbilities?.some((entry: any) =>
      String(entry?.ability || '').toLowerCase().includes("can't be blocked by creatures with power 2 or less"),
    )).toBe(true);
  });
});

describe('oracle IR trigger fallback — modify_pt exert rewards', () => {
  it('applies self +1/+3 and lifelink via uncategorized IR fallback (Glory-Bound Initiate exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('glory_bound_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'self-1',
      controller: p1,
      card: { name: 'Glory-Bound Initiate', type_line: 'Creature — Human Warrior' },
    }];

    const ctx = game as any;
    ctx.gameId = 'glory_bound_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Glory-Bound Initiate',
      'it gets +1/+3 and gains lifelink until end of turn.',
      { source: 'self-1', permanentId: 'self-1' },
    );

    expect(applied).toBeGreaterThan(0);
    const self = (game.state as any).battlefield[0];
    expect(self.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
    expect(self.temporaryAbilities?.some((entry: any) =>
      String(entry?.ability || '').toLowerCase().includes('lifelink'),
    )).toBe(true);
  });

  it('applies team +1/+1 via uncategorized IR fallback (Tah-Crop Elite exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('tah_crop_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'elite-1',
        controller: p1,
        card: { name: 'Tah-Crop Elite', type_line: 'Creature — Human Warrior' },
      },
      {
        id: 'ally-1',
        controller: p1,
        card: { name: 'Ally', type_line: 'Creature — Human' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = 'tah_crop_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Tah-Crop Elite',
      'creatures you control get +1/+1 until end of turn.',
      { source: 'elite-1', permanentId: 'elite-1' },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies target +2/+2 via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('target_pt_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Target', type_line: 'Creature' },
    }];

    const ctx = game as any;
    ctx.gameId = 'target_pt_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'target creature gets +2/+2 until end of turn.',
      { targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies self +2/+2 via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('self_pt_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'self-1',
      controller: p1,
      card: { name: 'Self', type_line: 'Creature' },
    }];

    const ctx = game as any;
    ctx.gameId = 'self_pt_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'it gets +2/+2 until end of turn.',
      { source: 'self-1', permanentId: 'self-1' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies team +1/+0 via uncategorized IR fallback (Resolute Survivors watcher)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('team_pt0_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature' } },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'team_pt0_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Resolute Survivors',
      'creatures you control get +1/+0 until end of turn.',
      { source: 'a', permanentId: 'a' },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('doubles target creature power via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('double_power_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Bear', type_line: 'Creature', power: '2', toughness: '2' },
      power: 2,
      toughness: 2,
    }];

    const ctx = game as any;
    ctx.gameId = 'double_power_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "double target creature's power until end of turn.",
      { targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies other-creatures pump via uncategorized IR fallback (exert ally pump)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('other_creatures_pt_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'self-1', controller: p1, card: { name: 'Self', type_line: 'Creature' } },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'other_creatures_pt_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'other creatures you control get +1/+1 until end of turn.',
      { source: 'self-1', permanentId: 'self-1' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('doubles target creature power and toughness via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('double_pt_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Bear', type_line: 'Creature', power: '2', toughness: '3' },
      power: 2,
      toughness: 3,
    }];

    const ctx = game as any;
    ctx.gameId = 'double_pt_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "double target creature's power and toughness until end of turn.",
      { targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies target cant block via uncategorized IR fallback (exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('cant_block_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Blocker', type_line: 'Creature' },
      temporaryAbilities: [],
    }];

    const ctx = game as any;
    ctx.gameId = 'cant_block_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "target creature can't block this turn.",
      { targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: "can't block", expiresAt: 'end_of_turn' }),
      ]),
    );
  });

  it('applies compound team pump+keyword via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('compound_team_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'a',
      controller: p1,
      card: { name: 'A', type_line: 'Creature' },
      temporaryAbilities: [],
    }];

    const ctx = game as any;
    ctx.gameId = 'compound_team_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control get +1/+1 and gain vigilance until end of turn.',
      { source: 'a', permanentId: 'a' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'vigilance', expiresAt: 'end_of_turn' }),
      ]),
    );
  });

  it('applies each-creature pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('each_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature' } },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'each_creature_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +1/+1 until end of turn.',
      { source: 'a', permanentId: 'a' },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies chosen-type compound pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('chosen_type_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'human', controller: p1, card: { name: 'Human', type_line: 'Creature — Human' } },
      { id: 'elf', controller: p1, card: { name: 'Elf', type_line: 'Creature — Elf' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'chosen_type_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control of the chosen type get +1/+0 and gain haste until end of turn.',
      { source: 'human', permanentId: 'human', chosenCreatureType: 'Human' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'haste', expiresAt: 'end_of_turn' }),
      ]),
    );
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('stores clean keyword text for target compound pump grants', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('target_flying_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'target-1',
      controller: p1,
      card: { name: 'Target', type_line: 'Creature' },
      temporaryAbilities: [],
    }];

    const ctx = game as any;
    ctx.gameId = 'target_flying_fallback';

    applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "target creature gets +2/+2 and gains flying until end of turn.",
      { targets: ['target-1'] },
    );

    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' }),
      ]),
    );
  });

  it('applies prefix team compound pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('prefix_team_compound_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'a',
      controller: p1,
      card: { name: 'A', type_line: 'Creature' },
      temporaryAbilities: [],
    }];

    const ctx = game as any;
    ctx.gameId = 'prefix_team_compound_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, creatures you control get +1/+1 and gain trample.',
      { source: 'a', permanentId: 'a' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'trample', expiresAt: 'end_of_turn' }),
      ]),
    );
  });

  it('applies team have haste via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('team_have_haste_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature' }, temporaryAbilities: [] },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature' }, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'team_have_haste_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control have haste until end of turn.',
      { source: 'a', permanentId: 'a' },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryAbilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ability: 'haste', expiresAt: 'end_of_turn' }),
        ]),
      );
    }
  });

  it('applies target-player compound pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('target_player_compound_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      {
        id: 'opp-creature',
        controller: p2,
        card: { name: 'Opp Creature', type_line: 'Creature' },
        temporaryAbilities: [],
      },
    ];

    const ctx = game as any;
    ctx.gameId = 'target_player_compound_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Shields of Velis Vel',
      'creatures target player controls get +0/+1 and gain all creature types until end of turn.',
      { source: 'ally', permanentId: 'ally', targetPlayerId: p2 },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 0, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'all creature types', expiresAt: 'end_of_turn' }),
      ]),
    );
  });

  it('applies each-other creature pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('each_other_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'each_other_creature_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each other creature you control gets +1/+1 until end of turn.',
      { source: 'source', permanentId: 'source' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies those-creatures pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('those_creatures_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature — Human' } },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'those_creatures_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Inspiring Call',
      'Those creatures get +1/+1 until end of turn.',
      {
        source: 'a',
        permanentId: 'a',
        antecedentPermanentIds: ['a', 'b'],
      },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies attacking-creatures pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('attacking_creatures_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'attacker',
        controller: p1,
        card: { name: 'Attacker', type_line: 'Creature' },
        attacking: true,
        attackingPlayerId: 'p2',
      },
      { id: 'defender', controller: p1, card: { name: 'Defender', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'attacking_creatures_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'attacking creatures you control get +1/+1 until end of turn.',
      { source: 'attacker', permanentId: 'attacker' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies subtype mass pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('zombie_mass_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'zombie', controller: p1, card: { name: 'Zombie', type_line: 'Creature — Zombie' } },
      { id: 'human', controller: p1, card: { name: 'Human', type_line: 'Creature — Human' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'zombie_mass_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'Zombie creatures you control get +1/+1 until end of turn.',
      { source: 'zombie', permanentId: 'zombie' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies attacking creature self pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('attacked_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'attacker',
      controller: p1,
      card: { name: 'Attacker', type_line: 'Creature', power: '3', toughness: '3' },
      power: 3,
      toughness: 3,
      attacking: true,
      attackingPlayerId: 'p2',
    }];

    const ctx = game as any;
    ctx.gameId = 'attacked_creature_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'the creature that attacked gets +2/+2 until end of turn.',
      { source: 'attacker', permanentId: 'attacker' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies they-pump via uncategorized IR fallback with antecedent context', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('they_pump_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature — Human' } },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'they_pump_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Inspiring Call',
      'they get +2/+2 until end of turn.',
      {
        source: 'a',
        permanentId: 'a',
        antecedentPermanentIds: ['a', 'b'],
      },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies each-creature mass pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('each_creature_mass_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'each_creature_mass_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature gets +1/+1 until end of turn.',
      { source: 'ally', permanentId: 'ally' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies opponent-creature mass pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('opponent_creature_mass_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'opponent_creature_mass_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "each opponent's creatures get -1/-1 until end of turn.",
      { source: 'ally', permanentId: 'ally' },
    );
    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: -1, toughness: -1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies compound team PT+have via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('compound_have_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'team', controller: p1, card: { name: 'Team', type_line: 'Creature' } },
      { id: 'chosen', controller: p1, card: { name: 'Chosen', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'compound_have_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control get +1/+1 and have trample until end of turn.',
      { source: 'team', permanentId: 'team' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
      expect(perm.temporaryAbilities).toEqual(
        expect.arrayContaining([expect.objectContaining({ ability: 'trample', expiresAt: 'end_of_turn' })]),
      );
    }
  });

  it('applies chosen-creature pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('chosen_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'team', controller: p1, card: { name: 'Team', type_line: 'Creature' } },
      { id: 'chosen', controller: p1, card: { name: 'Chosen', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'chosen_creature_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'the chosen creature gets +2/+2 until end of turn.',
      {
        source: 'team',
        permanentId: 'team',
        targets: ['chosen'],
      },
    );
    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies they X pump via uncategorized IR fallback with antecedent context', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('they_x_pump_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'a', controller: p1, card: { name: 'A', type_line: 'Creature — Human' } },
      { id: 'b', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' } },
      { id: 'c', controller: p1, card: { name: 'C', type_line: 'Creature — Wizard' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'they_x_pump_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Inspiring Call',
      'they get +X/+X until end of turn, where X is the number of creatures you control.',
      {
        source: 'a',
        permanentId: 'a',
        antecedentPermanentIds: ['a', 'b'],
      },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[2].temporaryPTMods).toBeUndefined();
  });

  it('applies blocking-creature pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('blocking_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'attacker',
        controller: p1,
        card: { name: 'Plague Wight', type_line: 'Creature' },
        blockedBy: [{ blockerId: 'blocker' }],
      },
      { id: 'blocker', controller: p2, card: { name: 'Blocker', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'blocking_creature_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Plague Wight',
      'each creature blocking it gets -1/-1 until end of turn.',
      { source: 'attacker', permanentId: 'attacker' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: -1, toughness: -1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies attacking X pump scaled by mountains via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('attacking_x_mountain_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'attacker',
        controller: p1,
        card: { name: 'Attacker', type_line: 'Creature' },
        attacking: true,
        attackingPlayerId: 'p2',
      },
      { id: 'defender', controller: p1, card: { name: 'Defender', type_line: 'Creature' } },
      { id: 'mountain-1', controller: p1, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
      { id: 'mountain-2', controller: p1, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'attacking_x_mountain_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'attacking creatures you control get +X/+0 until end of turn, where X is the number of Mountains you control.',
      { source: 'attacker', permanentId: 'attacker' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies that-creature and equipped-creature pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('reference_creature_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'creature', controller: p1, card: { name: 'Creature', type_line: 'Creature' } },
      { id: 'equip', controller: p1, card: { name: 'Sword', type_line: 'Artifact — Equipment' }, attachedTo: 'creature' },
      { id: 'aura', controller: p1, card: { name: 'Aura', type_line: 'Enchantment — Aura' }, attachedTo: 'creature' },
    ];

    const ctx = game as any;
    ctx.gameId = 'reference_creature_fallback';

    const thatApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'that creature gets +2/+2 until end of turn.',
      { source: 'creature', permanentId: 'creature', targets: ['creature'] },
    );
    expect(thatApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[0].temporaryPTMods;
    delete (game.state as any).battlefield[0].modifiers;

    const equipApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Sword',
      'equipped creature gets +2/+2 until end of turn.',
      { source: 'equip', permanentId: 'equip' },
    );
    expect(equipApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[0].temporaryPTMods;
    delete (game.state as any).battlefield[0].modifiers;

    const enchantApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Aura',
      'enchanted creature gets +2/+2 until end of turn.',
      { source: 'aura', permanentId: 'aura' },
    );
    expect(enchantApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies team creature-count X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('team_creature_count_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 5, toughness: 5 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'big', controller: p1, card: { name: 'Big', type_line: 'Creature' }, power: 7, toughness: 7 },
    ];

    const ctx = game as any;
    ctx.gameId = 'team_creature_count_x_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies greatest-power team X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('team_greatest_power_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 5, toughness: 5 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'big', controller: p1, card: { name: 'Big', type_line: 'Creature' }, power: 7, toughness: 7 },
    ];

    const ctx = game as any;
    ctx.gameId = 'team_greatest_power_x_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control get +X/+X until end of turn, where X is the greatest power among creatures you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 7, toughness: 7, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies stampede compound X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('stampede_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'big', controller: p1, card: { name: 'Big', type_line: 'Creature' }, power: 7, toughness: 7 },
    ];

    const ctx = game as any;
    ctx.gameId = 'stampede_x_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Overwhelming Stampede',
      'Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.',
      { source: 'source', permanentId: 'source' },
    );

    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 7, toughness: 7, expiresAt: 'end_of_turn' }),
      ]);
      expect(perm.temporaryAbilities).toEqual(
        expect.arrayContaining([expect.objectContaining({ ability: 'trample', expiresAt: 'end_of_turn' })]),
      );
    }
  });

  it('applies flanking attacking mass via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('flanking_mass_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'flanker',
        controller: p1,
        card: { name: 'Flanker', type_line: 'Creature', keywords: ['Flanking'] },
        attacking: true,
        attackingPlayerId: p2,
      },
      {
        id: 'attacker',
        controller: p1,
        card: { name: 'Attacker', type_line: 'Creature' },
        attacking: true,
        attackingPlayerId: p2,
      },
      { id: 'defender', controller: p1, card: { name: 'Defender', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'flanking_mass_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'all attacking creatures with flanking get +1/+1 until end of turn.',
      { source: 'flanker', permanentId: 'flanker' },
    );
    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies hand-scaled global -X/-0 via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('hand_global_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' } },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
        handCount: 3,
      },
    };

    const ctx = game as any;
    ctx.gameId = 'hand_global_x_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'all creatures get -X/-0 until end of turn, where X is the number of cards in your hand.',
      { source: 'ally', permanentId: 'ally' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: -3, toughness: 0, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies per-creature counter X pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('counter_x_each_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'countered',
        controller: p1,
        counters: { '+1/+1': 2 },
        card: { name: 'Countered', type_line: 'Creature' },
      },
      { id: 'plain', controller: p1, card: { name: 'Plain', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'counter_x_each_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'countered', permanentId: 'countered' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies up-to-one-target pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('up_to_one_target_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'target-1', controller: p1, card: { name: 'Target', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'up_to_one_target_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'up to one target creature gets +2/+2 until end of turn.',
      { source: 'source', permanentId: 'source', targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies unblocked attacking mass pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('unblocked_attacking_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'unblocked',
        controller: p1,
        card: { name: 'Unblocked', type_line: 'Creature' },
        attacking: true,
        attackingPlayerId: p2,
        blockedBy: [],
      },
      {
        id: 'blocked',
        controller: p1,
        card: { name: 'Blocked', type_line: 'Creature' },
        attacking: true,
        attackingPlayerId: p2,
        blockedBy: [{ blockerId: 'blocker' }],
      },
      { id: 'blocker', controller: p2, card: { name: 'Blocker', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'unblocked_attacking_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'unblocked attacking creatures get +1/+0 until end of turn.',
      { source: 'unblocked', permanentId: 'unblocked' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies counters-on-permanents target X pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('counter_permanents_target_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, counters: { charge: 2 }, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'ally', controller: p1, counters: { '+1/+1': 1 }, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'target-1', controller: p1, card: { name: 'Target', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'counter_permanents_target_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control.',
      { source: 'source', permanentId: 'source', targets: ['target-1'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies one-or-two-target pump to all chosen targets via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('one_or_two_target_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'target-a', controller: p1, card: { name: 'A', type_line: 'Creature' } },
      { id: 'target-b', controller: p1, card: { name: 'B', type_line: 'Creature' } },
      { id: 'other', controller: p1, card: { name: 'Other', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'one_or_two_target_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'one or two target creatures get +2/+2 until end of turn.',
      { source: 'source', permanentId: 'source', targets: ['target-a', 'target-b'] },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[3].temporaryPTMods).toBeUndefined();
  });

  it('applies prefix self compound pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('prefix_self_compound_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'prefix_self_compound_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, it gets +2/+2 and gains flying.',
      { source: 'source', permanentId: 'source' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' })]),
    );
  });

  it('applies opponent hand-scaled -X/-X and each-creature +X/+0 via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('opponent_hand_each_x0_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, counters: { '+1/+1': 2 }, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'plain', controller: p1, card: { name: 'Plain', type_line: 'Creature' } },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [{ id: 'h1' }, { id: 'h2' }], handCount: 2 } };

    const ctx = game as any;
    ctx.gameId = 'opponent_hand_each_x0_fallback';

    const opponentApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'target creature an opponent controls gets -X/-X until end of turn, where X is the number of cards in your hand.',
      { source: 'source', permanentId: 'source', targets: ['opp'] },
    );
    expect(opponentApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: -2, toughness: -2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[2].temporaryPTMods;

    const eachApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'source', permanentId: 'source' },
    );
    expect(eachApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
  });

  it('applies target-player mass pump and two-target pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('target_player_two_target_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'opp-a', controller: p2, card: { name: 'Opp A', type_line: 'Creature' } },
      { id: 'opp-b', controller: p2, card: { name: 'Opp B', type_line: 'Creature' } },
      { id: 'ally-a', controller: p1, card: { name: 'Ally A', type_line: 'Creature' } },
      { id: 'ally-b', controller: p1, card: { name: 'Ally B', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'target_player_two_target_fallback';

    const targetPlayerApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures target player controls get +1/+1 until end of turn.',
      { source: 'source', permanentId: 'source', targetPlayerId: p2, targets: [p2] },
    );
    expect(targetPlayerApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    for (const idx of [1, 2]) {
      delete (game.state as any).battlefield[idx].temporaryPTMods;
    }

    const twoTargetApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'two target creatures get +2/+2 until end of turn.',
      { source: 'source', permanentId: 'source', targets: ['ally-a', 'ally-b'] },
    );
    expect(twoTargetApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[3].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[4].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies each-attacking counter X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('each_attacking_counter_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, counters: { '+1/+1': 2 }, attacking: true, card: { name: 'Source', type_line: 'Creature' } },
      { id: 'plain', controller: p1, attacking: true, card: { name: 'Plain', type_line: 'Creature' } },
      { id: 'not-attacking', controller: p1, card: { name: 'Bench', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'each_attacking_counter_x_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each attacking creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'source', permanentId: 'source' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield[1].temporaryPTMods).toBeUndefined();
    expect((game.state as any).battlefield[2].temporaryPTMods).toBeUndefined();
  });

  it('applies chosen, blocking hand-scaled, and another-target counter X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('chosen_blocking_another_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'attacker',
        controller: p1,
        card: { name: 'Source', type_line: 'Creature' },
        blockedBy: [{ blockerId: 'blocker' }],
      },
      { id: 'blocker', controller: p2, card: { name: 'Blocker', type_line: 'Creature' } },
      { id: 'chosen', controller: p1, counters: { '+1/+1': 2 }, card: { name: 'Chosen', type_line: 'Creature' } },
      { id: 'other', controller: p1, counters: { '+1/+1': 3 }, card: { name: 'Other', type_line: 'Creature' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [{ id: 'h1' }, { id: 'h2' }], handCount: 2 } };

    const ctx = game as any;
    ctx.gameId = 'chosen_blocking_another_fallback';

    const chosenApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'the chosen creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'attacker', permanentId: 'attacker', targets: ['chosen'] },
    );
    expect(chosenApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[2].temporaryPTMods;

    const blockingApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature blocking it gets -X/-X until end of turn, where X is the number of cards in your hand.',
      { source: 'attacker', permanentId: 'attacker' },
    );
    expect(blockingApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[1].temporaryPTMods).toEqual([
      expect.objectContaining({ power: -2, toughness: -2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[1].temporaryPTMods;

    const anotherApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'another target creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'attacker', permanentId: 'attacker', targets: ['other'] },
    );
    expect(anotherApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[3].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies attacked-creature, that-creature, and opponent hand-scaled pumps via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('attacked_that_opponent_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'attacker', controller: p1, attacking: true, card: { name: 'Attacker', type_line: 'Creature' } },
      { id: 'mountain', controller: p1, card: { name: 'Mountain', type_line: 'Land — Mountain' } },
      { id: 'that', controller: p1, counters: { '+1/+1': 2 }, card: { name: 'That', type_line: 'Creature' } },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }], handCount: 3 } };

    const ctx = game as any;
    ctx.gameId = 'attacked_that_opponent_fallback';

    const attackedApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Attacker',
      'the creature that attacked gets +X/+X until end of turn, where X is the number of Mountains you control.',
      { source: 'attacker', permanentId: 'attacker' },
    );
    expect(attackedApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[0].temporaryPTMods;

    const thatApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'that creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'attacker', permanentId: 'attacker', targets: ['that'], targetPermanentId: 'that' },
    );
    expect(thatApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[2].temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    delete (game.state as any).battlefield[2].temporaryPTMods;

    const opponentApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each opponent\'s creatures get -X/-X until end of turn, where X is the number of cards in your hand.',
      { source: 'attacker', permanentId: 'attacker' },
    );
    expect(opponentApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[3].temporaryPTMods).toEqual([
      expect.objectContaining({ power: -3, toughness: -3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies team +X/+0 hand-scaled pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('team_hand_x0_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
        handCount: 3,
      },
    };
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 1, toughness: 1 },
    ];

    const ctx = game as any;
    ctx.gameId = 'team_hand_x0_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control get +X/+0 until end of turn, where X is the number of cards in your hand.',
      { source: 'source', permanentId: 'source' },
    );
    expect(applied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryPTMods).toEqual([
        expect.objectContaining({ power: 3, toughness: 0, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies per-creature its-power pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('each_its_power_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'small', controller: p1, card: { name: 'Small', type_line: 'Creature' }, power: 2, toughness: 5 },
      { id: 'big', controller: p1, card: { name: 'Big', type_line: 'Creature' }, power: 6, toughness: 3 },
    ];

    const ctx = game as any;
    ctx.gameId = 'each_its_power_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +X/+X until end of turn, where X is its power.',
      { source: 'source', permanentId: 'source' },
    );
    expect(applied).toBeGreaterThan(0);
    const modsById = Object.fromEntries(
      (game.state as any).battlefield.map((perm: any) => [perm.id, perm.temporaryPTMods?.[0]]),
    );
    expect(modsById.source).toEqual(expect.objectContaining({ power: 2, toughness: 2 }));
    expect(modsById.small).toEqual(expect.objectContaining({ power: 2, toughness: 2 }));
    expect(modsById.big).toEqual(expect.objectContaining({ power: 6, toughness: 6 }));
  });

  it('applies they +X/+0 counter-scaled and each-attacking its-power pumps via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('they_attacking_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, attacking: true, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 4, toughness: 1, counters: { '+1/+1': 2 } },
    ];

    const ctx = game as any;
    ctx.gameId = 'they_attacking_x_fallback';

    const theyApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'they get +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
      { source: 'source', permanentId: 'source', lastAntecedentBattlefieldPermanentIds: ['ally'] },
    );
    expect(theyApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    const attackingApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each attacking creature you control gets +X/+X until end of turn, where X is its power.',
      { source: 'source', permanentId: 'source' },
    );
    expect(attackingApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies other-creatures team X and prefix self hexproof via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('other_prefix_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2, temporaryAbilities: [] },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 4, toughness: 1, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'other_prefix_fallback';

    const otherApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'other creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(otherApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);

    const hexApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, it gains hexproof.',
      { source: 'source', permanentId: 'source' },
    );
    expect(hexApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'hexproof', expiresAt: 'end_of_turn' })]),
    );
  });

  it('applies prefix self counter X and this-creature lifelink via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('prefix_self_x_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'source',
        controller: p1,
        card: { name: 'Source', type_line: 'Creature' },
        power: 2,
        toughness: 2,
        counters: { '+1/+1': 3 },
        temporaryAbilities: [],
      },
    ];

    const ctx = game as any;
    ctx.gameId = 'prefix_self_x_fallback';

    const scaledApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
      { source: 'source', permanentId: 'source' },
    );
    expect(scaledApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);

    const lifelinkApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'this creature gains lifelink until end of turn.',
      { source: 'source', permanentId: 'source' },
    );
    expect(lifelinkApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'lifelink', expiresAt: 'end_of_turn' })]),
    );
  });

  it('applies reference grant, prefix team hand-scaled, and opponent mass X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch258_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).zones = { p1: { hand: [{ id: 'c1' }, { id: 'c2' }] } };
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Aura', type_line: 'Enchantment — Aura' }, attachedTo: 'ally', temporaryAbilities: [] },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, temporaryAbilities: [] },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch258_fallback';

    const grantApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Aura',
      'enchanted creature gains flying until end of turn.',
      { source: 'source', permanentId: 'source' },
    );
    expect(grantApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' })]),
    );

    const teamApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, creatures you control get +X/+0, where X is the number of cards in your hand.',
      { source: 'source', permanentId: 'source' },
    );
    expect(teamApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    const oppApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures your opponents control get -X/-X until end of turn, where X is the number of cards in your hand.',
      { source: 'source', permanentId: 'source' },
    );
    expect(oppApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'opp').temporaryPTMods).toEqual([
      expect.objectContaining({ power: -2, toughness: -2, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies dont-control hand-scaled debuff and prefix-each team pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch259_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).zones = { p1: { hand: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] } };
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 4, toughness: 4 },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, power: 3, toughness: 3 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch259_fallback';

    const debuffApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "each creature you don't control gets -X/-X until end of turn, where X is the number of cards in your hand.",
      { source: 'source', permanentId: 'source' },
    );
    expect(debuffApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'opp').temporaryPTMods).toEqual([
      expect.objectContaining({ power: -3, toughness: -3, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryPTMods ?? []).toEqual([]);

    const teamApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, each creature you control gets +1/+1.',
      { source: 'source', permanentId: 'source' },
    );
    expect(teamApplied).toBeGreaterThan(0);
    for (const id of ['source', 'ally']) {
      expect((game.state as any).battlefield.find((entry: any) => entry.id === id).temporaryPTMods).toEqual([
        expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies all-dont-control debuff and for-each team pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch260_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, power: 4, toughness: 4 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch260_fallback';

    const allApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "all creatures you don't control get -1/-1 until end of turn.",
      { source: 'source', permanentId: 'source' },
    );
    expect(allApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'opp').temporaryPTMods).toEqual([
      expect.objectContaining({ power: -1, toughness: -1, expiresAt: 'end_of_turn' }),
    ]);

    const forEachApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +1/+1 until end of turn for each creature you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(forEachApplied).toBeGreaterThan(0);
    for (const id of ['source', 'ally']) {
      expect((game.state as any).battlefield.find((entry: any) => entry.id === id).temporaryPTMods).toEqual([
        expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies scaled for-each counter pump and global each-creature where-X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch261_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2, counters: { '+1/+1': 2 } },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, power: 4, toughness: 4 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch261_fallback';

    const scaledApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gets +X/+X until end of turn for each +1/+1 counter on it.',
      { source: 'source', permanentId: 'source' },
    );
    expect(scaledApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'source').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods ?? []).toEqual([]);

    const globalApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature gets +X/+X until end of turn, where X is the number of creatures you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(globalApplied).toBeGreaterThan(0);
    for (const id of ['source', 'ally', 'opp']) {
      expect((game.state as any).battlefield.find((entry: any) => entry.id === id).temporaryPTMods).toEqual([
        expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
      ]);
    }
  });

  it('applies prefix-each for-each pump and static cost reduction via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('batch262_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 3, toughness: 3 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch262_fallback';

    const prefixApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'until end of turn, each creature you control gets +1/+1 for each creature you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(prefixApplied).toBeGreaterThan(0);
    for (const id of ['source', 'ally']) {
      expect((game.state as any).battlefield.find((entry: any) => entry.id === id).temporaryPTMods).toEqual([
        expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
      ]);
    }

    const costApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'noncreature spells you control cost {1} less to cast.',
      { source: 'source', permanentId: 'source' },
    );
    expect(costApplied).toBeGreaterThan(0);
  });

  it('applies opponent for-each pump and spell cost reduction via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch263_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, power: 4, toughness: 4 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch263_fallback';

    const oppApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      "each opponent's creatures get +1/+1 until end of turn for each creature you control.",
      { source: 'source', permanentId: 'source' },
    );
    expect(oppApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'opp').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);

    const spellCostApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'this spell costs {1} less to cast for each creature you control.',
      { source: 'source', permanentId: 'source' },
    );
    expect(spellCostApplied).toBeGreaterThan(0);
  });

  it('applies each-other-attacking pump and opponent mass debuff via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch264_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'leader', controller: p1, attacking: true, card: { name: 'Leader', type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'ally', controller: p1, attacking: true, card: { name: 'Ally', type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'opp', controller: p2, card: { name: 'Opp', type_line: 'Creature' }, power: 4, toughness: 4 },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch264_fallback';

    const battlecryApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Leader',
      'each other attacking creature gets +1/+0 until end of turn.',
      { source: 'leader', permanentId: 'leader' },
    );
    expect(battlecryApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    const massApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Leader',
      'creatures your opponents control get -1/-1 until end of turn.',
      { source: 'leader', permanentId: 'leader' },
    );
    expect(massApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'opp').temporaryPTMods).toEqual([
      expect.objectContaining({ power: -1, toughness: -1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies other-attacking-you-control counter X and base-1/1 team counter X via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('batch265_other_attacking_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'qala',
        controller: p1,
        attacking: true,
        counters: { '+1/+1': 2 },
        card: { name: 'Qala', type_line: 'Creature' },
      },
      { id: 'ally', controller: p1, attacking: true, card: { name: 'Ally', type_line: 'Creature' } },
      {
        id: 'bess',
        controller: p1,
        basePower: 1,
        baseToughness: 1,
        counters: { '+1/+1': 3 },
        card: { name: 'Bess', type_line: 'Creature', power: 1, toughness: 1 },
      },
      {
        id: 'token',
        controller: p1,
        basePower: 1,
        baseToughness: 1,
        card: { name: 'Token', type_line: 'Creature', power: 1, toughness: 1 },
      },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch265_other_attacking_fallback';

    const qalaApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Qala',
      'other attacking creatures you control get +X/+0 until end of turn, where X is the number of counters on this permanent.',
      { source: 'qala', permanentId: 'qala' },
    );
    expect(qalaApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    const bessApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Bess',
      'each other creature you control with base power and toughness 1/1 gets +X/+X until end of turn, where X is the number of +1/+1 counters on this permanent.',
      { source: 'bess', permanentId: 'bess' },
    );
    expect(bessApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'token').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies blocking-creature debuff and each-of-them antecedent pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch267_blocking_each_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'attacker', controller: p1, attacking: true, power: 4, toughness: 4, card: { name: 'Attacker', type_line: 'Creature' } },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'blocker', controller: p2, card: { name: 'Blocker', type_line: 'Creature' } },
    ];
    (game.state as any).combat = {
      attackers: [{ permanentId: 'attacker' }],
      blockers: [{ permanentId: 'blocker', blocking: ['attacker'] }],
    };

    const ctx = game as any;
    ctx.gameId = 'batch267_blocking_each_fallback';

    const blockingApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Attacker',
      'each creature blocking this creature gets -0/-1 until end of turn.',
      { source: 'attacker', permanentId: 'attacker' },
    );
    expect(blockingApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'blocker').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 0, toughness: -1, expiresAt: 'end_of_turn' }),
    ]);

    const eachApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Leader',
      'each of them gets +x/+x until end of turn, where x is this creature\'s power.',
      {
        source: 'attacker',
        permanentId: 'attacker',
        lastAntecedentBattlefieldPermanentIds: ['ally'],
      },
    );
    expect(eachApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 4, toughness: 4, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies nonartifact global debuff via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('batch267_nonartifact_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'art', controller: p2, card: { name: 'Construct', type_line: 'Artifact Creature — Construct' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch267_nonartifact_fallback';

    const debuffApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'nonartifact creatures get -2/-2 until end of turn.',
      { source: 'ally', permanentId: 'ally' },
    );
    expect(debuffApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryPTMods).toEqual([
      expect.objectContaining({ power: -2, toughness: -2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'art').temporaryPTMods).toBeUndefined();
  });

  it('applies goblin-scaled team pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('batch267_goblin_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' } },
      { id: 'gob', controller: p1, card: { name: 'Gob', type_line: 'Creature — Goblin' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch267_goblin_fallback';

    const goblinApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Warboss',
      'each creature you control gets +1/+1 until end of turn for each goblin you control.',
      { source: 'ally', permanentId: 'ally' },
    );
    expect(goblinApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'gob').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('applies tap-any-number then per-tapped self pump via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('batch266_tap_pump_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'striker', controller: p1, card: { name: 'Siege Striker', type_line: 'Creature' } },
      { id: 'ally-a', controller: p1, card: { name: 'Ally A', type_line: 'Creature' } },
      { id: 'ally-b', controller: p1, card: { name: 'Ally B', type_line: 'Creature' } },
    ];

    const ctx = game as any;
    ctx.gameId = 'batch266_tap_pump_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Siege Striker',
      'you may tap any number of untapped creatures you control. this creature gets +1/+1 until end of turn for each creature tapped this way.',
      { source: 'striker', permanentId: 'striker', targets: ['ally-a', 'ally-b'] },
    );
    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'striker').temporaryPTMods).toEqual([
      expect.objectContaining({ power: 2, toughness: 2, expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).battlefield.filter((entry: any) => entry.tapped).length).toBe(2);
  });
});

describe('oracle IR trigger fallback — temporary ability grants', () => {
  it('applies team menace and target hexproof via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const game = createInitialGameState('grant_keyword_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'team-a', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, temporaryAbilities: [] },
      { id: 'team-b', controller: p1, card: { name: 'Ally 2', type_line: 'Creature' }, temporaryAbilities: [] },
      { id: 'tgt', controller: p2, card: { name: 'Target', type_line: 'Creature' }, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'grant_keyword_fallback';

    const teamApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'creatures you control gain menace until end of turn.',
      { source: 'team-a', permanentId: 'team-a' },
    );
    expect(teamApplied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield.filter((entry: any) => entry.controller === p1)) {
      expect(perm.temporaryAbilities).toEqual(
        expect.arrayContaining([expect.objectContaining({ ability: 'menace', expiresAt: 'end_of_turn' })]),
      );
    }

    const targetApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'target creature gains hexproof until end of turn.',
      { source: 'team-a', permanentId: 'team-a', targets: ['tgt'], targetPermanentId: 'tgt' },
    );
    expect(targetApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'tgt').temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'hexproof', expiresAt: 'end_of_turn' })]),
    );
  });

  it('applies other-creatures flying and each-creature flying via uncategorized IR fallback', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('expanded_grant_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'source', controller: p1, card: { name: 'Source', type_line: 'Creature' }, temporaryAbilities: [] },
      { id: 'ally', controller: p1, card: { name: 'Ally', type_line: 'Creature' }, temporaryAbilities: [] },
    ];

    const ctx = game as any;
    ctx.gameId = 'expanded_grant_fallback';

    const otherApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'other creatures you control gain flying until end of turn.',
      { source: 'source', permanentId: 'source' },
    );
    expect(otherApplied).toBeGreaterThan(0);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'ally').temporaryAbilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' })]),
    );

    const eachApplied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Source',
      'each creature you control gains flying until end of turn.',
      { source: 'source', permanentId: 'source' },
    );
    expect(eachApplied).toBeGreaterThan(0);
    for (const perm of (game.state as any).battlefield) {
      expect(perm.temporaryAbilities).toEqual(
        expect.arrayContaining([expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' })]),
      );
    }
  });

  it('applies self flying via uncategorized IR fallback (Themberchaud exert reward)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('flying_fallback');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'dragon-1',
      controller: p1,
      card: { name: 'Themberchaud', type_line: 'Creature — Dragon' },
      temporaryAbilities: [],
    }];

    const ctx = game as any;
    ctx.gameId = 'flying_fallback';

    const applied = applyOracleIRFallbackForTriggeredEffect(
      ctx,
      p1,
      'Themberchaud',
      'he gains flying until end of turn.',
      { source: 'dragon-1', permanentId: 'dragon-1' },
    );

    expect(applied).toBeGreaterThan(0);
    expect((game.state as any).battlefield[0].temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' }),
      ]),
    );
  });
});
