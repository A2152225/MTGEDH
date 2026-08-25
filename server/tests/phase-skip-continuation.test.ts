import { describe, expect, it, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  processPhaseSkipTriggerStops,
  resumePendingPhaseSkip,
  completePendingPhaseSkipCore,
} from '../src/state/modules/phaseSkipUtils.js';
import { markPlayerSkipsNextUntapStep } from '../src/state/modules/skipUntapStepUtils.js';
import type { PlayerID } from '../../shared/src/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('phase skip continuation', () => {
  beforeEach(() => {
    for (const gameId of [
      'phase_skip_main1_begin_combat',
      'phase_skip_main1_complete',
      'phase_skip_begin_combat_resume',
      'phase_skip_upkeep_draw',
      'phase_skip_draw_no_double',
      'phase_skip_untap_upkeep',
      'phase_skip_untap_no_double',
      'phase_skip_stasis_skip_untap',
      'phase_skip_player_skip_untap',
      'phase_skip_main1_end_combat',
      'phase_skip_upkeep_upkeep',
      'phase_skip_main1_postcombat',
      'phase_skip_begin_combat_no_refire',
    ]) {
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('stops at BEGIN_COMBAT when resuming from MAIN1 toward MAIN2', () => {
    const gameId = 'phase_skip_main1_begin_combat';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    };
    (game.state as any).battlefield = [
      {
        id: 'ouro_perm',
        controller: p1,
        owner: p1,
        basePower: 3,
        baseToughness: 3,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
      autoContinue: true,
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetStep: 'MAIN2',
      requestedBy: p1,
    });
  });

  it('completes directly to MAIN2 from MAIN1 when no intermediate triggers exist', () => {
    const gameId = 'phase_skip_main1_complete';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
      skipOriginPhase: 'precombatMain',
      skipOriginStep: 'MAIN1',
    };

    const stopResult = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      autoContinue: true,
    });
    expect(stopResult).toBe('ready_to_complete');

    completePendingPhaseSkipCore({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      autoContinue: true,
    });

    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
  });

  it('resumePendingPhaseSkip completes to MAIN2 after BEGIN_COMBAT triggers resolve', () => {
    const gameId = 'phase_skip_begin_combat_resume';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'combat';
    (game.state as any).step = 'BEGIN_COMBAT';
    (game.state as any).turnPlayer = p1;
    (game.state as any).stack = [];
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    };

    const result = resumePendingPhaseSkip({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(result).toBe('completed');
    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
  });

  it('does not stop at DRAW for additional-draw-only effects when skipping UPKEEP toward MAIN2', () => {
    const gameId = 'phase_skip_upkeep_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    game.importDeckResolved(p1, [
      { id: 'c1', name: 'Island', type_line: 'Instant' } as any,
      { id: 'c2', name: 'Forest', type_line: 'Instant' } as any,
    ]);

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).battlefield = [
      {
        id: 'sun_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    });

    expect(result).toBe('ready_to_complete');
    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.drawStepActionPerformed).toBe(true);
    expect(game.state.zones?.[p1]?.handCount).toBeGreaterThanOrEqual(1);
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.sourceName || item?.cardName || '') === 'The Immortal Sun',
      ),
    ).toBe(false);
  });

  it('does not double-draw when completing skip after draw step action during additional-draw scan', () => {
    const gameId = 'phase_skip_draw_no_double';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    game.importDeckResolved(p1, [
      { id: 'c1', name: 'Island', type_line: 'Instant' } as any,
      { id: 'c2', name: 'Forest', type_line: 'Instant' } as any,
    ]);

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).battlefield = [
      {
        id: 'sun_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
    ];

    const stopResult = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    });

    expect(stopResult).toBe('ready_to_complete');
    expect((game.state as any).pendingPhaseSkip?.drawStepActionPerformed).toBe(true);
    const handAfterScan = game.state.zones?.[p1]?.handCount ?? 0;
    const libraryAfterScan = game.state.zones?.[p1]?.libraryCount ?? 0;
    expect(handAfterScan).toBeGreaterThanOrEqual(1);

    completePendingPhaseSkipCore({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    });

    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect(game.state.zones?.[p1]?.handCount).toBe(handAfterScan);
    expect(game.state.zones?.[p1]?.libraryCount).toBe(libraryAfterScan);
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
  });

  it('untaps permanents when skipping from UNTAP before stopping at UPKEEP', () => {
    const gameId = 'phase_skip_untap_upkeep';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).battlefield = [
      {
        id: 'tapped_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'arena_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Phyrexian Arena',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.untapStepActionPerformed).toBe(true);
    expect((game.state as any).pendingPhaseSkip?.untappedDuringSkipIds).toContain('tapped_land');
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((p: any) => p.id === 'tapped_land')?.tapped).toBe(false);
  });

  it('does not untap on complete when untap step action already performed during scan', () => {
    const gameId = 'phase_skip_untap_no_double';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'DRAW';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
      untapStepActionPerformed: true,
    };
    (game.state as any).battlefield = [
      {
        id: 'still_tapped_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
    ];

    completePendingPhaseSkipCore({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
    });

    expect(String((game.state as any).step || '')).toBe('MAIN2');
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((p: any) => p.id === 'still_tapped_land')?.tapped).toBe(true);
  });

  it('does not untap when Stasis skips the untap step during phase skip scan', () => {
    const gameId = 'phase_skip_stasis_skip_untap';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).battlefield = [
      {
        id: 'stasis_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Stasis',
          type_line: 'Enchantment',
          oracle_text: 'Players skip their untap steps.',
        },
      },
      {
        id: 'tapped_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'upkeep_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Test Upkeep Draw',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, draw a card.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.untapStepActionPerformed).toBe(true);
    expect((game.state as any).pendingPhaseSkip?.untappedDuringSkipIds).toBeUndefined();
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((p: any) => p.id === 'tapped_land')?.tapped).toBe(true);
  });

  it('does not untap when the active player has skip-next-untap flag during phase skip scan', () => {
    const gameId = 'phase_skip_player_skip_untap';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    markPlayerSkipsNextUntapStep(game, p1);

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turn = 2;
    (game.state as any).battlefield = [
      {
        id: 'tapped_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'upkeep_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Test Upkeep Draw',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, draw a card.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.untapStepActionPerformed).toBe(true);
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((p: any) => p.id === 'tapped_land')?.tapped).toBe(true);
  });

  it('stops at END_COMBAT when skipping MAIN1 toward MAIN2', () => {
    const gameId = 'phase_skip_main1_end_combat';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'end_combat_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Conditional End Combat',
          oracle_text: 'At end of combat, if you control a creature, draw a card.',
        },
      },
      {
        id: 'bear_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'precombatMain',
      skipOriginStep: 'MAIN1',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('END_COMBAT');
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
  });

  it('stops at UPKEEP when skipping from UPKEEP toward MAIN2', () => {
    const gameId = 'phase_skip_upkeep_upkeep';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'arena_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Phyrexian Arena',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('UPKEEP');
  });

  it('stops at MAIN2 when skipping MAIN1 toward MAIN2 with postcombat trigger', () => {
    const gameId = 'phase_skip_main1_postcombat';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'savior_perm',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          name: 'Savior of the Small',
          type_line: 'Creature — Kithkin Soldier',
          oracle_text:
            'At the beginning of your second main phase, if this creature is tapped, return target creature card with mana value 3 or less from your graveyard to your hand.',
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      skipOriginPhase: 'precombatMain',
      skipOriginStep: 'MAIN1',
    });

    expect(result).toBe('stopped');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('MAIN2');
  });

  it('does not re-fire begin-combat triggers when resuming after lastStopStep', () => {
    const gameId = 'phase_skip_begin_combat_no_refire';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).phase = 'combat';
    (game.state as any).step = 'BEGIN_COMBAT';
    (game.state as any).turnPlayer = p1;
    (game.state as any).stack = [];
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
      lastStopStep: 'BEGIN_COMBAT',
    };
    (game.state as any).battlefield = [
      {
        id: 'ouro_perm',
        controller: p1,
        owner: p1,
        basePower: 3,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
        },
      },
    ];

    const result = processPhaseSkipTriggerStops({
      game,
      gameId,
      playerId: p1,
      turnPlayer: p1,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      autoContinue: true,
    });

    expect(result).toBe('ready_to_complete');
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});
