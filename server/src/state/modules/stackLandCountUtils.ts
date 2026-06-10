import type { PlayerID } from '../../../../shared/src/index.js';

export function checkOpponentHasMoreLands(
  state: any,
  controller: PlayerID,
): { myLandCount: number; anyOpponentHasMoreLands: boolean } {
  const battlefield = state.battlefield || [];
  const players = state.players || [];

  const myLandCount = battlefield.filter(
    (permanent: any) =>
      permanent.controller === controller &&
      (permanent.card?.type_line || '').toLowerCase().includes('land'),
  ).length;

  const opponentIds = players
    .filter((player: any) => player.id !== controller && !player.hasLost)
    .map((player: any) => player.id);

  const anyOpponentHasMoreLands = opponentIds.some((oppId: string) => {
    const oppLandCount = battlefield.filter(
      (permanent: any) =>
        permanent.controller === oppId &&
        (permanent.card?.type_line || '').toLowerCase().includes('land'),
    ).length;
    return oppLandCount > myLandCount;
  });

  return { myLandCount, anyOpponentHasMoreLands };
}
