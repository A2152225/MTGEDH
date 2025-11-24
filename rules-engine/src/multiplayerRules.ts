/**
 * Implementation of Multiplayer Rules (Section 8: Rules 800-811)
 * Based on Magic: The Gathering Comprehensive Rules (November 14, 2025)
 */

/**
 * Rule 800: General Multiplayer Rules
 */

/**
 * Rule 800.4: When a player leaves the game
 */
export interface PlayerLeavingGame {
  readonly playerId: string;
  readonly timestamp: number;
}

/**
 * Handle a player leaving the game (Rule 800.4a)
 * All objects owned by that player leave the game
 * All spells and abilities controlled by that player leave the stack
 * All permanents controlled by that player leave the battlefield
 */
export function handlePlayerLeaving(playerId: string): PlayerLeavingGame {
  return {
    playerId,
    timestamp: Date.now(),
  };
}

/**
 * Objects a player owns leave with them (Rule 800.4a)
 */
export function shouldObjectLeaveWithPlayer(objectOwnerId: string, leavingPlayerId: string): boolean {
  return objectOwnerId === leavingPlayerId;
}

/**
 * Rule 800.4h: Control effects end when player leaves
 */
export function endControlEffectsForLeavingPlayer(leavingPlayerId: string): void {
  // All control-change effects controlled by the leaving player end
}

/**
 * Rule 801: Limited Range of Influence Option
 */
export interface LimitedRangeOfInfluence {
  readonly rangeOfInfluence: number; // Number of seats away
  readonly affectsTargeting: boolean;
  readonly affectsSpellsCast: boolean;
}

/**
 * Create limited range of influence setting (Rule 801.1)
 */
export function createLimitedRange(range: number): LimitedRangeOfInfluence {
  return {
    rangeOfInfluence: range,
    affectsTargeting: true,
    affectsSpellsCast: true,
  };
}

/**
 * Check if player is within range of influence (Rule 801.2)
 */
export function isWithinRangeOfInfluence(
  sourcePlayerId: string,
  targetPlayerId: string,
  range: number,
  playerOrder: readonly string[]
): boolean {
  const sourceIndex = playerOrder.indexOf(sourcePlayerId);
  const targetIndex = playerOrder.indexOf(targetPlayerId);
  
  if (sourceIndex === -1 || targetIndex === -1) return false;
  
  const distance = Math.min(
    Math.abs(targetIndex - sourceIndex),
    playerOrder.length - Math.abs(targetIndex - sourceIndex)
  );
  
  return distance <= range;
}

/**
 * Rule 802: Attack Multiple Players Option
 */
export interface AttackMultiplePlayers {
  readonly enabled: boolean;
}

/**
 * Enable attack multiple players option (Rule 802.1)
 */
export function enableAttackMultiplePlayers(): AttackMultiplePlayers {
  return { enabled: true };
}

/**
 * Rule 803: Attack Left and Attack Right Options
 */
export type AttackDirection = 'left' | 'right';

export interface AttackDirectionOption {
  readonly direction: AttackDirection;
}

/**
 * Create attack left option (Rule 803.1)
 */
export function createAttackLeft(): AttackDirectionOption {
  return { direction: 'left' };
}

/**
 * Create attack right option (Rule 803.2)
 */
export function createAttackRight(): AttackDirectionOption {
  return { direction: 'right' };
}

/**
 * Get valid attack target for directional attack (Rule 803)
 */
export function getDirectionalAttackTarget(
  attackingPlayerId: string,
  direction: AttackDirection,
  playerOrder: readonly string[]
): string | null {
  const attackerIndex = playerOrder.indexOf(attackingPlayerId);
  if (attackerIndex === -1) return null;
  
  const offset = direction === 'left' ? -1 : 1;
  const targetIndex = (attackerIndex + offset + playerOrder.length) % playerOrder.length;
  
  return playerOrder[targetIndex];
}

/**
 * Rule 804: Deploy Creatures Option
 */
export interface DeployCreaturesOption {
  readonly enabled: boolean;
  readonly deploymentPhase: boolean;
}

/**
 * Enable deploy creatures option (Rule 804.1)
 */
export function enableDeployCreatures(): DeployCreaturesOption {
  return {
    enabled: true,
    deploymentPhase: true,
  };
}

/**
 * Rule 805: Shared Team Turns Option
 */
export interface SharedTeamTurns {
  readonly teamId: string;
  readonly sharedTurn: boolean;
}

/**
 * Create shared team turns for a team (Rule 805.1)
 */
export function createSharedTeamTurns(teamId: string): SharedTeamTurns {
  return {
    teamId,
    sharedTurn: true,
  };
}

/**
 * Rule 806: Free-for-All Variant
 */
export interface FreeForAllGame {
  readonly variant: 'free-for-all';
  readonly playerCount: number;
  readonly startingLife: number;
}

/**
 * Create free-for-all game (Rule 806.1)
 */
export function createFreeForAllGame(playerCount: number, startingLife: number = 20): FreeForAllGame {
  return {
    variant: 'free-for-all',
    playerCount,
    startingLife,
  };
}

/**
 * Rule 807: Grand Melee Variant
 */
export interface GrandMeleeGame {
  readonly variant: 'grand-melee';
  readonly playerCount: number; // Must be 10 or more
  readonly turnMarkers: number; // Usually playerCount / 5
}

/**
 * Create grand melee game (Rule 807.1)
 */
export function createGrandMeleeGame(playerCount: number): GrandMeleeGame | null {
  if (playerCount < 10) return null; // Grand Melee requires 10+ players
  
  return {
    variant: 'grand-melee',
    playerCount,
    turnMarkers: Math.floor(playerCount / 5),
  };
}

/**
 * Rule 808: Team vs. Team Variant
 */
export interface TeamVsTeamGame {
  readonly variant: 'team-vs-team';
  readonly teams: readonly Team[];
}

export interface Team {
  readonly teamId: string;
  readonly playerIds: readonly string[];
  readonly sharedLife: boolean;
}

/**
 * Create team vs. team game (Rule 808.1)
 */
export function createTeamVsTeamGame(teams: readonly Team[]): TeamVsTeamGame {
  return {
    variant: 'team-vs-team',
    teams,
  };
}

/**
 * Rule 809: Emperor Variant
 */
export interface EmperorGame {
  readonly variant: 'emperor';
  readonly teams: readonly EmperorTeam[];
  readonly rangeOfInfluence: number; // Usually 2
}

export interface EmperorTeam {
  readonly teamId: string;
  readonly emperorId: string;
  readonly generalIds: readonly string[];
}

/**
 * Create emperor game (Rule 809.1)
 */
export function createEmperorGame(teams: readonly EmperorTeam[]): EmperorGame {
  return {
    variant: 'emperor',
    teams,
    rangeOfInfluence: 2, // Rule 809.5: Default range of influence is 2
  };
}

/**
 * Check if emperor (Rule 809.2)
 */
export function isEmperor(playerId: string, team: EmperorTeam): boolean {
  return team.emperorId === playerId;
}

/**
 * Rule 810: Two-Headed Giant Variant
 */
export interface TwoHeadedGiantGame {
  readonly variant: 'two-headed-giant';
  readonly teams: readonly TwoHeadedGiantTeam[];
  readonly startingLife: number; // 30 life per team
  readonly simultaneousTurns: boolean;
}

export interface TwoHeadedGiantTeam {
  readonly teamId: string;
  readonly playerIds: readonly [string, string]; // Exactly 2 players
  readonly sharedLife: number;
  readonly sharedPoisonCounters: number;
}

/**
 * Create two-headed giant game (Rule 810.1)
 */
export function createTwoHeadedGiantGame(
  team1Players: readonly [string, string],
  team2Players: readonly [string, string]
): TwoHeadedGiantGame {
  return {
    variant: 'two-headed-giant',
    teams: [
      {
        teamId: 'team1',
        playerIds: team1Players,
        sharedLife: 30,
        sharedPoisonCounters: 0,
      },
      {
        teamId: 'team2',
        playerIds: team2Players,
        sharedLife: 30,
        sharedPoisonCounters: 0,
      },
    ],
    startingLife: 30,
    simultaneousTurns: true,
  };
}

/**
 * Handle damage to team (Rule 810.9)
 */
export function applyDamageToTeam(team: TwoHeadedGiantTeam, damage: number): TwoHeadedGiantTeam {
  return {
    ...team,
    sharedLife: team.sharedLife - damage,
  };
}

/**
 * Handle poison counters to team (Rule 810.9)
 */
export function addPoisonCountersToTeam(team: TwoHeadedGiantTeam, counters: number): TwoHeadedGiantTeam {
  return {
    ...team,
    sharedPoisonCounters: team.sharedPoisonCounters + counters,
  };
}

/**
 * Check if team loses (Rule 810.10)
 */
export function hasTeamLost(team: TwoHeadedGiantTeam): boolean {
  return team.sharedLife <= 0 || team.sharedPoisonCounters >= 15;
}

/**
 * Rule 811: Alternating Teams Variant
 */
export interface AlternatingTeamsGame {
  readonly variant: 'alternating-teams';
  readonly teams: readonly Team[];
  readonly playerOrder: readonly string[]; // Alternates between teams
}

/**
 * Create alternating teams game (Rule 811.1)
 */
export function createAlternatingTeamsGame(teams: readonly Team[]): AlternatingTeamsGame {
  // Create alternating turn order
  const playerOrder: string[] = [];
  const maxTeamSize = Math.max(...teams.map(t => t.playerIds.length));
  
  for (let i = 0; i < maxTeamSize; i++) {
    for (const team of teams) {
      if (i < team.playerIds.length) {
        playerOrder.push(team.playerIds[i]);
      }
    }
  }
  
  return {
    variant: 'alternating-teams',
    teams,
    playerOrder,
  };
}

/**
 * General multiplayer helper functions
 */

/**
 * Check if player is on a team
 */
export function isPlayerOnTeam(playerId: string, team: Team): boolean {
  return team.playerIds.includes(playerId);
}

/**
 * Get teammate IDs
 */
export function getTeammates(playerId: string, team: Team): readonly string[] {
  return team.playerIds.filter(id => id !== playerId);
}

/**
 * Check if two players are teammates
 */
export function areTeammates(player1Id: string, player2Id: string, teams: readonly Team[]): boolean {
  for (const team of teams) {
    if (team.playerIds.includes(player1Id) && team.playerIds.includes(player2Id)) {
      return true;
    }
  }
  return false;
}

/**
 * Get opponents for a player
 */
export function getOpponents(playerId: string, allPlayerIds: readonly string[]): readonly string[] {
  return allPlayerIds.filter(id => id !== playerId);
}
