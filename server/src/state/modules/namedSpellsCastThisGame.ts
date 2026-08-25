/**
 * Origin parent: server/src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.ts
 *
 * Cluster moved: persist of `namedSpellsCastThisGame` `{name,id}` per caster.
 * Shared by live `recordSpellCastThisTurn`, graveyard/castSpell replay, and
 * spell copies (`copyStackItem`). Do not call this from a path that already
 * goes through `recordSpellCastThisTurn`.
 *
 * Public entry symbols: persistNamedSpellCastThisGame
 */

export function persistNamedSpellCastThisGame(
  state: any,
  casterId: string,
  spellCard: { name?: unknown; id?: unknown } | null | undefined,
): void {
  if (!state) return;
  const namedLedger = (state.namedSpellsCastThisGame && typeof state.namedSpellsCastThisGame === 'object'
    && !Array.isArray(state.namedSpellsCastThisGame))
    ? state.namedSpellsCastThisGame
    : {};
  state.namedSpellsCastThisGame = namedLedger;
  if (!Array.isArray(namedLedger[casterId])) {
    namedLedger[casterId] = [];
  }
  namedLedger[casterId].push({
    name: spellCard?.name,
    id: spellCard?.id,
  });
}
