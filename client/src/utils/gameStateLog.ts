import {
  battlefieldLeaveKey,
  combatDamageLifeKey,
  combatDeathKey,
  commanderDamageMessageKey,
  destroyedMessageKey,
  discardMessageKey,
  drawMessageKey,
  formatCastSpellMessage,
  formatCommanderDamageMessage,
  formatDiscardMessage,
  formatDrawMessage,
  formatExileFromZoneMessage,
  formatGameOverDrawMessage,
  formatGameOverVictoryMessage,
  formatLifeChangeMessage,
  formatMillMessage,
  formatPermanentLeftMessage,
  formatPlayerEliminatedMessage,
  formatTokenCreatedMessage,
  gameOverVictoryMessageKey,
  exileFromZoneMessageKey,
  millMessageKey,
  playerEliminatedMessageKey,
  sacrificeMessageIncludesCard,
  spellDamageLifeKey,
  tokenCreatedMessageKey,
  type PermanentLeaveDestination,
} from '../../../shared/src/gameLogFormat';
import { collectCommanderDeckEntries } from './commanderDamageDisplay';

export type GameLogEntry = {
  id: string;
  ts: number;
  kind: 'state' | 'chat';
  message: string;
};

type NameResolver = (playerId: string) => string;

function cardLabel(card: any): string {
  return String(card?.name || card?.card?.name || 'Permanent').trim() || 'Permanent';
}

function permLabel(perm: any): string {
  return cardLabel(perm?.card || perm);
}

function isLandPermanent(perm: any): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function isTokenPermanent(perm: any): boolean {
  if (perm?.isToken === true) return true;
  if (perm?.card?.isToken === true) return true;
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('token');
}

function counterDeltaSummary(before: Record<string, number>, after: Record<string, number>): string | null {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const prev = Number(before?.[key] ?? 0);
    const next = Number(after?.[key] ?? 0);
    const delta = next - prev;
    if (delta === 0) continue;
    parts.push(`${delta > 0 ? '+' : ''}${delta} ${key}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function lifeChangeKey(message: string): string | null {
  const match = message.match(/(.+?)\s+(?:gains|loses|gained|lost)\s+(\d+)\s+life/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|${match[2]}`;
}

function castMessageKey(message: string): string | null {
  const match = message.match(/^(.+?)\s+casts\s+(.+?)(?:\s+targeting|\s+from|$)/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|${match[2].trim().toLowerCase()}`;
}

function zoneHandCount(zones: any, playerId: string): number {
  const zone = zones?.[playerId];
  if (!zone) return 0;
  if (typeof zone.handCount === 'number') return zone.handCount;
  return Array.isArray(zone.hand) ? zone.hand.length : 0;
}

function zoneLibraryCount(zones: any, playerId: string): number {
  return Number(zones?.[playerId]?.libraryCount ?? 0);
}

function zoneGraveyardCards(zones: any, playerId: string): any[] {
  const graveyard = zones?.[playerId]?.graveyard;
  return Array.isArray(graveyard) ? graveyard : [];
}

function zoneExileCards(zones: any, playerId: string): any[] {
  const exile = zones?.[playerId]?.exile;
  return Array.isArray(exile) ? exile : [];
}

function zoneContainsCardId(zones: any, playerId: string, zoneKey: 'hand' | 'graveyard' | 'exile', cardId: string): boolean {
  const zone = zones?.[playerId];
  if (!zone) return false;
  const cards = Array.isArray(zone[zoneKey]) ? zone[zoneKey] : [];
  return cards.some((card: any) => String(card?.id || '') === cardId);
}

function cardNameFromZoneCard(card: any): string {
  return String(card?.name || card?.card?.name || 'Card').trim() || 'Card';
}

function countNewStackItemsFromPlayer(prevStack: any[], nextStack: any[], playerId: string): number {
  const prevIds = new Set(prevStack.map((item) => String(item?.id || '')));
  return nextStack.filter((item) => {
    if (!item?.id || prevIds.has(String(item.id))) return false;
    return String(item?.controller || '') === playerId;
  }).length;
}

function countNewBattlefieldFromPlayer(prevBattlefield: any[], nextBattlefield: any[], playerId: string): number {
  const prevIds = new Set(prevBattlefield.map((perm) => String(perm?.id || '')));
  return nextBattlefield.filter((perm) => {
    if (!perm?.id || prevIds.has(String(perm.id))) return false;
    return String(perm?.controller || '') === playerId;
  }).length;
}

function findPermanentLeaveDestination(
  cardId: string,
  nextZones: Record<string, any>,
  nextCommandZone: Record<string, any>,
): { destination: PermanentLeaveDestination; ownerId?: string } {
  const id = String(cardId || '').trim();
  if (!id) return { destination: 'unknown' };

  for (const [playerId, zone] of Object.entries(nextZones || {})) {
    const graveyard = Array.isArray(zone?.graveyard) ? zone.graveyard : [];
    if (graveyard.some((card: any) => String(card?.id || '') === id)) {
      return { destination: 'graveyard', ownerId: playerId };
    }

    const exile = Array.isArray(zone?.exile) ? zone.exile : [];
    if (exile.some((card: any) => String(card?.id || '') === id)) {
      return { destination: 'exile', ownerId: playerId };
    }

    const hand = Array.isArray(zone?.hand) ? zone.hand : [];
    if (hand.some((card: any) => String(card?.id || '') === id)) {
      return { destination: 'hand', ownerId: playerId };
    }
  }

  for (const [playerId, info] of Object.entries(nextCommandZone || {})) {
    const entries = collectCommanderDeckEntries(info as any);
    if (entries.some((entry) => entry.commanderId === id)) {
      return { destination: 'command', ownerId: playerId };
    }
    const cards = Array.isArray((info as any)?.commanderCards) ? (info as any).commanderCards : [];
    if (cards.some((card: any) => String(card?.id || '') === id)) {
      return { destination: 'command', ownerId: playerId };
    }
  }

  return { destination: 'unknown' };
}

function resolveCommanderInfo(
  commandZone: Record<string, any>,
  commanderId: string,
  resolveName: NameResolver,
): { commanderName: string; ownerName: string } {
  for (const [ownerId, info] of Object.entries(commandZone || {})) {
    const entries = collectCommanderDeckEntries(info as any);
    const found = entries.find((entry) => entry.commanderId === commanderId);
    if (found) {
      return {
        commanderName: found.commanderName,
        ownerName: resolveName(ownerId),
      };
    }
  }
  return { commanderName: 'Commander', ownerName: '' };
}

function findExileSourceZone(
  cardId: string,
  playerId: string,
  prevZones: Record<string, any>,
  prevBattlefield: any[],
  libraryDelta: number,
): 'hand' | 'graveyard' | 'library' | null {
  const id = String(cardId || '').trim();
  if (!id) return null;

  if (prevBattlefield.some((perm) => String(perm?.id || '') === id)) {
    return null;
  }
  if (zoneContainsCardId(prevZones, playerId, 'hand', id)) return 'hand';
  if (zoneContainsCardId(prevZones, playerId, 'graveyard', id)) return 'graveyard';
  if (libraryDelta < 0) return 'library';
  return null;
}

export function dedupeGameLogEntries(entries: readonly GameLogEntry[]): GameLogEntry[] {
  const result: GameLogEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'state') {
      const lifeKey = lifeChangeKey(entry.message);
      if (lifeKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && (lifeChangeKey(existing.message) === lifeKey
            || combatDamageLifeKey(existing.message) === lifeKey
            || spellDamageLifeKey(existing.message) === lifeKey),
        );
        if (duplicate) continue;
      }

      const castKey = castMessageKey(entry.message);
      if (castKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && castMessageKey(existing.message) === castKey,
        );
        if (duplicate) continue;
      }

      const drawKey = drawMessageKey(entry.message);
      if (drawKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && drawMessageKey(existing.message) === drawKey,
        );
        if (duplicate) continue;
      }

      const discardKey = discardMessageKey(entry.message);
      if (discardKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && discardMessageKey(existing.message) === discardKey,
        );
        if (duplicate) continue;
      }

      const millKey = millMessageKey(entry.message);
      if (millKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && millMessageKey(existing.message) === millKey,
        );
        if (duplicate) continue;
      }

      const leaveKey = battlefieldLeaveKey(entry.message);
      if (leaveKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && (combatDeathKey(existing.message) === leaveKey
            || destroyedMessageKey(existing.message) === leaveKey),
        );
        if (duplicate) continue;
      }

      const destroyedKey = destroyedMessageKey(entry.message);
      if (destroyedKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && (destroyedMessageKey(existing.message) === destroyedKey
            || combatDeathKey(existing.message) === destroyedKey
            || sacrificeMessageIncludesCard(existing.message, destroyedKey)),
        );
        if (duplicate) continue;
      }

      const commanderKey = commanderDamageMessageKey(entry.message);
      if (commanderKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && commanderDamageMessageKey(existing.message) === commanderKey,
        );
        if (duplicate) continue;
      }

      const eliminatedKey = playerEliminatedMessageKey(entry.message);
      if (eliminatedKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && playerEliminatedMessageKey(existing.message) === eliminatedKey,
        );
        if (duplicate) continue;
      }

      const exileKey = exileFromZoneMessageKey(entry.message);
      if (exileKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && (exileFromZoneMessageKey(existing.message) === exileKey
            || destroyedMessageKey(existing.message) === exileKey),
        );
        if (duplicate) continue;
      }

      const victoryKey = gameOverVictoryMessageKey(entry.message);
      if (victoryKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && gameOverVictoryMessageKey(existing.message) === victoryKey,
        );
        if (duplicate) continue;
      }

      if (entry.message === formatGameOverDrawMessage()) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && existing.message === formatGameOverDrawMessage(),
        );
        if (duplicate) continue;
      }

      const tokenKey = tokenCreatedMessageKey(entry.message);
      if (tokenKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && tokenCreatedMessageKey(existing.message) === tokenKey,
        );
        if (duplicate) continue;
      }
    }
    result.push(entry);
  }
  return result;
}

export function buildGameStateLogEntries(
  prev: any | null | undefined,
  next: any | null | undefined,
  resolveName: NameResolver,
): GameLogEntry[] {
  if (!next || !prev) return [];

  const ts = Date.now();
  const entries: GameLogEntry[] = [];
  let seq = 0;
  const push = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    entries.push({
      id: `log_${ts}_${seq++}`,
      ts,
      kind: 'state',
      message: trimmed,
    });
  };

  const prevLife = (prev.life || {}) as Record<string, number>;
  const nextLife = (next.life || {}) as Record<string, number>;
  const lifeIds = new Set([...Object.keys(prevLife), ...Object.keys(nextLife)]);
  for (const playerId of lifeIds) {
    const before = Number(prevLife[playerId] ?? NaN);
    const after = Number(nextLife[playerId] ?? NaN);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) continue;
    push(formatLifeChangeMessage(resolveName(playerId), before, after));
  }

  for (const counterKey of ['poisonCounters', 'energyCounters', 'experienceCounters'] as const) {
    const prevMap = (prev as any)[counterKey] as Record<string, number> | undefined;
    const nextMap = (next as any)[counterKey] as Record<string, number> | undefined;
    if (!prevMap && !nextMap) continue;
    const ids = new Set([...Object.keys(prevMap || {}), ...Object.keys(nextMap || {})]);
    const label = counterKey === 'poisonCounters' ? 'poison' : counterKey === 'energyCounters' ? 'energy' : 'experience';
    for (const playerId of ids) {
      const before = Number(prevMap?.[playerId] ?? 0);
      const after = Number(nextMap?.[playerId] ?? 0);
      if (before === after) continue;
      const delta = after - before;
      const verb = delta > 0 ? 'gains' : 'loses';
      push(`${resolveName(playerId)} ${verb} ${Math.abs(delta)} ${label} counter${Math.abs(delta) === 1 ? '' : 's'} (${before} → ${after})`);
    }
  }

  if (String(prev.turnPlayer || '') !== String(next.turnPlayer || '')) {
    push(`${resolveName(String(next.turnPlayer || ''))}'s turn`);
  }

  const prevBattlefield = Array.isArray(prev.battlefield) ? prev.battlefield : [];
  const nextBattlefield = Array.isArray(next.battlefield) ? next.battlefield : [];
  const prevStack = Array.isArray(prev.stack) ? prev.stack : [];
  const nextStack = Array.isArray(next.stack) ? next.stack : [];

  const prevZones = (prev.zones || {}) as Record<string, any>;
  const nextZones = (next.zones || {}) as Record<string, any>;
  const nextCommandZone = (next.commandZone || {}) as Record<string, any>;
  const zonePlayerIds = new Set([...Object.keys(prevZones), ...Object.keys(nextZones)]);

  for (const playerId of zonePlayerIds) {
    const prevHand = zoneHandCount(prevZones, playerId);
    const nextHand = zoneHandCount(nextZones, playerId);
    const handDelta = nextHand - prevHand;

    const prevLibrary = zoneLibraryCount(prevZones, playerId);
    const nextLibrary = zoneLibraryCount(nextZones, playerId);
    const libraryDelta = nextLibrary - prevLibrary;

    const prevGraveyardIds = new Set(
      zoneGraveyardCards(prevZones, playerId).map((card) => String(card?.id || '')),
    );
    const newGraveyardCards = zoneGraveyardCards(nextZones, playerId)
      .filter((card) => card?.id && !prevGraveyardIds.has(String(card.id)));

    if (handDelta > 0 && libraryDelta === -handDelta) {
      push(formatDrawMessage(resolveName(playerId), handDelta));
    } else if (handDelta < 0) {
      const playedToStack = countNewStackItemsFromPlayer(prevStack, nextStack, playerId);
      const playedToBattlefield = countNewBattlefieldFromPlayer(prevBattlefield, nextBattlefield, playerId);
      const discardCount = Math.max(0, -handDelta - playedToStack - playedToBattlefield);
      if (discardCount > 0) {
        const discardedNames = newGraveyardCards.slice(0, discardCount).map((card) => cardNameFromZoneCard(card));
        push(formatDiscardMessage(resolveName(playerId), discardedNames));
      }
    }

    if (libraryDelta < 0) {
      const drawAmount = handDelta > 0 && libraryDelta === -handDelta ? handDelta : 0;
      const millFromLibrary = -libraryDelta - drawAmount;
      if (millFromLibrary > 0 && handDelta <= 0) {
        const playedToStack = countNewStackItemsFromPlayer(prevStack, nextStack, playerId);
        const playedToBattlefield = countNewBattlefieldFromPlayer(prevBattlefield, nextBattlefield, playerId);
        const discardCount = handDelta < 0
          ? Math.max(0, -handDelta - playedToStack - playedToBattlefield)
          : 0;
        const millCards = newGraveyardCards.slice(discardCount, discardCount + millFromLibrary);
        const millCount = millCards.length > 0 ? millCards.length : millFromLibrary;
        const milledNames = millCards.map((card) => cardNameFromZoneCard(card));
        push(formatMillMessage(resolveName(playerId), millCount, milledNames));
      }
    }
  }

  const prevExileIdsByPlayer = new Map<string, Set<string>>();
  for (const playerId of zonePlayerIds) {
    prevExileIdsByPlayer.set(
      playerId,
      new Set(zoneExileCards(prevZones, playerId).map((card) => String(card?.id || '')).filter(Boolean)),
    );
  }

  for (const playerId of zonePlayerIds) {
    const prevExileIds = prevExileIdsByPlayer.get(playerId) || new Set<string>();
    const newExileCards = zoneExileCards(nextZones, playerId)
      .filter((card) => card?.id && !prevExileIds.has(String(card.id)));
    if (newExileCards.length === 0) continue;

    const prevLibrary = zoneLibraryCount(prevZones, playerId);
    const nextLibrary = zoneLibraryCount(nextZones, playerId);
    const libraryDelta = nextLibrary - prevLibrary;

    for (const card of newExileCards) {
      const cardId = String(card.id);
      const sourceZone = findExileSourceZone(cardId, playerId, prevZones, prevBattlefield, libraryDelta);
      if (!sourceZone) continue;
      push(formatExileFromZoneMessage(
        cardNameFromZoneCard(card),
        sourceZone,
        resolveName(playerId),
      ));
    }
  }

  const prevById = new Map(prevBattlefield.map((perm: any) => [String(perm?.id || ''), perm]));
  const nextById = new Map(nextBattlefield.map((perm: any) => [String(perm?.id || ''), perm]));

  const newTokensByKey = new Map<string, { controllerId: string; controllerName: string; tokenName: string; count: number }>();
  for (const [id, perm] of nextById) {
    if (!id || prevById.has(id) || !isTokenPermanent(perm)) continue;
    const controllerId = String(perm?.controller || '');
    const controllerName = resolveName(controllerId);
    const tokenName = permLabel(perm).replace(/\s+token$/i, '').trim() || 'Token';
    const key = `${controllerId}|${tokenName.toLowerCase()}`;
    const existing = newTokensByKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      newTokensByKey.set(key, { controllerId, controllerName, tokenName, count: 1 });
    }
  }
  for (const group of newTokensByKey.values()) {
    push(formatTokenCreatedMessage(group.controllerName, group.count, group.tokenName));
  }

  for (const [id, perm] of nextById) {
    if (!id || prevById.has(id)) continue;
    if (isTokenPermanent(perm)) continue;
    const controller = resolveName(String(perm?.controller || ''));
    const name = permLabel(perm);
    if (isLandPermanent(perm)) {
      push(`${controller} played ${name}`);
    } else {
      push(`${name} entered the battlefield (${controller})`);
    }
  }

  for (const [id, perm] of prevById) {
    if (!id || nextById.has(id)) continue;
    const { destination, ownerId } = findPermanentLeaveDestination(id, nextZones, nextCommandZone);
    push(formatPermanentLeftMessage(
      permLabel(perm),
      destination,
      ownerId ? resolveName(ownerId) : undefined,
    ));
  }

  const prevCommanderDamage = (prev.commanderDamage || {}) as Record<string, Record<string, number>>;
  const nextCommanderDamage = (next.commanderDamage || {}) as Record<string, Record<string, number>>;
  const commandZone = (next.commandZone || {}) as Record<string, any>;
  const commanderVictimIds = new Set([
    ...Object.keys(prevCommanderDamage),
    ...Object.keys(nextCommanderDamage),
  ]);
  for (const victimId of commanderVictimIds) {
    const prevByCommander = prevCommanderDamage[victimId] || {};
    const nextByCommander = nextCommanderDamage[victimId] || {};
    const commanderIds = new Set([
      ...Object.keys(prevByCommander),
      ...Object.keys(nextByCommander),
    ]);
    for (const commanderId of commanderIds) {
      const before = Number(prevByCommander[commanderId] ?? 0);
      const after = Number(nextByCommander[commanderId] ?? 0);
      if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) continue;
      const { commanderName, ownerName } = resolveCommanderInfo(commandZone, commanderId, resolveName);
      push(formatCommanderDamageMessage(
        resolveName(victimId),
        commanderName,
        ownerName,
        before,
        after,
      ));
    }
  }

  const prevPlayers = Array.isArray(prev.players) ? prev.players : [];
  const nextPlayers = Array.isArray(next.players) ? next.players : [];
  for (const player of nextPlayers) {
    const playerId = String(player?.id || '');
    if (!playerId) continue;
    const prevPlayer = prevPlayers.find((entry: any) => String(entry?.id || '') === playerId);
    if (prevPlayer?.inactive || !player?.inactive) continue;
    push(formatPlayerEliminatedMessage(resolveName(playerId)));
  }

  if (!prev.gameOver && next.gameOver) {
    const winnerId = String(next.winner || '');
    if (winnerId) {
      push(formatGameOverVictoryMessage(resolveName(winnerId)));
    } else {
      push(formatGameOverDrawMessage());
    }
  }

  for (const [id, afterPerm] of nextById) {
    const beforePerm = prevById.get(id);
    if (!beforePerm) continue;

    const name = permLabel(afterPerm);

    const counterSummary = counterDeltaSummary(
      (beforePerm?.counters || {}) as Record<string, number>,
      (afterPerm?.counters || {}) as Record<string, number>,
    );
    if (counterSummary) {
      push(`${name}: ${counterSummary}`);
    }

    const beforeCtrl = String(beforePerm?.controller || '');
    const afterCtrl = String(afterPerm?.controller || '');
    if (beforeCtrl && afterCtrl && beforeCtrl !== afterCtrl) {
      push(`${name} now controlled by ${resolveName(afterCtrl)}`);
    }
  }

  const prevStackById = new Map(prevStack.map((item: any) => [String(item?.id || ''), item]));
  const nextStackById = new Map(nextStack.map((item: any) => [String(item?.id || ''), item]));

  for (const [stackId, item] of nextStackById) {
    if (!stackId || prevStackById.has(stackId)) continue;
    const caster = resolveName(String(item?.controller || ''));
    push(formatCastSpellMessage(caster, cardLabel(item?.card || item), item?.targetDetails, resolveName));
  }

  for (const [stackId, item] of prevStackById) {
    if (!stackId || nextStackById.has(stackId)) continue;
    push(`${cardLabel(item?.card || item)} resolves`);
  }

  const prevMonarch = prev.monarch ?? null;
  const nextMonarch = next.monarch ?? null;
  if (prevMonarch !== nextMonarch) {
    push(nextMonarch ? `${resolveName(String(nextMonarch))} becomes the Monarch` : 'The Monarch is vacant');
  }

  const prevInitiative = prev.initiative ?? null;
  const nextInitiative = next.initiative ?? null;
  if (prevInitiative !== nextInitiative) {
    push(nextInitiative ? `${resolveName(String(nextInitiative))} takes the Initiative` : 'The Initiative is unclaimed');
  }

  return entries;
}

export function mergeGameLogEntries(
  existing: readonly GameLogEntry[],
  incoming: readonly GameLogEntry[],
  maxEntries = 400,
): GameLogEntry[] {
  if (incoming.length === 0) return [...existing];
  const merged = dedupeGameLogEntries([...existing, ...incoming]);
  return merged.slice(-maxEntries);
}
