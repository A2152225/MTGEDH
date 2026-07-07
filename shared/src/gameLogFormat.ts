export type GameLogTargetInfo = {
  id: string;
  type: 'permanent' | 'player';
  name?: string;
  controllerId?: string;
  controllerName?: string;
};

export function formatNameList(names: readonly string[]): string {
  const filtered = names.map((name) => String(name || '').trim()).filter(Boolean);
  if (filtered.length === 0) return 'no creatures';
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`;
}

export function formatStackTargets(
  targetDetails: readonly GameLogTargetInfo[] | undefined,
  resolveName: (id: string) => string,
): string {
  if (!targetDetails?.length) return '';
  const parts = targetDetails.map((target) => {
    if (target.type === 'player') {
      return String(target.name || resolveName(target.id)).trim() || resolveName(target.id);
    }
    const name = String(target.name || 'Permanent').trim() || 'Permanent';
    const controller = String(
      target.controllerName || (target.controllerId ? resolveName(target.controllerId) : ''),
    ).trim();
    if (controller && controller !== target.controllerId) {
      return `${name} (${controller}'s)`;
    }
    return name;
  });
  if (parts.length === 1) return ` targeting ${parts[0]}`;
  return ` targeting ${formatNameList(parts)}`;
}

export function formatCastSpellMessage(
  casterName: string,
  spellName: string,
  targetDetails?: readonly GameLogTargetInfo[],
  resolveName?: (id: string) => string,
  suffix?: string,
): string {
  const baseName = String(spellName || 'Spell').trim() || 'Spell';
  const targets = targetDetails && resolveName ? formatStackTargets(targetDetails, resolveName) : '';
  const message = `${casterName} casts ${baseName}${targets}`;
  return suffix ? `${message} ${suffix}`.trimEnd() : message;
}

export function formatDeclareAttackersMessage(
  attackerPlayerName: string,
  attackers: ReadonlyArray<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
  lookupCreatureName: (creatureId: string) => string,
  lookupDefenderLabel: (targetPlayerId?: string, targetPermanentId?: string) => string,
): string {
  if (attackers.length === 0) return `${attackerPlayerName} attacks with no creatures.`;

  const byDefender = new Map<string, string[]>();
  for (const attacker of attackers) {
    const defenderLabel = lookupDefenderLabel(attacker.targetPlayerId, attacker.targetPermanentId);
    const creatureName = lookupCreatureName(attacker.creatureId);
    const names = byDefender.get(defenderLabel) || [];
    names.push(creatureName);
    byDefender.set(defenderLabel, names);
  }

  const parts: string[] = [];
  for (const [defender, creatureNames] of byDefender) {
    parts.push(`${attackerPlayerName} attacks ${defender} with ${formatNameList(creatureNames)}`);
  }
  return parts.join('; ');
}

export function formatDeclareBlockersMessage(
  blockerPlayerName: string,
  blockers: ReadonlyArray<{ blockerId: string; attackerId: string }>,
  lookupName: (permanentId: string) => string,
): string {
  if (blockers.length === 0) return `${blockerPlayerName} blocks with no creatures.`;

  const assignments = blockers.map(
    (blocker) => `${lookupName(blocker.blockerId)} blocks ${lookupName(blocker.attackerId)}`,
  );
  return `${blockerPlayerName}: ${assignments.join('; ')}`;
}

export function formatLifeChangeMessage(
  playerName: string,
  before: number,
  after: number,
): string {
  const delta = after - before;
  if (delta === 0) return '';
  const amount = Math.abs(delta);
  const verb = delta > 0 ? 'gains' : 'loses';
  return `${playerName} ${verb} ${amount} life (${before} → ${after})`;
}

export function formatCombatDamageMessages(
  damageToPlayers: Record<string, number>,
  resolvePlayerName: (playerId: string) => string,
  lifeTotals: Record<string, number>,
  options?: {
    firstStrike?: boolean;
    attackerDamageToPlayers?: Record<string, Record<string, number>>;
    resolveAttackerName?: (permanentId: string) => string;
  },
): string[] {
  const prefix = options?.firstStrike ? 'First strike: ' : '';
  const messages: string[] = [];

  for (const [playerId, damageRaw] of Object.entries(damageToPlayers || {})) {
    const damage = Math.max(0, Math.floor(Number(damageRaw) || 0));
    if (damage <= 0) continue;

    const playerName = resolvePlayerName(playerId);
    const after = Math.max(0, Math.floor(Number(lifeTotals[playerId] ?? 0)));
    const before = after + damage;

    let attackerDetail = '';
    const byAttacker = options?.attackerDamageToPlayers?.[playerId];
    if (byAttacker && options?.resolveAttackerName) {
      const attackerParts = Object.entries(byAttacker)
        .filter(([, amount]) => Math.max(0, Math.floor(Number(amount) || 0)) > 0)
        .map(([attackerId, amount]) => {
          const name = options.resolveAttackerName!(attackerId);
          const dmg = Math.max(0, Math.floor(Number(amount) || 0));
          return `${name} (${dmg})`;
        });
      if (attackerParts.length > 0) {
        attackerDetail = ` from ${attackerParts.join(', ')}`;
      }
    }

    messages.push(`${prefix}${playerName} takes ${damage} combat damage (${before} → ${after})${attackerDetail}`);
  }

  return messages;
}

export function combatDamageLifeKey(message: string): string | null {
  const match = message.match(/(.+?)\s+takes\s+(\d+)\s+combat damage/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|${match[2]}`;
}

export function formatDrawMessage(playerName: string, count: number): string {
  const amount = Math.max(0, Math.floor(Number(count) || 0));
  if (amount <= 0) return '';
  return `${playerName} draws ${amount} card${amount === 1 ? '' : 's'}`;
}

export function formatDiscardMessage(playerName: string, cardNames: readonly string[]): string {
  const names = cardNames.map((name) => String(name || '').trim()).filter(Boolean);
  if (names.length === 0) return `${playerName} discards a card`;
  return `${playerName} discards ${formatNameList(names)}`;
}

export function formatMillMessage(
  playerName: string,
  count: number,
  cardNames?: readonly string[],
): string {
  const amount = Math.max(0, Math.floor(Number(count) || 0));
  if (amount <= 0) return '';
  let message = `${playerName} mills ${amount} card${amount === 1 ? '' : 's'}`;
  const names = (cardNames || []).map((name) => String(name || '').trim()).filter(Boolean);
  if (names.length > 0) {
    message += `: ${formatNameList(names.slice(0, 5))}`;
    if (names.length > 5) {
      message += ` and ${names.length - 5} more`;
    }
  }
  return message;
}

export function formatCombatDeathMessage(
  creatureName: string,
  options?: { firstStrike?: boolean },
): string {
  const name = String(creatureName || 'Creature').trim() || 'Creature';
  const prefix = options?.firstStrike ? 'First strike: ' : '';
  return `${prefix}${name} dies in combat`;
}

export function drawMessageKey(message: string): string | null {
  const plural = message.match(/(.+?)\s+(?:draws?|drew)\s+(\d+)\s+card/i);
  if (plural) return `${plural[1].trim().toLowerCase()}|${plural[2]}`;
  const single = message.match(/(.+?)\s+draws?\s+a\s+card/i);
  if (single) return `${single[1].trim().toLowerCase()}|1`;
  return null;
}

export function discardMessageKey(message: string): string | null {
  const match = message.match(/(.+?)\s+discards?\s+/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|discard`;
}

export function millMessageKey(message: string): string | null {
  const match = message.match(/(.+?)\s+(?:mills?|milled)\s+(\d+)\s+card/i);
  if (match) return `${match[1].trim().toLowerCase()}|${match[2]}`;
  return null;
}

export function spellDamageLifeKey(message: string): string | null {
  const deals = message.match(/deals\s+(\d+)\s+damage to\s+(.+?)(?:\s+\(|\.|,|$)/i);
  if (deals) return `${deals[2].trim().toLowerCase()}|${deals[1]}`;

  const because = message.match(/(.+?)\s+(?:loses?|lost)\s+(\d+)\s+life because/i);
  if (because) return `${because[1].trim().toLowerCase()}|${because[2]}`;

  return null;
}

export function combatDeathKey(message: string): string | null {
  const match = message.match(/^(?:First strike: )?(.+?)\s+dies in combat$/i);
  return match ? match[1].trim().toLowerCase() : null;
}

export function battlefieldLeaveKey(message: string): string | null {
  const match = message.match(/^(.+?)\s+left the battlefield$/i);
  return match ? match[1].trim().toLowerCase() : null;
}

export function formatCommanderDamageMessage(
  playerName: string,
  commanderName: string,
  ownerName: string,
  before: number,
  after: number,
): string {
  const delta = after - before;
  if (delta <= 0) return '';
  const ownerPrefix = ownerName.trim() && ownerName !== commanderName ? `${ownerName}'s ` : '';
  return `${playerName} takes ${delta} commander damage from ${ownerPrefix}${commanderName} (${before} → ${after}/21)`;
}

export type PermanentLeaveDestination = 'graveyard' | 'exile' | 'hand' | 'command' | 'unknown';

export function formatPermanentLeftMessage(
  cardName: string,
  destination: PermanentLeaveDestination,
  ownerName?: string,
): string {
  const name = String(cardName || 'Permanent').trim() || 'Permanent';
  switch (destination) {
    case 'graveyard':
      return `${name} was destroyed`;
    case 'exile':
      return `${name} was exiled`;
    case 'hand':
      return `${name} returned to ${String(ownerName || 'their owner').trim()}'s hand`;
    case 'command':
      return `${name} returned to the command zone`;
    default:
      return `${name} left the battlefield`;
  }
}

export function destroyedMessageKey(message: string): string | null {
  const effectDestroyed = message.match(/:\s*(.+?) was destroyed\.?$/i);
  if (effectDestroyed) return effectDestroyed[1].trim().toLowerCase();

  const destroyed = message.match(/^(.+?) was destroyed\.?$/i);
  if (destroyed) return destroyed[1].trim().toLowerCase();

  return null;
}

export function commanderDamageMessageKey(message: string): string | null {
  const match = message.match(/(.+?) takes (\d+) commander damage from/i);
  if (match) return `${match[1].trim().toLowerCase()}|${match[2]}`;
  return null;
}

export function formatPlayerEliminatedMessage(playerName: string, reason?: string): string {
  const name = String(playerName || 'Player').trim() || 'Player';
  const base = `${name} has been eliminated`;
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason || trimmedReason.toLowerCase() === 'unknown reason') return base;
  return `${base} (${trimmedReason})`;
}

export function formatGameOverVictoryMessage(winnerName: string): string {
  return `${String(winnerName || 'Player').trim() || 'Player'} wins!`;
}

export function formatGameOverDrawMessage(): string {
  return 'The game is a draw.';
}

export function gameOverVictoryMessageKey(message: string): string | null {
  const match = message.match(/^(.+?) wins!$/i);
  return match ? match[1].trim().toLowerCase() : null;
}

export function playerEliminatedMessageKey(message: string): string | null {
  const match = message.match(/^(.+?) has been eliminated\b/i);
  return match ? match[1].trim().toLowerCase() : null;
}

export function formatExileFromZoneMessage(
  cardName: string,
  fromZone: 'hand' | 'graveyard' | 'library',
  ownerName: string,
): string {
  const name = String(cardName || 'Card').trim() || 'Card';
  const owner = String(ownerName || 'their owner').trim() || 'their owner';
  switch (fromZone) {
    case 'hand':
      return `${name} was exiled from ${owner}'s hand`;
    case 'graveyard':
      return `${name} was exiled from ${owner}'s graveyard`;
    case 'library':
      return `${name} was exiled from the top of ${owner}'s library`;
    default:
      return `${name} was exiled`;
  }
}

export function exileFromZoneMessageKey(message: string): string | null {
  const match = message.match(/^(.+?) was exiled from /i);
  return match ? match[1].trim().toLowerCase() : null;
}

export function formatTokenCreatedMessage(
  controllerName: string,
  count: number,
  tokenName: string,
): string {
  const amount = Math.max(1, Math.floor(Number(count) || 0));
  const name = String(tokenName || 'Token').trim() || 'Token';
  const normalizedName = name.toLowerCase().endsWith(' token') ? name : `${name} token`;
  if (amount === 1) return `${controllerName} creates a ${normalizedName}`;
  return `${controllerName} creates ${amount} ${normalizedName}s`;
}

export function tokenCreatedMessageKey(message: string): string | null {
  const creates = message.match(/(.+?) creates (?:a |an |(\d+) )?(.+?) tokens?\b/i);
  if (creates) {
    const count = creates[2] ? creates[2] : '1';
    return `${creates[1].trim().toLowerCase()}|${count}|${creates[3].trim().toLowerCase()}`;
  }
  const created = message.match(/(.+?) created (\d+) .+? tokens?\b/i);
  if (created) {
    return `${created[1].trim().toLowerCase()}|${created[2]}|token`;
  }
  return null;
}

export function sacrificeMessageIncludesCard(message: string, cardKey: string): boolean {
  const lower = message.toLowerCase();
  if (!lower.includes('sacrifice')) return false;
  return lower.includes(cardKey);
}
