// Origin parent: server/src/socket/game-actions-handlers/gameActionsCastSpellFromHandCostConvoke.ts
// Cluster: remember why a cast payment stopped before the payment checkpoint exists,
//   so the requeued mana step can show the reason instead of a blank retry.
// Public: rememberCastSpellPaymentFailure.

export function rememberCastSpellPaymentFailure(
  game: any,
  socket: { emit?: (event: string, payload: any) => void } | null | undefined,
  payload: { code: string; message: string },
): void {
  if (game?.state) {
    (game.state as any)._lastCastPaymentFailure = {
      code: payload.code,
      message: payload.message,
    };
  }
  socket?.emit?.('error', payload);
}
