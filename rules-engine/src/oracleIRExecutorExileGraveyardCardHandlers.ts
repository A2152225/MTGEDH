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
      readonly reason:
        | 'no_deterministic_target'
        | 'unsupported_target'
        | 'player_choice_required'
        | 'impossible_action';
      readonly options?: {
        readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      };
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

function listEligibleGraveyardCards(
  state: GameState,
  controllerId: string,
  opponentOnly: boolean,
): Array<{ readonly playerId: PlayerID; readonly card: any }> {
  const out: Array<{ readonly playerId: PlayerID; readonly card: any }> = [];
  const seen = new Set<string>();
  const zones = ((state as any).zones || {}) as Record<string, { graveyard?: any[] }>;
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    if (opponentOnly && playerId === controllerId) continue;
    const piles = [
      ...(Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []),
      ...(Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : []),
    ];
    for (const card of piles) {
      const id = String(card?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ playerId, card });
    }
  }
  return out;
}

function exileFoundGraveyardCard(
  state: GameState,
  found: { readonly playerId: PlayerID; readonly card: any },
): ExileGraveyardCardResult | null {
  const cardId = String(found.card?.id || '').trim();
  if (!cardId) return null;
  const seeded = ensureCardOnPlayerGraveyard(state, found.playerId, found.card);
  const moved = moveTargetedCardFromGraveyard(
    seeded,
    found.playerId,
    cardId,
    { cardType: 'any' },
    'exile',
  );
  if (!moved || moved.kind !== 'applied') return null;
  return {
    applied: true,
    state: syncExiledCardToOwnerZones(moved.state, found.playerId, found.card),
    log: moved.log,
    lastMovedCards: [found.card],
    lastExiledCards: [found.card],
    lastExiledCardCount: 1,
  };
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
  const boundIds = collectBoundCardIds(ctx);
  const candidates: Array<{ readonly playerId: PlayerID; readonly card: any }> = [];

  if (boundIds.length > 0) {
    for (const cardId of boundIds) {
      const found = findGraveyardCard(state, cardId);
      if (!found) continue;
      if (opponentOnly && found.playerId === controllerId) continue;
      candidates.push(found);
    }
  }
  // Leftover battlefield / stack ids in chosenObjectIds are not GY targets.
  if (candidates.length === 0) {
    candidates.push(...listEligibleGraveyardCards(state, controllerId, opponentOnly));
  }

  if (candidates.length === 1) {
    return exileFoundGraveyardCard(state, candidates[0]) || {
      applied: false,
      message: `Skipped exile (no graveyard target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }
  if (candidates.length === 0) {
    return {
      applied: false,
      message: `Skipped exile (no graveyard target): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  return {
    applied: false,
    message: `Skipped exile (choose a graveyard card): ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
