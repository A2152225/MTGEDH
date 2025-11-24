/**
 * Rule 701.49: Venture into the Dungeon
 * 
 * If a player is instructed to venture into the dungeon, they choose a dungeon
 * card and progress through it.
 * 
 * Reference: Rule 701.49, also see Rule 309 "Dungeons"
 */

export interface VentureAction {
  readonly type: 'venture-into-dungeon';
  readonly playerId: string;
  readonly dungeonName?: string;
  readonly currentRoom?: string;
  readonly nextRoom?: string;
  readonly completedDungeon?: boolean;
}

/**
 * Rule 701.49a: No dungeon in command zone
 */
export function ventureFirstTime(
  playerId: string,
  dungeonName: string
): VentureAction {
  return {
    type: 'venture-into-dungeon',
    playerId,
    dungeonName,
    currentRoom: 'entrance',
  };
}

/**
 * Rule 701.49b: Move to adjacent room
 */
export function ventureToNextRoom(
  playerId: string,
  dungeonName: string,
  currentRoom: string,
  nextRoom: string
): VentureAction {
  return {
    type: 'venture-into-dungeon',
    playerId,
    dungeonName,
    currentRoom,
    nextRoom,
  };
}

/**
 * Rule 701.49c: Complete dungeon
 */
export function ventureCompleteDungeon(
  playerId: string,
  completedDungeonName: string,
  newDungeonName: string
): VentureAction {
  return {
    type: 'venture-into-dungeon',
    playerId,
    dungeonName: newDungeonName,
    completedDungeon: true,
  };
}

/**
 * Rule 701.49d: Venture into [quality]
 */
export function ventureIntoQuality(
  playerId: string,
  quality: string,
  dungeonName: string
): VentureAction {
  return {
    type: 'venture-into-dungeon',
    playerId,
    dungeonName,
  };
}
