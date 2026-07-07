import {
  formatCombatDamageMessages,
  formatCombatDeathMessage,
} from '../../../../shared/src/gameLogFormat.js';

export type PendingCombatDamageChatEntry = {
  firstStrike: boolean;
  damageToPlayers: Record<string, number>;
  attackerDamageToPlayers?: Record<string, Record<string, number>>;
  creaturesDestroyed?: Array<{ id: string; name: string }>;
};

function snapshotDestroyedCreatures(
  state: any,
  creatureIds: readonly string[],
): Array<{ id: string; name: string }> {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return creatureIds.map((id) => {
    const permanent = battlefield.find((entry: any) => entry?.id === id);
    const name = String(
      permanent?.card?.name || permanent?.card?.card_faces?.[0]?.name || 'Creature',
    ).trim() || 'Creature';
    return { id, name };
  });
}

export function queueCombatDamageChat(
  state: any,
  result: {
    damageToPlayers?: Record<string, number>;
    attackerDamageToPlayers?: Record<string, Record<string, number>>;
    creaturesDestroyed?: string[];
  },
  options?: { firstStrike?: boolean },
): void {
  const damageToPlayers = result?.damageToPlayers || {};
  const hasDamage = Object.values(damageToPlayers).some(
    (amount) => Math.max(0, Math.floor(Number(amount) || 0)) > 0,
  );
  const destroyedIds = Array.isArray(result?.creaturesDestroyed) ? result.creaturesDestroyed : [];
  const hasCreatureDeaths = destroyedIds.length > 0;
  if (!hasDamage && !hasCreatureDeaths) return;

  state.pendingCombatDamageChat = Array.isArray(state.pendingCombatDamageChat)
    ? state.pendingCombatDamageChat
    : [];

  state.pendingCombatDamageChat.push({
    firstStrike: options?.firstStrike === true,
    damageToPlayers: { ...damageToPlayers },
    ...(result.attackerDamageToPlayers
      ? { attackerDamageToPlayers: { ...result.attackerDamageToPlayers } }
      : {}),
    ...(hasCreatureDeaths
      ? { creaturesDestroyed: snapshotDestroyedCreatures(state, destroyedIds) }
      : {}),
  });
}

export function drainPendingCombatDamageChat(state: any): PendingCombatDamageChatEntry[] {
  const pending = Array.isArray(state?.pendingCombatDamageChat) ? state.pendingCombatDamageChat : [];
  delete state.pendingCombatDamageChat;
  return pending;
}

export function buildCombatDamageChatMessages(
  game: any,
  entry: PendingCombatDamageChatEntry,
): string[] {
  const state = game?.state || {};
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const resolvePlayerName = (playerId: string) => {
    const player = (state.players || []).find((entry: any) => entry?.id === playerId);
    return String(player?.name || playerId).trim() || playerId;
  };
  const resolveAttackerName = (permanentId: string) => {
    const permanent = battlefield.find((entry: any) => entry?.id === permanentId);
    return String(permanent?.card?.name || permanent?.card?.card_faces?.[0]?.name || 'Creature').trim() || 'Creature';
  };

  const messages = formatCombatDamageMessages(
    entry.damageToPlayers,
    resolvePlayerName,
    state.life || {},
    {
      firstStrike: entry.firstStrike,
      attackerDamageToPlayers: entry.attackerDamageToPlayers,
      resolveAttackerName,
    },
  );

  for (const creature of entry.creaturesDestroyed || []) {
    messages.push(formatCombatDeathMessage(creature.name, { firstStrike: entry.firstStrike }));
  }

  return messages;
}
