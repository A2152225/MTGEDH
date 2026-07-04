import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

export type EffectProgramCardZone = 'hand' | 'library' | 'graveyard' | 'exile' | 'battlefield';

export type OracleIRReplayMutation =
  | { readonly kind: 'mill'; readonly playerId: PlayerID; readonly count: number }
  | { readonly kind: 'drawCards'; readonly playerId: PlayerID; readonly count: number }
  | { readonly kind: 'adjustLife'; readonly playerId: PlayerID; readonly delta: number }
  | {
      readonly kind: 'createToken';
      readonly controllerId: PlayerID;
      readonly tokenData: {
        readonly id: string;
        readonly name: string;
        readonly typeLine: string;
        readonly power?: number;
        readonly toughness?: number;
        readonly colors: readonly string[];
        readonly abilities: readonly string[];
        readonly hasHaste: boolean;
      };
    }
  | {
      readonly kind: 'discardEffect';
      readonly playerId: PlayerID;
      readonly cardIds: readonly string[];
      readonly destination: 'graveyard' | 'exile';
    }
  | {
      readonly kind: 'putCardFromHandOntoBattlefield';
      readonly playerId: PlayerID;
      readonly cardId: string;
      readonly permanentId: string;
      readonly card: unknown;
      readonly tappedAndAttacking?: boolean;
    }
  | {
      readonly kind: 'effectProgramZoneMove';
      readonly playerId: PlayerID;
      readonly fromPlayerId: PlayerID;
      readonly cardId: string;
      readonly fromZone: EffectProgramCardZone;
      readonly toZone: EffectProgramCardZone;
      readonly card: unknown;
      readonly permanentId?: string;
      readonly fromPermanentId?: string;
    };

function normalizeReplayZone(value: unknown): EffectProgramCardZone | null {
  const zone = String(value || '').trim().toLowerCase();
  if (zone === 'hand' || zone === 'library' || zone === 'graveyard' || zone === 'exile' || zone === 'battlefield') {
    return zone;
  }
  return null;
}

function parsePt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferMoveZoneSourceFromWhat(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): EffectProgramCardZone | null {
  const text = String((step.what as any)?.text || (step.what as any)?.raw || step.raw || '').trim().toLowerCase();
  if (!text) return null;
  if (/\bfrom (?:your |the |their |target(?: player'?s| opponent'?s)? |an opponent'?s )?library\b/.test(text)) return 'library';
  if (/\bfrom (?:your |the |their |target(?: player'?s| opponent'?s)? |an opponent'?s )?hand\b/.test(text)) return 'hand';
  if (/\bfrom (?:your |the |their |target(?: player'?s| opponent'?s)? |an opponent'?s )?graveyard\b/.test(text)) return 'graveyard';
  if (/\bfrom (?:your |the |their |target(?: player'?s| opponent'?s)? |an opponent'?s )?exile\b/.test(text)) return 'exile';
  if (/\bfrom (?:your |the |their |target(?: player'?s| opponent'?s)? |an opponent'?s )?battlefield\b/.test(text)) return 'battlefield';
  if (/\bfrom the top of (?:your |their |target(?: player'?s| opponent'?s)? )?library\b/.test(text)) return 'library';
  return null;
}

function resolveMoveZoneDestination(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): EffectProgramCardZone | null {
  const direct = normalizeReplayZone(step.to);
  if (direct) return direct;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (toRaw.includes('graveyard')) return 'graveyard';
  if (toRaw.includes('hand')) return 'hand';
  if (toRaw.includes('library')) return 'library';
  if (toRaw.includes('exile')) return 'exile';
  if (toRaw.includes('battlefield')) return 'battlefield';
  return null;
}

function resolveCardOwnerId(card: any, fallbackPlayerId: PlayerID): PlayerID {
  return String(card?.owner || card?.ownerId || card?.controller || card?.controllerId || fallbackPlayerId || '').trim() as PlayerID;
}

export function buildCreateTokenReplayMutations(
  state: GameState,
  createdTokenIds: readonly string[] | undefined,
): OracleIRReplayMutation[] {
  if (!Array.isArray(createdTokenIds) || createdTokenIds.length === 0) return [];

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const mutations: OracleIRReplayMutation[] = [];

  for (const tokenId of createdTokenIds) {
    const permanentId = String(tokenId || '').trim();
    if (!permanentId) continue;

    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (!permanent || (permanent as any).isToken !== true) continue;

    const card = (permanent as any).card || permanent;
    const keywords = Array.isArray(card?.keywords) ? card.keywords : [];
    mutations.push({
      kind: 'createToken',
      controllerId: String((permanent as any).controller || '').trim() as PlayerID,
      tokenData: {
        id: permanentId,
        name: String(card?.name || 'Token'),
        typeLine: String(card?.type_line || 'Token'),
        power: parsePt((permanent as any).basePower ?? card?.power),
        toughness: parsePt((permanent as any).baseToughness ?? card?.toughness),
        colors: Array.isArray(card?.colors) ? [...card.colors] : [],
        abilities: keywords.map((keyword: unknown) => String(keyword || '')),
        hasHaste: keywords.some((keyword: unknown) => String(keyword || '').toLowerCase() === 'haste'),
      },
    });
  }

  return mutations;
}

function collectDiscardReplayMutations(
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  appliedResult: Record<string, unknown>,
  state: GameState,
  ctx: OracleIRExecutionContext,
): OracleIRReplayMutation[] {
  const cards = Array.isArray(appliedResult.lastDiscardedCards) ? appliedResult.lastDiscardedCards as any[] : [];
  if (cards.length === 0) return [];

  const destination = /\bexile\b/i.test(String(step.raw || '')) ? 'exile' : 'graveyard';
  const byPlayer = new Map<PlayerID, string[]>();

  for (const card of cards) {
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    const playerId = String(card?.discardedByPlayerId || '').trim() as PlayerID;
    const resolvedPlayerId = playerId || resolvePlayers(state, step.who, ctx)[0] || ctx.controllerId;
    const list = byPlayer.get(resolvedPlayerId) || [];
    list.push(cardId);
    byPlayer.set(resolvedPlayerId, list);
  }

  return [...byPlayer.entries()]
    .filter(([, cardIds]) => cardIds.length > 0)
    .map(([playerId, cardIds]) => ({
      kind: 'discardEffect' as const,
      playerId,
      cardIds,
      destination,
    }));
}

function collectMoveZoneReplayMutations(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  appliedResult: Record<string, unknown>,
  state: GameState,
  ctx: OracleIRExecutionContext,
): OracleIRReplayMutation[] {
  const fromZone = inferMoveZoneSourceFromWhat(step);
  const toZone = resolveMoveZoneDestination(step);
  if (!fromZone || !toZone) return [];

  const movedCards = Array.isArray(appliedResult.lastMovedCards) ? appliedResult.lastMovedCards as any[] : [];
  if (movedCards.length === 0) return [];

  const permanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
    ? (appliedResult.lastMovedBattlefieldPermanentIds as unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const controllerId = resolvePlayers(state, step.battlefieldController || { kind: 'you' }, ctx)[0] || ctx.controllerId;
  const mutations: OracleIRReplayMutation[] = [];

  movedCards.forEach((card, index) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return;

    const fromPlayerId = resolveCardOwnerId(card, ctx.controllerId);
    const playerId = toZone === 'battlefield'
      ? (permanentIds[index]
        ? String((state.battlefield || []).find((perm: any) => String(perm?.id || '') === permanentIds[index])?.controller || controllerId).trim() as PlayerID
        : controllerId)
      : fromPlayerId;

    if (fromZone === 'hand' && toZone === 'battlefield') {
      const permanentId = permanentIds[index] || cardId;
      const permanent = (state.battlefield || []).find((entry: any) => String(entry?.id || '') === permanentId);
      mutations.push({
        kind: 'putCardFromHandOntoBattlefield',
        playerId: fromPlayerId,
        cardId,
        permanentId,
        card,
        tappedAndAttacking: permanent?.isAttacking === true,
      });
      return;
    }

    if (fromZone === 'hand' && toZone === 'graveyard') {
      mutations.push({
        kind: 'discardEffect',
        playerId: fromPlayerId,
        cardIds: [cardId],
        destination: 'graveyard',
      });
      return;
    }

    mutations.push({
      kind: 'effectProgramZoneMove',
      playerId,
      fromPlayerId,
      cardId,
      fromZone,
      toZone,
      card,
      ...(toZone === 'battlefield' && permanentIds[index] ? { permanentId: permanentIds[index] } : {}),
      ...(fromZone === 'battlefield' && permanentIds[index] ? { fromPermanentId: permanentIds[index] } : {}),
    });
  });

  return mutations;
}

export function collectReplayMutationsFromAppliedStep(
  step: OracleEffectStep,
  appliedResult: Record<string, unknown>,
  state: GameState,
  ctx: OracleIRExecutionContext,
): OracleIRReplayMutation[] {
  if (Array.isArray(appliedResult.replayMutations) && appliedResult.replayMutations.length > 0) {
    return appliedResult.replayMutations as OracleIRReplayMutation[];
  }

  switch (step.kind) {
    case 'create_token':
      return buildCreateTokenReplayMutations(state, appliedResult.createdTokenIds as readonly string[] | undefined);
    case 'discard':
      return collectDiscardReplayMutations(step, appliedResult, state, ctx);
    case 'move_zone':
      return collectMoveZoneReplayMutations(step, appliedResult, state, ctx);
    default:
      return [];
  }
}

export function mergeReplayMutations(
  base: readonly OracleIRReplayMutation[],
  next: readonly OracleIRReplayMutation[],
): OracleIRReplayMutation[] {
  if (next.length === 0) return [...base];
  if (base.length === 0) return [...next];
  return [...base, ...next];
}
