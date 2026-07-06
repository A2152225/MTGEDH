import type { CommanderInfo, PlayerID, PlayerRef } from '../../../shared/src';

export interface CommanderDamageRow {
  commanderId: string;
  commanderName: string;
  ownerId: string;
  ownerName: string;
  commanderIndex: number;
  damage: number;
}

export interface CommanderDamageOwnerGroup {
  ownerId: string;
  ownerName: string;
  commanders: CommanderDamageRow[];
}

export interface CommanderDeckEntry {
  commanderId: string;
  commanderName: string;
  commanderIndex: number;
}

function isValidCommanderId(id: unknown): id is string {
  return typeof id === 'string' && id.trim() !== '';
}

export function isCommanderFormat(format?: string): boolean {
  return String(format || '').toLowerCase() === 'commander';
}

/**
 * Mirrors CommanderPanel pairing: partners/backgrounds are separate command zone
 * entries keyed by their own card id, each with independent 21-damage tracking.
 */
export function collectCommanderDeckEntries(info: CommanderInfo | undefined): CommanderDeckEntry[] {
  if (!info) return [];

  const names = Array.isArray(info.commanderNames) ? info.commanderNames : [];
  const ids = Array.isArray(info.commanderIds) ? info.commanderIds : [];
  const cards = Array.isArray((info as any)?.commanderCards) ? (info as any).commanderCards : [];

  const entries: CommanderDeckEntry[] = [];
  const seen = new Set<string>();
  const slotCount = Math.max(names.length, ids.length);

  for (let index = 0; index < slotCount; index += 1) {
    const id = ids[index];
    if (!isValidCommanderId(id)) continue;

    const commanderId = String(id);
    if (seen.has(commanderId)) continue;
    seen.add(commanderId);

    const card = cards.find((candidate: any) => String(candidate?.id) === commanderId);
    const commanderName =
      card?.name ||
      (names[index] ? String(names[index]) : `Commander ${index + 1}`);

    entries.push({
      commanderId,
      commanderName,
      commanderIndex: index,
    });
  }

  for (const card of cards) {
    const commanderId = card?.id ? String(card.id) : '';
    if (!isValidCommanderId(commanderId) || seen.has(commanderId)) continue;
    seen.add(commanderId);
    entries.push({
      commanderId,
      commanderName: card?.name || commanderId,
      commanderIndex: entries.length,
    });
  }

  return entries;
}

export function buildCommanderDamageRows(
  victimPlayerId: PlayerID,
  players: readonly PlayerRef[],
  commanderDamage: Record<PlayerID, Record<string, number>> | undefined,
  commandZone: Record<PlayerID, CommanderInfo | undefined> | undefined,
  format?: string,
): CommanderDamageRow[] | null {
  if (!isCommanderFormat(format)) return null;

  const damageByCommander = commanderDamage?.[victimPlayerId] || {};
  const rows: CommanderDamageRow[] = [];
  const seenCommanderIds = new Set<string>();

  const sortedPlayers = [...players].sort(
    (left, right) =>
      (left.seat ?? Number.MAX_SAFE_INTEGER) - (right.seat ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name),
  );

  for (const player of sortedPlayers) {
    const entries = collectCommanderDeckEntries(commandZone?.[player.id]);
    for (const entry of entries) {
      seenCommanderIds.add(entry.commanderId);
      rows.push({
        commanderId: entry.commanderId,
        commanderName: entry.commanderName,
        ownerId: player.id,
        ownerName: player.name,
        commanderIndex: entry.commanderIndex,
        damage: Number(damageByCommander[entry.commanderId] || 0),
      });
    }
  }

  for (const [commanderId, amount] of Object.entries(damageByCommander)) {
    if (seenCommanderIds.has(commanderId)) continue;
    if (Number(amount) <= 0) continue;
    rows.push({
      commanderId,
      commanderName: 'Unknown commander',
      ownerId: '',
      ownerName: 'Unknown',
      commanderIndex: Number.MAX_SAFE_INTEGER,
      damage: Number(amount),
    });
  }

  return rows;
}

export function groupCommanderDamageRowsByOwner(rows: CommanderDamageRow[]): CommanderDamageOwnerGroup[] {
  const groups: CommanderDamageOwnerGroup[] = [];
  const groupByOwner = new Map<string, CommanderDamageOwnerGroup>();

  for (const row of rows) {
    const groupKey = row.ownerId || row.ownerName;
    let group = groupByOwner.get(groupKey);
    if (!group) {
      group = {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        commanders: [],
      };
      groupByOwner.set(groupKey, group);
      groups.push(group);
    }
    group.commanders.push(row);
  }

  for (const group of groups) {
    group.commanders.sort((left, right) => left.commanderIndex - right.commanderIndex);
  }

  return groups;
}

export function commanderDamageRowColor(damage: number): string {
  if (damage >= 21) return '#ef4444';
  if (damage > 0) return '#fbbf24';
  return 'rgba(209, 213, 219, 0.75)';
}
