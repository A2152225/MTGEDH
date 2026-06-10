import type { GameContext } from '../context.js';

export function permanentIsCommanderCard(ctx: GameContext, permanent: any): boolean {
  const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
  const cardId = String(permanent?.card?.id || '').trim();
  const commanderIds = ownerId ? ((ctx as any).commandZone?.[ownerId]?.commanderIds || []) : [];
  return Boolean(permanent?.isCommander === true || (cardId && Array.isArray(commanderIds) && commanderIds.includes(cardId)));
}

export function wasPermanentCardMovedToExile(state: any, permanentSnapshot: any): boolean {
  const ownerId = String(permanentSnapshot?.owner || permanentSnapshot?.controller || '').trim();
  const cardId = String(permanentSnapshot?.card?.id || '').trim();
  if (!ownerId || !cardId) return false;
  const exile = Array.isArray(state?.zones?.[ownerId]?.exile) ? state.zones[ownerId].exile : [];
  return exile.some((card: any) => card && String(card.id || '').trim() === cardId);
}
