export interface DungeonRoomDefinition {
  id: string;
  name: string;
  effect: string;
  next: string[];
}

export interface DungeonDefinition {
  id: string;
  name: string;
  entry: string;
  rooms: Record<string, DungeonRoomDefinition>;
}

export interface DungeonProgressState {
  dungeonId: string;
  dungeonName: string;
  roomIndex: number;
  currentRoomId: string;
  currentRoomName: string;
  currentRoomEffect: string;
  roomPath: string[];
}

const DUNGEON_DEFINITIONS: Record<string, DungeonDefinition> = {
  lost_mine: {
    id: 'lost_mine',
    name: 'Lost Mine of Phandelver',
    entry: 'cave_entrance',
    rooms: {
      cave_entrance: {
        id: 'cave_entrance',
        name: 'Cave Entrance',
        effect: 'Scry 1.',
        next: ['goblin_lair', 'mine_tunnels'],
      },
      goblin_lair: {
        id: 'goblin_lair',
        name: 'Goblin Lair',
        effect: 'Create a 1/1 red Goblin creature token.',
        next: ['storeroom', 'dark_pool'],
      },
      mine_tunnels: {
        id: 'mine_tunnels',
        name: 'Mine Tunnels',
        effect: 'Create a Treasure token.',
        next: ['dark_pool', 'fungi_cavern'],
      },
      storeroom: {
        id: 'storeroom',
        name: 'Storeroom',
        effect: 'Put a +1/+1 counter on target creature.',
        next: ['temple_of_dumathoin'],
      },
      dark_pool: {
        id: 'dark_pool',
        name: 'Dark Pool',
        effect: 'Each opponent loses 1 life and you gain 1 life.',
        next: ['temple_of_dumathoin'],
      },
      fungi_cavern: {
        id: 'fungi_cavern',
        name: 'Fungi Cavern',
        effect: 'Target creature gets -4/-0 until your next turn.',
        next: ['temple_of_dumathoin'],
      },
      temple_of_dumathoin: {
        id: 'temple_of_dumathoin',
        name: 'Temple of Dumathoin',
        effect: 'Draw a card.',
        next: [],
      },
    },
  },
  mad_mage: {
    id: 'mad_mage',
    name: 'Dungeon of the Mad Mage',
    entry: 'yawning_portal',
    rooms: {
      yawning_portal: {
        id: 'yawning_portal',
        name: 'Yawning Portal',
        effect: 'You gain 1 life.',
        next: ['dungeon_level'],
      },
      dungeon_level: {
        id: 'dungeon_level',
        name: 'Dungeon Level',
        effect: 'Scry 1.',
        next: ['goblin_bazaar', 'twisted_caverns'],
      },
      goblin_bazaar: {
        id: 'goblin_bazaar',
        name: 'Goblin Bazaar',
        effect: 'Create a Treasure token.',
        next: ['lost_level'],
      },
      twisted_caverns: {
        id: 'twisted_caverns',
        name: 'Twisted Caverns',
        effect: "Target creature can't attack until your next turn.",
        next: ['lost_level'],
      },
      lost_level: {
        id: 'lost_level',
        name: 'Lost Level',
        effect: 'Scry 2.',
        next: ['runestone_caverns', 'muirals_graveyard'],
      },
      runestone_caverns: {
        id: 'runestone_caverns',
        name: 'Runestone Caverns',
        effect: 'Exile the top two cards of your library. You may play them.',
        next: ['deep_mines'],
      },
      muirals_graveyard: {
        id: 'muirals_graveyard',
        name: "Muiral's Graveyard",
        effect: 'Create two 1/1 black Skeleton creature tokens.',
        next: ['deep_mines'],
      },
      deep_mines: {
        id: 'deep_mines',
        name: 'Deep Mines',
        effect: 'Scry 3.',
        next: ['mad_wizards_lair'],
      },
      mad_wizards_lair: {
        id: 'mad_wizards_lair',
        name: "Mad Wizard's Lair",
        effect: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        next: [],
      },
    },
  },
  tomb: {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    entry: 'trapped_entry',
    rooms: {
      trapped_entry: {
        id: 'trapped_entry',
        name: 'Trapped Entry',
        effect: 'Each player loses 1 life.',
        next: ['veils_of_fear', 'oubliette'],
      },
      veils_of_fear: {
        id: 'veils_of_fear',
        name: 'Veils of Fear',
        effect: 'Each player loses 2 life unless they discard a card.',
        next: ['sandfall_cell'],
      },
      sandfall_cell: {
        id: 'sandfall_cell',
        name: 'Sandfall Cell',
        effect: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        next: ['cradle_of_the_death_god'],
      },
      oubliette: {
        id: 'oubliette',
        name: 'Oubliette',
        effect: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        next: ['cradle_of_the_death_god'],
      },
      cradle_of_the_death_god: {
        id: 'cradle_of_the_death_god',
        name: 'Cradle of the Death God',
        effect: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        next: [],
      },
    },
  },
  undercity: {
    id: 'undercity',
    name: 'Undercity',
    entry: 'secret_entrance',
    rooms: {
      secret_entrance: {
        id: 'secret_entrance',
        name: 'Secret Entrance',
        effect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        next: ['forge', 'lost_well'],
      },
      forge: {
        id: 'forge',
        name: 'Forge',
        effect: 'Put two +1/+1 counters on target creature.',
        next: ['trap', 'arena'],
      },
      lost_well: {
        id: 'lost_well',
        name: 'Lost Well',
        effect: 'Scry 2.',
        next: ['arena', 'stash'],
      },
      trap: {
        id: 'trap',
        name: 'Trap!',
        effect: 'Target player loses 5 life.',
        next: ['archives'],
      },
      arena: {
        id: 'arena',
        name: 'Arena',
        effect: 'Goad target creature.',
        next: ['archives', 'catacombs'],
      },
      stash: {
        id: 'stash',
        name: 'Stash',
        effect: 'Create a Treasure token.',
        next: ['catacombs'],
      },
      archives: {
        id: 'archives',
        name: 'Archives',
        effect: 'Draw a card.',
        next: ['throne_of_the_dead_three'],
      },
      catacombs: {
        id: 'catacombs',
        name: 'Catacombs',
        effect: 'Create a 4/1 black Skeleton creature token with menace.',
        next: ['throne_of_the_dead_three'],
      },
      throne_of_the_dead_three: {
        id: 'throne_of_the_dead_three',
        name: 'Throne of the Dead Three',
        effect: 'Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.',
        next: [],
      },
    },
  },
};

function getNormalizedDungeonId(dungeonId: string): string {
  return String(dungeonId || '').trim().toLowerCase();
}

function getNormalizedRoomId(roomId: string): string {
  return String(roomId || '').trim().toLowerCase();
}

export function getDungeonDefinition(dungeonId: string): DungeonDefinition | undefined {
  return DUNGEON_DEFINITIONS[getNormalizedDungeonId(dungeonId)];
}

export function getDungeonNameById(dungeonId: string): string {
  return getDungeonDefinition(dungeonId)?.name || 'Lost Mine of Phandelver';
}

function buildDefaultRoomPath(dungeonId: string, depth: number): string[] {
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return [];

  const targetDepth = Math.max(0, Number(depth || 0));
  const roomPath: string[] = [dungeon.entry];
  let currentRoomId = dungeon.entry;

  for (let index = 0; index < targetDepth; index += 1) {
    const currentRoom = dungeon.rooms[currentRoomId];
    if (!currentRoom || currentRoom.next.length === 0) break;
    currentRoomId = currentRoom.next[0];
    roomPath.push(currentRoomId);
  }

  return roomPath;
}

function findDungeonRoomPath(dungeonId: string, targetRoomId: string): string[] {
  const dungeon = getDungeonDefinition(dungeonId);
  const normalizedTargetRoomId = getNormalizedRoomId(targetRoomId);
  if (!dungeon || !normalizedTargetRoomId || !dungeon.rooms[normalizedTargetRoomId]) return [];

  const queue: string[][] = [[dungeon.entry]];
  const seen = new Set<string>([dungeon.entry]);

  while (queue.length > 0) {
    const roomPath = queue.shift() as string[];
    const currentRoomId = roomPath[roomPath.length - 1];
    if (currentRoomId === normalizedTargetRoomId) {
      return roomPath;
    }

    const currentRoom = dungeon.rooms[currentRoomId];
    for (const nextRoomId of currentRoom?.next || []) {
      const branchKey = `${currentRoomId}->${nextRoomId}`;
      if (seen.has(branchKey)) continue;
      seen.add(branchKey);
      queue.push([...roomPath, nextRoomId]);
    }
  }

  return [dungeon.entry];
}

function buildDungeonProgressSnapshot(dungeonId: string, roomPath: string[]): DungeonProgressState | null {
  const dungeon = getDungeonDefinition(dungeonId);
  const validRoomPath = Array.isArray(roomPath)
    ? roomPath
        .map((roomId) => getNormalizedRoomId(roomId))
        .filter((roomId) => Boolean(dungeon?.rooms?.[roomId]))
    : [];

  if (!dungeon || validRoomPath.length === 0) return null;

  const currentRoomId = validRoomPath[validRoomPath.length - 1];
  const currentRoom = dungeon.rooms[currentRoomId];
  if (!currentRoom) return null;

  return {
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    roomIndex: Math.max(0, validRoomPath.length - 1),
    currentRoomId: currentRoom.id,
    currentRoomName: currentRoom.name,
    currentRoomEffect: currentRoom.effect,
    roomPath: validRoomPath,
  };
}

export function createDungeonProgress(dungeonId: string): DungeonProgressState | null {
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return null;
  return buildDungeonProgressSnapshot(dungeon.id, [dungeon.entry]);
}

export function normalizeDungeonProgress(progress: any): DungeonProgressState | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;

  const dungeonId = getNormalizedDungeonId(String(progress.dungeonId || ''));
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return null;

  const explicitRoomPath = Array.isArray(progress.roomPath)
    ? progress.roomPath.map((roomId: any) => getNormalizedRoomId(String(roomId || ''))).filter((roomId: string) => Boolean(dungeon.rooms[roomId]))
    : [];
  if (explicitRoomPath.length > 0) {
    return buildDungeonProgressSnapshot(dungeonId, explicitRoomPath);
  }

  const explicitCurrentRoomId = getNormalizedRoomId(String(progress.currentRoomId || ''));
  if (explicitCurrentRoomId && dungeon.rooms[explicitCurrentRoomId]) {
    return buildDungeonProgressSnapshot(dungeonId, findDungeonRoomPath(dungeonId, explicitCurrentRoomId));
  }

  return buildDungeonProgressSnapshot(
    dungeonId,
    buildDefaultRoomPath(dungeonId, Math.max(0, Number(progress.roomIndex || 0))),
  );
}

export function getDungeonNextRoomOptions(progress: any): DungeonRoomDefinition[] {
  const normalizedProgress = normalizeDungeonProgress(progress);
  const dungeon = normalizedProgress ? getDungeonDefinition(normalizedProgress.dungeonId) : undefined;
  const currentRoom = normalizedProgress && dungeon ? dungeon.rooms[normalizedProgress.currentRoomId] : undefined;
  if (!normalizedProgress || !dungeon || !currentRoom) return [];

  return currentRoom.next
    .map((roomId) => dungeon.rooms[roomId])
    .filter((room): room is DungeonRoomDefinition => Boolean(room));
}

export function advanceDungeonProgress(
  progress: any,
  selectedNextRoomId?: string,
): {
  progress: DungeonProgressState | null;
  completed: boolean;
  choiceRequired: DungeonRoomDefinition[];
} {
  const normalizedProgress = normalizeDungeonProgress(progress);
  if (!normalizedProgress) {
    return { progress: null, completed: false, choiceRequired: [] };
  }

  const nextRoomOptions = getDungeonNextRoomOptions(normalizedProgress);
  if (nextRoomOptions.length === 0) {
    return { progress: normalizedProgress, completed: true, choiceRequired: [] };
  }

  if (nextRoomOptions.length > 1) {
    const normalizedSelectedNextRoomId = getNormalizedRoomId(String(selectedNextRoomId || ''));
    if (!normalizedSelectedNextRoomId) {
      return { progress: normalizedProgress, completed: false, choiceRequired: nextRoomOptions };
    }

    const selectedRoom = nextRoomOptions.find((room) => room.id === normalizedSelectedNextRoomId);
    if (!selectedRoom) {
      return { progress: normalizedProgress, completed: false, choiceRequired: nextRoomOptions };
    }

    const advancedProgress = buildDungeonProgressSnapshot(
      normalizedProgress.dungeonId,
      [...normalizedProgress.roomPath, normalizedSelectedNextRoomId],
    );
    return {
      progress: advancedProgress,
      completed: getDungeonNextRoomOptions(advancedProgress).length === 0,
      choiceRequired: [],
    };
  }

  const advancedProgress = buildDungeonProgressSnapshot(
    normalizedProgress.dungeonId,
    [...normalizedProgress.roomPath, nextRoomOptions[0].id],
  );
  return {
    progress: advancedProgress,
    completed: getDungeonNextRoomOptions(advancedProgress).length === 0,
    choiceRequired: [],
  };
}

export function markDungeonCompleted(stateAny: any, playerId: string, dungeonName: string): void {
  stateAny.completedDungeons = stateAny.completedDungeons || {};
  stateAny.completedDungeons[playerId] = (stateAny.completedDungeons[playerId] || 0) + 1;

  stateAny.completedDungeonThisTurn = stateAny.completedDungeonThisTurn || {};
  stateAny.completedDungeonThisTurn[playerId] = true;

  stateAny.dungeonCompletedThisTurn = stateAny.dungeonCompletedThisTurn || {};
  stateAny.dungeonCompletedThisTurn[playerId] = true;

  stateAny.completedDungeon = stateAny.completedDungeon || {};
  stateAny.completedDungeon[playerId] = true;

  stateAny.dungeonCompleted = stateAny.dungeonCompleted || {};
  stateAny.dungeonCompleted[playerId] = true;

  const normalizedDungeonName = String(dungeonName || '').trim();
  if (!normalizedDungeonName) return;

  const nameLower = normalizedDungeonName.toLowerCase();
  const pidKey = String(playerId);

  stateAny.completedDungeonNameList = stateAny.completedDungeonNameList || {};
  stateAny.completedDungeonNames = stateAny.completedDungeonNames || {};
  stateAny.completedDungeonsByName = stateAny.completedDungeonsByName || {};
  stateAny.completedDungeonNameList[pidKey] = Array.isArray(stateAny.completedDungeonNameList[pidKey])
    ? stateAny.completedDungeonNameList[pidKey]
    : [];
  stateAny.completedDungeonNames[pidKey] = Array.isArray(stateAny.completedDungeonNames[pidKey])
    ? stateAny.completedDungeonNames[pidKey]
    : [];
  stateAny.completedDungeonsByName[pidKey] = Array.isArray(stateAny.completedDungeonsByName[pidKey])
    ? stateAny.completedDungeonsByName[pidKey]
    : [];
  stateAny.completedDungeonNameList[pidKey].push(normalizedDungeonName);
  stateAny.completedDungeonNames[pidKey].push(normalizedDungeonName);
  stateAny.completedDungeonsByName[pidKey].push(normalizedDungeonName);

  stateAny.completedDungeonNamesMap = stateAny.completedDungeonNamesMap || {};
  stateAny.completedDungeonsByNameMap = stateAny.completedDungeonsByNameMap || {};
  stateAny.completedDungeonNamesMap[pidKey] =
    stateAny.completedDungeonNamesMap[pidKey] && typeof stateAny.completedDungeonNamesMap[pidKey] === 'object'
      ? stateAny.completedDungeonNamesMap[pidKey]
      : {};
  stateAny.completedDungeonsByNameMap[pidKey] =
    stateAny.completedDungeonsByNameMap[pidKey] && typeof stateAny.completedDungeonsByNameMap[pidKey] === 'object'
      ? stateAny.completedDungeonsByNameMap[pidKey]
      : {};
  stateAny.completedDungeonNamesMap[pidKey][nameLower] = true;
  stateAny.completedDungeonsByNameMap[pidKey][nameLower] =
    (stateAny.completedDungeonsByNameMap[pidKey][nameLower] || 0) + 1;
}