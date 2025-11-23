/**
 * Tests for Rules 101-104: Game Flow and Golden Rules
 */
import { describe, it, expect } from 'vitest';
import {
  cantBeatsCan,
  getAPNAPOrder,
  Player,
  getOpponent,
  getTeammates,
  getOpponents,
  StartingLifeTotal,
  MulliganState,
  takeMulligan,
  keepHand,
  isFreeMulligan,
  getFirstTurnRules,
  GameEndReason,
  WinCondition,
  LoseCondition,
  checkLifeTotalLoss,
  hasLostDueToEmptyLibrary,
  hasLostDueToPoison,
  hasLostDueToCommanderDamage,
  checkPlayerLoss,
  resolveSimultaneousWinLose,
  checkSimultaneousLoss,
  PlayerLossCheck
} from '../src/types/gameFlow';

describe('Rule 101: The Magic Golden Rules', () => {
  describe('Rule 101.2 - "Can\'t" beats "Can"', () => {
    it('should prioritize "can\'t" over "can"', () => {
      expect(cantBeatsCan(true, true)).toBe(false);  // Both effects: can't wins
      expect(cantBeatsCan(true, false)).toBe(true);  // Only can: proceeds
      expect(cantBeatsCan(false, true)).toBe(false); // Only can't: prevented
      expect(cantBeatsCan(false, false)).toBe(false); // Neither: doesn't happen
    });
  });

  describe('Rule 101.4 - APNAP Order', () => {
    it('should determine APNAP order correctly', () => {
      const players = ['player-1', 'player-2', 'player-3', 'player-4'];
      const order = getAPNAPOrder('player-2', players);
      
      expect(order.activePlayer).toBe('player-2');
      expect(order.nonactivePlayers).toEqual(['player-1', 'player-3', 'player-4']);
    });

    it('should handle two-player APNAP', () => {
      const players = ['player-1', 'player-2'];
      const order = getAPNAPOrder('player-1', players);
      
      expect(order.activePlayer).toBe('player-1');
      expect(order.nonactivePlayers).toEqual(['player-2']);
    });
  });
});

describe('Rule 102: Players', () => {
  describe('Rule 102.2 - Two-player opponent', () => {
    it('should identify opponent in two-player game', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0 },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1 }
      ];

      const opponent = getOpponent('p1', players);
      expect(opponent?.id).toBe('p2');
    });

    it('should return null for non-two-player game', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0 },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1 },
        { id: 'p3', name: 'Charlie', isActive: false, seat: 2 }
      ];

      const opponent = getOpponent('p1', players);
      expect(opponent).toBeNull();
    });
  });

  describe('Rule 102.3 - Teammates and opponents in multiplayer', () => {
    it('should identify teammates', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0, team: 'A' },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1, team: 'A' },
        { id: 'p3', name: 'Charlie', isActive: false, seat: 2, team: 'B' },
        { id: 'p4', name: 'Diana', isActive: false, seat: 3, team: 'B' }
      ];

      const teammates = getTeammates('p1', players);
      expect(teammates).toHaveLength(1);
      expect(teammates[0].id).toBe('p2');
    });

    it('should identify opponents in team game', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0, team: 'A' },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1, team: 'A' },
        { id: 'p3', name: 'Charlie', isActive: false, seat: 2, team: 'B' },
        { id: 'p4', name: 'Diana', isActive: false, seat: 3, team: 'B' }
      ];

      const opponents = getOpponents('p1', players);
      expect(opponents).toHaveLength(2);
      expect(opponents.map(p => p.id)).toContain('p3');
      expect(opponents.map(p => p.id)).toContain('p4');
    });

    it('should identify all opponents in non-team multiplayer', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0 },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1 },
        { id: 'p3', name: 'Charlie', isActive: false, seat: 2 }
      ];

      const opponents = getOpponents('p1', players);
      expect(opponents).toHaveLength(2);
    });
  });
});

describe('Rule 103: Starting the Game', () => {
  describe('Rule 103.4 - Starting life totals', () => {
    it('should define all variant starting life totals', () => {
      expect(StartingLifeTotal.STANDARD).toBe(20);
      expect(StartingLifeTotal.TWO_HEADED_GIANT).toBe(30);
      expect(StartingLifeTotal.COMMANDER).toBe(40);
      expect(StartingLifeTotal.BRAWL_TWO_PLAYER).toBe(25);
      expect(StartingLifeTotal.BRAWL_MULTIPLAYER).toBe(30);
      expect(StartingLifeTotal.ARCHENEMY).toBe(40);
    });
  });

  describe('Rule 103.5 - Mulligan process', () => {
    it('should track mulligans correctly', () => {
      let state: MulliganState = {
        playerId: 'p1',
        mulligansTaken: 0,
        currentHandSize: 7,
        hasKeptHand: false
      };

      state = takeMulligan(state, 7);
      expect(state.mulligansTaken).toBe(1);
      expect(state.hasKeptHand).toBe(false);
    });

    it('should handle keeping hand', () => {
      let state: MulliganState = {
        playerId: 'p1',
        mulligansTaken: 1,
        currentHandSize: 7,
        hasKeptHand: false
      };

      state = keepHand(state, state.mulligansTaken);
      expect(state.hasKeptHand).toBe(true);
      expect(state.currentHandSize).toBe(6); // 7 - 1 mulligan
    });
  });

  describe('Rule 103.5c - Free mulligan in multiplayer', () => {
    it('should identify free mulligan', () => {
      expect(isFreeMulligan(0, true)).toBe(true);   // First mulligan in multiplayer
      expect(isFreeMulligan(1, true)).toBe(false);  // Second mulligan
      expect(isFreeMulligan(0, false)).toBe(false); // Two-player game
    });
  });

  describe('Rule 103.8 - First turn rules', () => {
    it('should skip draw in two-player game', () => {
      const rules = getFirstTurnRules(2, false);
      expect(rules.startingPlayerSkipsDrawStep).toBe(true);
    });

    it('should skip draw in Two-Headed Giant', () => {
      const rules = getFirstTurnRules(4, true);
      expect(rules.twoHeadedGiantSkipsDrawStep).toBe(true);
    });

    it('should not skip draw in multiplayer', () => {
      const rules = getFirstTurnRules(4, false);
      expect(rules.startingPlayerSkipsDrawStep).toBe(false);
      expect(rules.multiplayerSkipsDrawStep).toBe(false);
    });
  });
});

describe('Rule 104: Ending the Game', () => {
  describe('Rule 104.2 - Ways to win', () => {
    it('should define win conditions', () => {
      expect(WinCondition.OPPONENTS_LEFT).toBe('opponents_left');
      expect(WinCondition.EFFECT_STATES_WIN).toBe('effect_states_win');
      expect(WinCondition.TEAM_WIN).toBe('team_win');
    });
  });

  describe('Rule 104.3 - Ways to lose', () => {
    it('should define all lose conditions', () => {
      expect(LoseCondition.CONCEDE).toBe('concede');
      expect(LoseCondition.ZERO_LIFE).toBe('zero_life');
      expect(LoseCondition.LIBRARY_EMPTY).toBe('library_empty');
      expect(LoseCondition.POISON_COUNTERS).toBe('poison_counters');
      expect(LoseCondition.COMMANDER_DAMAGE).toBe('commander_damage');
    });
  });

  describe('Rule 104.3b - Zero or less life', () => {
    it('should detect loss due to life', () => {
      expect(checkLifeTotalLoss(0)).toBe(true);
      expect(checkLifeTotalLoss(-5)).toBe(true);
      expect(checkLifeTotalLoss(1)).toBe(false);
    });
  });

  describe('Rule 104.3c - Empty library', () => {
    it('should detect loss due to drawing from empty library', () => {
      expect(hasLostDueToEmptyLibrary(0, 1)).toBe(true);
      expect(hasLostDueToEmptyLibrary(1, 2)).toBe(true);
      expect(hasLostDueToEmptyLibrary(5, 3)).toBe(false);
    });
  });

  describe('Rule 104.3d - Poison counters', () => {
    it('should detect loss at 10 poison counters', () => {
      expect(hasLostDueToPoison(10)).toBe(true);
      expect(hasLostDueToPoison(11)).toBe(true);
      expect(hasLostDueToPoison(9)).toBe(false);
    });
  });

  describe('Rule 104.3j - Commander damage', () => {
    it('should detect loss at 21 commander damage', () => {
      const damage = new Map<string, number>();
      damage.set('commander-1', 21);
      
      expect(hasLostDueToCommanderDamage(damage)).toBe(true);
    });

    it('should not trigger below 21 damage', () => {
      const damage = new Map<string, number>();
      damage.set('commander-1', 20);
      damage.set('commander-2', 15);
      
      expect(hasLostDueToCommanderDamage(damage)).toBe(false);
    });

    it('should track damage from multiple commanders', () => {
      const damage = new Map<string, number>();
      damage.set('commander-1', 10);
      damage.set('commander-2', 22);
      
      expect(hasLostDueToCommanderDamage(damage)).toBe(true);
    });
  });

  describe('State-based loss checks', () => {
    it('should check all loss conditions', () => {
      const check: PlayerLossCheck = {
        playerId: 'p1',
        lifeTotal: 0,
        poisonCounters: 5,
        librarySize: 10
      };

      expect(checkPlayerLoss(check)).toBe(LoseCondition.ZERO_LIFE);
    });

    it('should prioritize life check first', () => {
      const check: PlayerLossCheck = {
        playerId: 'p1',
        lifeTotal: -1,
        poisonCounters: 10,
        librarySize: 0
      };

      expect(checkPlayerLoss(check)).toBe(LoseCondition.ZERO_LIFE);
    });

    it('should detect poison loss', () => {
      const check: PlayerLossCheck = {
        playerId: 'p1',
        lifeTotal: 20,
        poisonCounters: 10,
        librarySize: 10
      };

      expect(checkPlayerLoss(check)).toBe(LoseCondition.POISON_COUNTERS);
    });
  });

  describe('Rule 104.3f - Win and lose simultaneously', () => {
    it('should make player lose when both win and lose', () => {
      expect(resolveSimultaneousWinLose(true, true)).toBe('lose');
    });

    it('should make player win when only winning', () => {
      expect(resolveSimultaneousWinLose(true, false)).toBe('win');
    });

    it('should make player lose when only losing', () => {
      expect(resolveSimultaneousWinLose(false, true)).toBe('lose');
    });

    it('should continue when neither', () => {
      expect(resolveSimultaneousWinLose(false, false)).toBe('continue');
    });
  });

  describe('Rule 104.4a - All players lose simultaneously', () => {
    it('should detect draw when all players lose', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0 },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1 }
      ];

      const lostPlayers = new Set(['p1', 'p2']);
      
      expect(checkSimultaneousLoss(players, lostPlayers)).toBe(true);
    });

    it('should not be draw if some players remain', () => {
      const players: Player[] = [
        { id: 'p1', name: 'Alice', isActive: true, seat: 0 },
        { id: 'p2', name: 'Bob', isActive: false, seat: 1 }
      ];

      const lostPlayers = new Set(['p1']);
      
      expect(checkSimultaneousLoss(players, lostPlayers)).toBe(false);
    });
  });

  describe('Game end reasons', () => {
    it('should define all end reasons', () => {
      expect(GameEndReason.PLAYER_WIN).toBe('player_win');
      expect(GameEndReason.TEAM_WIN).toBe('team_win');
      expect(GameEndReason.DRAW).toBe('draw');
      expect(GameEndReason.RESTART).toBe('restart');
    });
  });
});
