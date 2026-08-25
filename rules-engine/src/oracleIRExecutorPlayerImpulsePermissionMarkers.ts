// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: applyImpulsePermissionMarkers (impulse play/cast exile permission stamps).
// Public entries: applyImpulsePermissionMarkers.

import type { GameState, PlayerID } from '../../shared/src';

export function applyImpulsePermissionMarkers(
  state: GameState,
  playerId: PlayerID,
  exiledCards: readonly any[],
  meta: {
    readonly permission: 'play' | 'cast';
    readonly playableUntilTurn: number | null;
    readonly condition?: any;
    readonly exiledBy?: string;
    readonly permissionRecipient?: PlayerID;
    readonly withoutPayingManaCost?: boolean;
    readonly spendManaAsThoughAnyType?: boolean;
  }
): { state: GameState; granted: number } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, granted: 0 };

  const exileArr: any[] = Array.isArray(player.exile) ? [...player.exile] : [];
  if (exileArr.length === 0 || exiledCards.length === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  const permissionRecipient = String(meta.permissionRecipient || playerId).trim() || playerId;
  stateAny.playableFromExile[permissionRecipient] = stateAny.playableFromExile[permissionRecipient] || {};

  const playableUntilTurn = meta.playableUntilTurn;
  const resolvedPlayableUntilTurn = (
    typeof playableUntilTurn === 'number' && Number.isFinite(playableUntilTurn)
      ? playableUntilTurn
      : Number.MAX_SAFE_INTEGER
  );
  const condition = meta.condition as any;

  let granted = 0;

  const exiledIds = new Set(exiledCards.map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '')));

  const shouldGrant = (card: any): boolean => {
    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isLand = typeLineLower.includes('land');
    const colors = Array.isArray(card?.colors) ? card.colors.map((x: any) => String(x || '').toUpperCase()) : [];

    const passesPermissionGate = meta.permission === 'play' ? true : !isLand;
    let passesConditionGate = true;
    if (condition) {
      if (condition.kind === 'type') {
        passesConditionGate = condition.type === 'land' ? isLand : !isLand;
      } else if (condition.kind === 'color') {
        passesConditionGate = colors.includes(condition.color);
      }
    }
    return passesPermissionGate && passesConditionGate;
  };

  for (let i = 0; i < exileArr.length; i++) {
    const card = exileArr[i];
    const id = String(card?.id ?? card?.cardId ?? '');
    if (!id || !exiledIds.has(id)) continue;

    const grant = shouldGrant(card);
    const next = {
      ...card,
      zone: 'exile',
      ...(meta.exiledBy ? { exiledBy: meta.exiledBy } : {}),
      ...(grant ? { canBePlayedBy: permissionRecipient, playableUntilTurn: resolvedPlayableUntilTurn } : {}),
      ...(grant && meta.withoutPayingManaCost ? { withoutPayingManaCost: true, castWithoutPayingManaCost: true } : {}),
      ...(grant && meta.spendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
    };
    exileArr[i] = next;

    if (grant) {
      stateAny.playableFromExile[permissionRecipient][id] = resolvedPlayableUntilTurn;
      granted++;
    }
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...(p as any), exile: exileArr } as any) : p));
  let nextState = { ...(stateAny as any), players: updatedPlayers as any } as GameState;

  const zones = (nextState as any).zones;
  if (zones && typeof zones === 'object' && Array.isArray(zones[playerId]?.exile)) {
    const zoneExile = zones[playerId].exile as any[];
    let zoneChanged = false;
    const updatedZoneExile = zoneExile.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !exiledIds.has(id)) return card;
      const grant = shouldGrant(card);
      const next = {
        ...card,
        zone: 'exile',
        ...(meta.exiledBy ? { exiledBy: meta.exiledBy } : {}),
        ...(grant ? { canBePlayedBy: permissionRecipient, playableUntilTurn: resolvedPlayableUntilTurn } : {}),
        ...(grant && meta.withoutPayingManaCost ? { withoutPayingManaCost: true, castWithoutPayingManaCost: true } : {}),
        ...(grant && meta.spendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
      };
      if (next !== card) zoneChanged = true;
      return next;
    });
    if (zoneChanged) {
      (nextState as any).zones = {
        ...zones,
        [playerId]: {
          ...zones[playerId],
          exile: updatedZoneExile,
        },
      };
    }
  }

  return { state: nextState, granted };
}

