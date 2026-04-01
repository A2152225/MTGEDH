import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { detectCombatDamageTriggers } from '../src/state/modules/triggered-abilities';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function importSampleDeck(game: any, playerId: PlayerID, prefix: string) {
  const sampleDeck = Array.from({ length: 20 }, (_, index) => ({
    id: `${prefix}_${index}`,
    name: `Sample ${prefix} ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  game.importDeckResolved(playerId, sampleDeck);
}

function setupToMain1(game: any, players: PlayerID[]) {
  game.applyEvent({ type: 'nextTurn' });
  for (const playerId of players) {
    importSampleDeck(game, playerId, String(playerId));
  }

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
}

describe('Combat-damage-to-you regressions', () => {
  it('recognizes and resolves Swarmborn Giant combat-damage-to-you triggers', () => {
    const game = createInitialGameState('combat_damage_to_you_swarmborn');
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p2, 'P2');

    const swarmborn = {
      id: 'swarmborn_1',
      controller: p2,
      owner: p2,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 6,
      baseToughness: 6,
      card: {
        id: 'swarmborn_card_1',
        name: 'Swarmborn Giant',
        type_line: 'Creature — Giant',
        oracle_text: "When you're dealt combat damage, sacrifice this creature.",
        power: '6',
        toughness: '6',
      },
    };

    (game.state.battlefield as any[]).push(swarmborn as any);

    const detected = detectCombatDamageTriggers((swarmborn as any).card, swarmborn as any);
    expect(detected.some((trigger: any) => trigger?.triggerType === 'you_are_dealt_combat_damage')).toBe(true);

    (game.state as any).stack = [
      {
        id: 'swarmborn_trigger',
        type: 'triggered_ability',
        controller: p2,
        source: 'swarmborn_1',
        permanentId: 'swarmborn_1',
        sourceName: 'Swarmborn Giant',
        description: 'Sacrifice this creature.',
        effect: 'Sacrifice this creature.',
        triggerType: 'you_are_dealt_combat_damage',
        mandatory: true,
        targets: [],
      },
    ];

    game.resolveTopOfStack();

    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'swarmborn_1')).toBe(false);
    expect((((game.state as any).zones?.[p2]?.graveyard || []) as any[]).some((card: any) => card?.name === 'Swarmborn Giant')).toBe(true);
  });

  it('queues and resolves Contested Game Ball when its controller is dealt combat damage', () => {
    const game = createInitialGameState('combat_damage_to_you_contested_ball');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    setupToMain1(game, [p1, p2]);

    const attacker = {
      id: 'attacker_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 2,
      baseToughness: 2,
      attacking: p2,
      blockedBy: [],
      card: {
        id: 'attacker_card_1',
        name: 'Test Attacker',
        type_line: 'Creature — Human',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    };
    const gameBall = {
      id: 'game_ball_1',
      controller: p2,
      owner: p2,
      tapped: true,
      counters: {},
      summoningSickness: false,
      card: {
        id: 'game_ball_card_1',
        name: 'Contested Game Ball',
        type_line: 'Artifact',
        oracle_text: "Whenever you're dealt combat damage, the attacking player gains control of this artifact and untaps it.",
      },
    };

    (game.state.battlefield as any[]).push(attacker as any, gameBall as any);

    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });
    (attacker as any).attacking = p2;
    (attacker as any).blockedBy = [];
    game.applyEvent({ type: 'nextStep' });

    const trigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.source === 'game_ball_1'
    );
    expect(trigger).toBeTruthy();

    game.resolveTopOfStack();

    const permanent = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'game_ball_1');
    expect(permanent?.controller).toBe(p1);
    expect(permanent?.tapped).toBe(false);
  });

  it('queues Darien with the full combat damage amount and creates that many Soldiers on resolution', () => {
    const game = createInitialGameState('combat_damage_to_you_darien');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    setupToMain1(game, [p1, p2]);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 6,
      baseToughness: 6,
      attacking: defending,
      blockedBy: [],
      card: {
        id: 'attacker_card_1',
        name: 'Test Attacker',
        type_line: 'Creature — Human',
        oracle_text: '',
        power: '6',
        toughness: '6',
      },
    };
    const darien = {
      id: 'darien_1',
      controller: defending,
      owner: defending,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 3,
      baseToughness: 3,
      card: {
        id: 'darien_card_1',
        name: 'Darien, King of Kjeldor',
        type_line: 'Legendary Creature — Human Soldier',
        oracle_text: "Whenever you're dealt damage, you may create that many 1/1 white Soldier creature tokens.",
        power: '3',
        toughness: '3',
      },
    };

    (game.state.battlefield as any[]).push(attacker as any, darien as any);

    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });
    (attacker as any).attacking = defending;
    (attacker as any).blockedBy = [];
    game.applyEvent({ type: 'nextStep' });

    const trigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.source === 'darien_1'
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.triggerType).toBe('you_are_dealt_damage');
    expect(trigger?.damageAmount).toBe(6);

    game.resolveTopOfStack();

    const soldierTokens = ((game.state as any).battlefield || []).filter(
      (perm: any) => perm?.controller === defending && perm?.isToken === true && perm?.card?.name === 'Soldier'
    );
    expect(soldierTokens).toHaveLength(6);
  });
});
