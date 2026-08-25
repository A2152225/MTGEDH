// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: findCardZoneLocation, getChosenObjectIdsFromContext,
// resolveTargetOpponentPlayerId, cardMatchesArtifactOrCreature,
// pickArtifactOrCreatureFromPlayerZone.
// Public entries: those helpers.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { cardMatchesType } from './oracleIRExecutorZoneOps';

export type CardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile';
};

export function findCardZoneLocation(state: GameState, targetCardId: string): CardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const matches: CardZoneLocation[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        matches.push({ playerId, zone });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

export function getChosenObjectIdsFromContext(ctx: OracleIRExecutionContext): string[] {
  return Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
}

export function resolveTargetOpponentPlayerId(ctx: OracleIRExecutionContext): PlayerID {
  return String(
    ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
  ).trim() as PlayerID;
}

function cardMatchesArtifactOrCreature(card: any): boolean {
  return cardMatchesType(card, 'artifact_or_creature');
}

export function pickArtifactOrCreatureFromPlayerZone(
  state: GameState,
  playerId: PlayerID,
  zone: 'hand' | 'graveyard',
  excludeIds: ReadonlySet<string> = new Set()
): string {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
  const match = cards.find((card: any) => {
    const cardId = String(card?.id || '').trim();
    return cardId && !excludeIds.has(cardId) && cardMatchesArtifactOrCreature(card);
  });
  return String(match?.id || '').trim();
}

