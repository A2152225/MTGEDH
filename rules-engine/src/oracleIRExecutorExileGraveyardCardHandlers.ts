/**
 * Extracted from oracleIRExecutorBattlefieldStepHandlers.ts: exile a targeted
 * card from a graveyard (Cremate, Vile Rebirth).
 * Public: tryApplyExileTargetCardFromGraveyard
 *
 * "Exile target card from a graveyard" is not a battlefield removal. Bound
 * chosenObjectIds name the graveyard card; the card goes to its owner's exile.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { moveTargetedCardFromGraveyard } from './oracleIRExecutorZoneOps';

type ExileGraveyardCardResult =
  | {
      readonly applied: true;
      readonly state: GameState;
      readonly log: readonly string[];
      readonly lastMovedCards?: readonly any[];
      readonly lastExiledCards?: readonly any[];
      readonly lastExiledCardCount?: number;
    }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'no_deterministic_target' | 'unsupported_target';
    };

function isTargetCardFromGraveyardText(text: string): boolean {
  const normalized = String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/^exile\s+/i, '')
    .trim();
  return /\btarget\b[\s\S]+\b(?:from|in)\s+(?:a|your|an opponent'?s|target opponent'?s)\s+graveyard\b/i.test(
    normalized,
  );
}

function collectBoundCardIds(ctx: OracleIRExecutionContext): string[] {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds
          : []),
        ctx.targetPermanentId,
        ctx.targetCreatureId,
        ctx.selectorContext?.targetPermanentId,
        ctx.selectorContext?.targetCreatureId,
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  );
}

function ensureCardOnPlayerGraveyard(
  state: GameState,
  playerId: PlayerID,
  card: any,
): GameState {
  const cardId = String(card?.id || '').trim();
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  if (graveyard.some((entry: any) => String(entry?.id || '').trim() === cardId)) return state;
  return {
    ...state,
    players: (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === playerId
        ? { ...entry, graveyard: [...graveyard, card] }
        : entry,
    ) as GameState['players'],
  };
}

function syncExiledCardToOwnerZones(
  state: GameState,
  playerId: PlayerID,
  card: any,
): GameState {
  const zones = (state as any).zones;
  if (!zones || typeof zones !== 'object') return state;
  const cardId = String(card?.id || '').trim();
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const exiled =
    (Array.isArray(player?.exile) ? player.exile : []).find(
      (entry: any) => String(entry?.id || '').trim() === cardId,
    ) || { ...card, zone: 'exile' };
  const ownerZones = zones[playerId] || {};
  const nextGraveyard = (Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : []).filter(
    (entry: any) => String(entry?.id || '').trim() !== cardId,
  );
  const nextExile = [
    ...(Array.isArray(ownerZones.exile) ? ownerZones.exile : []).filter(
      (entry: any) => String(entry?.id || '').trim() !== cardId,
    ),
    exiled,
  ];
  return {
    ...state,
    zones: {
      ...zones,
      [playerId]: {
        ...ownerZones,
        graveyard: nextGraveyard,
        graveyardCount: nextGraveyard.length,
        exile: nextExile,
        exileCount: nextExile.length,
      },
    },
  } as GameState;
}

function findGraveyardCard(
  state: GameState,
  cardId: string,
): { readonly playerId: PlayerID; readonly card: any } | null {
  const wanted = String(cardId || '').trim();
  if (!wanted) return null;
  const zones = ((state as any).zones || {}) as Record<string, { graveyard?: any[] }>;
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    const playerGraveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    const zoneGraveyard = Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : [];
    const card = [...playerGraveyard, ...zoneGraveyard].find(
      (entry: any) => String(entry?.id || '').trim() === wanted,
    );
    if (card && playerId) return { playerId, card };
  }
  return null;
}

export function tryApplyExileTargetCardFromGraveyard(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext,
): ExileGraveyardCardResult | null {
  const targetText = [String((step.target as any)?.text || ''), String(step.raw || '')]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!isTargetCardFromGraveyardText(targetText)) return null;

  const opponentOnly = /\b(?:from|in)\s+(?:an|target)\s+opponent'?s\s+graveyard\b/i.test(
    targetText.replace(/\u2019/g, "'"),
  );
  const controllerId = String(ctx.controllerId || '').trim();

  for (const cardId of collectBoundCardIds(ctx)) {
    const found = findGraveyardCard(state, cardId);
    if (!found) continue;
    if (opponentOnly && found.playerId === controllerId) continue;

    const seeded = ensureCardOnPlayerGraveyard(state, found.playerId, found.card);
    const moved = moveTargetedCardFromGraveyard(
      seeded,
      found.playerId,
      cardId,
      { cardType: 'any' },
      'exile',
    );
    if (!moved || moved.kind !== 'applied') continue;
    return {
      applied: true,
      state: syncExiledCardToOwnerZones(moved.state, found.playerId, found.card),
      log: moved.log,
      lastMovedCards: [found.card],
      lastExiledCards: [found.card],
      lastExiledCardCount: 1,
    };
  }

  return {
    applied: false,
    message: `Skipped exile (no graveyard target): ${step.raw}`,
    reason: 'no_deterministic_target',
  };
}
