/**
 * Origin parent: oracleIRExecutorZoneOpsBattlefieldEntry.ts / oracleIRExecutorRepeatedZoneDraft.ts
 * Cluster: Aura (and Curse) enter-attached resolution for revealed-this-way waves
 * and repeated zone drafts. No card-name routing.
 * Public entries: isAuraCard, findLegalAuraBattlefieldHostIds, findLegalAuraPlayerIds,
 * resolveAuraEnterAttachment, readBoundZoneCard.
 */
import type { GameState, PlayerID } from '../../shared/src';
import {
  canCardEnterAttachedToPlayer,
  canCardEnterAttachedToTarget,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import { getCardTypeLineLower } from './oracleIRExecutorZoneOpsThisWayParsers';
import { findBestZoneCardIndex } from './oracleIRExecutorZoneCardIdentity';

export type AuraEnterAttachment =
  | { readonly kind: 'none' }
  | { readonly kind: 'illegal' }
  | { readonly kind: 'battlefield'; readonly hostId: string }
  | { readonly kind: 'player'; readonly playerId: string };

function getCardOracleTextLower(card: any): string {
  return String(card?.oracle_text || card?.card?.oracle_text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
}

export function isAuraCard(card: any): boolean {
  return getCardTypeLineLower(card).includes('aura');
}

export function isPlayerEnchantingAura(card: any): boolean {
  return /\benchant (?:a )?(?:player|opponent)\b/i.test(getCardOracleTextLower(card));
}

export function readBoundZoneCard(state: GameState, playerId: string, zone: string, cardId: string): any | undefined {
  const wanted = String(cardId || '').trim();
  if (!wanted) return undefined;
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(playerId || '').trim()) as any;
  const zoneCards = Array.isArray(player?.[zone]) ? player[zone] : [];
  const idx = findBestZoneCardIndex(zoneCards, wanted);
  return idx >= 0 ? zoneCards[idx] : undefined;
}

export function findLegalAuraBattlefieldHostIds(
  state: GameState,
  card: any,
  controllerId: PlayerID,
  hostPool?: readonly any[],
): string[] {
  if (!isAuraCard(card) || isPlayerEnchantingAura(card)) return [];
  const battlefield = Array.isArray(hostPool) ? hostPool : ((state.battlefield || []) as any[]);
  return battlefield
    .filter((perm: any) => canCardEnterAttachedToTarget(card, controllerId, perm))
    .map((perm: any) => String(perm?.id || '').trim())
    .filter(Boolean);
}

export function findLegalAuraPlayerIds(
  state: GameState,
  card: any,
  controllerId: PlayerID,
): string[] {
  if (!isAuraCard(card) || !isPlayerEnchantingAura(card)) return [];
  return (state.players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((playerId) => playerId && canCardEnterAttachedToPlayer(card, controllerId, playerId));
}

export function resolveAuraEnterAttachment(
  state: GameState,
  card: any,
  controllerId: PlayerID,
  options?: {
    readonly hostPool?: readonly any[];
    readonly preferredAttachId?: string;
  },
): AuraEnterAttachment {
  if (!isAuraCard(card)) return { kind: 'none' };

  const preferred = String(options?.preferredAttachId || '').trim();
  if (isPlayerEnchantingAura(card)) {
    const legalPlayerIds = findLegalAuraPlayerIds(state, card, controllerId);
    if (preferred && legalPlayerIds.includes(preferred)) {
      return { kind: 'player', playerId: preferred };
    }
    if (legalPlayerIds.length === 0) return { kind: 'illegal' };
    return { kind: 'player', playerId: legalPlayerIds[0] };
  }

  const legalHostIds = findLegalAuraBattlefieldHostIds(state, card, controllerId, options?.hostPool);
  if (preferred && legalHostIds.includes(preferred)) {
    return { kind: 'battlefield', hostId: preferred };
  }
  if (legalHostIds.length === 0) return { kind: 'illegal' };
  return { kind: 'battlefield', hostId: legalHostIds[0] };
}

export function auraEnterAttachmentId(attachment: AuraEnterAttachment): string | undefined {
  if (attachment.kind === 'battlefield') return attachment.hostId;
  if (attachment.kind === 'player') return attachment.playerId;
  return undefined;
}
