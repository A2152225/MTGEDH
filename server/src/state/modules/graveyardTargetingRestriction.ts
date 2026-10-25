/**
 * Graveyard targeting restrictions (Ground Seal, Silent Gravestone, Dennick):
 * "Cards in graveyards can't be the targets of spells or abilities."
 * Also "Cards in your graveyard can't be the targets of spells or abilities your opponents control."
 */

function permanentOracleText(perm: any): string {
  if (!perm || perm.isFaceDown) return '';
  const card = perm.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  const texts = [card.oracle_text, ...faces.map((f: any) => f?.oracle_text)].filter(Boolean);
  if (Array.isArray(perm.grantedAbilities)) texts.push(...perm.grantedAbilities.filter((a: any) => typeof a === 'string'));
  return texts.join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

const ALL_GRAVEYARDS = /cards in graveyards can't be the targets of spells or abilities/;
const YOUR_GRAVEYARD_OPPONENTS = /cards in your graveyard can't be the targets of spells or abilities your opponents control/;
const YOUR_GRAVEYARD_ANY = /cards in your graveyard can't be the targets of spells or abilities(?! your opponents)/;

/** True when cards in ownerId's graveyard can't be targeted by spells/abilities controlled by targetingPlayerId. */
export function graveyardCardsAreUntargetable(state: any, targetingPlayerId?: string, graveyardOwnerId?: string): boolean {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    const text = permanentOracleText(perm);
    if (!text || !text.includes("can't be the targets")) continue;
    if (ALL_GRAVEYARDS.test(text)) return true;
    const ctrl = String(perm.controller || '');
    if (graveyardOwnerId !== undefined && ctrl === String(graveyardOwnerId)) {
      if (YOUR_GRAVEYARD_ANY.test(text)) return true;
      if (YOUR_GRAVEYARD_OPPONENTS.test(text) && targetingPlayerId !== undefined && String(targetingPlayerId) !== ctrl) return true;
    }
  }
  return false;
}

export function filterTargetableGraveyardCards<T>(state: any, targetingPlayerId: string, graveyardOwnerId: string, cards: T[]): T[] {
  return graveyardCardsAreUntargetable(state, targetingPlayerId, graveyardOwnerId) ? [] : cards;
}