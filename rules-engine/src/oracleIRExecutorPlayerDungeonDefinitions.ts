// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: DungeonRoomDefinition, DungeonDefinition, DUNGEON_DEFINITIONS,
// getDungeonDefinition, getDungeonRoomDefinition, getDefaultDungeonPath,
// getDungeonRoomDefinitionByProgress.
// Public entries: getDungeonDefinition, getDungeonRoomDefinition,
// getDungeonRoomDefinitionByProgress.

export type DungeonRoomDefinition = {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly nextRoomIds: readonly string[];
};

type DungeonDefinition = {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly DungeonRoomDefinition[];
};

const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] = [
  {
    id: 'lost_mine',
    name: 'Lost Mine of Phandelver',
    rooms: [
      { id: 'cave_entrance', name: 'Cave Entrance', effectText: 'Scry 1.', nextRoomIds: ['goblin_lair', 'mine_tunnels'] },
      {
        id: 'goblin_lair',
        name: 'Goblin Lair',
        effectText: 'Create a 1/1 red Goblin creature token.',
        nextRoomIds: ['storeroom', 'dark_pool'],
      },
      {
        id: 'mine_tunnels',
        name: 'Mine Tunnels',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['dark_pool', 'fungi_cavern'],
      },
      {
        id: 'storeroom',
        name: 'Storeroom',
        effectText: 'Put a +1/+1 counter on target creature you control.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'dark_pool',
        name: 'Dark Pool',
        effectText: 'Each opponent loses 1 life and you gain 1 life.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'fungi_cavern',
        name: 'Fungi Cavern',
        effectText: "Target creature gets -4/-0 until your next turn.",
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'temple_of_dumathoin',
        name: 'Temple of Dumathoin',
        effectText: 'Draw a card.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    rooms: [
      {
        id: 'trapped_entry',
        name: 'Trapped Entry',
        effectText: 'Each player loses 1 life.',
        nextRoomIds: ['veils_of_fear', 'oubliette'],
      },
      {
        id: 'veils_of_fear',
        name: 'Veils of Fear',
        effectText: 'Each player loses 2 life unless they discard a card.',
        nextRoomIds: ['sandfall_cell'],
      },
      {
        id: 'oubliette',
        name: 'Oubliette',
        effectText: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'sandfall_cell',
        name: 'Sandfall Cell',
        effectText: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'cradle_of_the_death_god',
        name: 'Cradle of the Death God',
        effectText: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'mad_mage',
    name: 'Dungeon of the Mad Mage',
    rooms: [
      { id: 'yawning_portal', name: 'Yawning Portal', effectText: 'You gain 1 life.', nextRoomIds: ['dungeon_level'] },
      {
        id: 'dungeon_level',
        name: 'Dungeon Level',
        effectText: 'Scry 1.',
        nextRoomIds: ['goblin_bazaar', 'twisted_caverns'],
      },
      {
        id: 'goblin_bazaar',
        name: 'Goblin Bazaar',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['lost_level'],
      },
      {
        id: 'twisted_caverns',
        name: 'Twisted Caverns',
        effectText: "Target creature can't attack until your next turn.",
        nextRoomIds: ['lost_level'],
      },
      { id: 'lost_level', name: 'Lost Level', effectText: 'Scry 2.', nextRoomIds: ['runestone_caverns', 'muirals_graveyard'] },
      {
        id: 'runestone_caverns',
        name: 'Runestone Caverns',
        effectText: 'Exile the top two cards of your library. You may play them.',
        nextRoomIds: ['deep_mines'],
      },
      {
        id: 'muirals_graveyard',
        name: "Muiral's Graveyard",
        effectText: 'Create two 1/1 black Skeleton creature tokens.',
        nextRoomIds: ['deep_mines'],
      },
      { id: 'deep_mines', name: 'Deep Mines', effectText: 'Scry 3.', nextRoomIds: ['mad_wizards_lair'] },
      {
        id: 'mad_wizards_lair',
        name: "Mad Wizard's Lair",
        effectText: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        nextRoomIds: [],
      },
    ],
  },
];

export function getDungeonDefinition(dungeonId: string): DungeonDefinition | undefined {
  const normalizedDungeonId = String(dungeonId || '').trim().toLowerCase();
  return DUNGEON_DEFINITIONS.find(dungeon => dungeon.id === normalizedDungeonId);
}

export function getDungeonRoomDefinition(
  dungeonId: string,
  roomId: string | undefined
): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  const normalizedRoomId = String(roomId || '').trim().toLowerCase();
  if (!dungeon || !normalizedRoomId) return undefined;
  return dungeon.rooms.find(room => room.id === normalizedRoomId);
}

function getDefaultDungeonPath(dungeon: DungeonDefinition): readonly string[] {
  const path: string[] = [];
  let currentRoom = dungeon.rooms[0];
  const visited = new Set<string>();
  while (currentRoom && !visited.has(currentRoom.id)) {
    path.push(currentRoom.id);
    visited.add(currentRoom.id);
    currentRoom = currentRoom.nextRoomIds.length > 0
      ? dungeon.rooms.find(room => room.id === currentRoom.nextRoomIds[0])
      : undefined;
  }
  return path;
}

export function getDungeonRoomDefinitionByProgress(dungeonId: string, progress: any): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return undefined;

  const explicitRoom = getDungeonRoomDefinition(dungeonId, String(progress?.roomId || '').trim());
  if (explicitRoom) return explicitRoom;

  const roomIndex = Math.max(0, Number(progress?.roomIndex) || 0);
  const defaultPath = getDefaultDungeonPath(dungeon);
  const fallbackRoomId = defaultPath[Math.min(roomIndex, Math.max(0, defaultPath.length - 1))];
  return dungeon.rooms.find(room => room.id === fallbackRoomId) || dungeon.rooms[0];
}
