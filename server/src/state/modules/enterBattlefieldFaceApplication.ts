/**
 * Apply CR 701.27j / 701.28h / 712.11 enter-face decisions to battlefield
 * permanents and stack objects. Routes all gameplay paths through
 * rules-engine/src/enterBattlefieldTransformedOrConverted.js.
 */
import {
  applyBackFaceCharacteristicsToCard,
  resolveEnterFaceForCard,
  type EnterFaceIntent,
  type EnterFaceSourceZone,
  type EnterTransformedOrConvertedDecision,
} from '../../../../rules-engine/src/enterBattlefieldTransformedOrConverted.js';

export type { EnterTransformedOrConvertedDecision };

export function applyEnterBackFaceToPermanent(permanent: any): void {
  if (!permanent?.card) return;
  permanent.card = applyBackFaceCharacteristicsToCard({ ...permanent.card });
  permanent.transformed = true;
  const typeLine = String(permanent.card.type_line || '').toLowerCase();
  if (typeLine.includes('creature')) {
    permanent.basePower = parseInt(String(permanent.card.power ?? '0'), 10) || 0;
    permanent.baseToughness = parseInt(String(permanent.card.toughness ?? '0'), 10) || 0;
  } else {
    delete permanent.basePower;
    delete permanent.baseToughness;
    permanent.summoningSickness = false;
  }
}

export function resolveAndApplyEnterFace(
  permanent: any,
  args: {
    readonly sourceZone: EnterFaceSourceZone;
    readonly intent?: EnterFaceIntent;
    readonly dayNight?: unknown;
    readonly extra?: unknown;
    readonly representingCard?: any;
    readonly stackFaceAlreadyBack?: boolean;
  },
): EnterTransformedOrConvertedDecision {
  const card = permanent?.card ?? permanent;
  const decision = resolveEnterFaceForCard(card, args);
  if (decision.outcome === 'enter_back_face') {
    if (permanent?.card) applyEnterBackFaceToPermanent(permanent);
    else if (permanent && typeof permanent === 'object' && ('type_line' in permanent || 'card_faces' in permanent)) {
      const next = applyBackFaceCharacteristicsToCard(permanent);
      Object.assign(permanent, next);
    }
  }
  return decision;
}

export function putCardIntoOwnerGraveyardFromFailedEntry(
  state: any,
  card: any,
  ownerId: string,
): void {
  const owner = String(ownerId || card?.owner || '').trim();
  if (!state || !owner) return;
  state.zones = state.zones || {};
  const zones = state.zones[owner] || { graveyard: [], graveyardCount: 0, hand: [], handCount: 0 };
  state.zones[owner] = zones;
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  const nextCard: any = { ...card, zone: 'graveyard' };
  delete nextCard.transformed;
  delete nextCard.currentFace;
  delete nextCard.faceIndex;
  zones.graveyard.push(nextCard);
  zones.graveyardCount = zones.graveyard.length;
}

export function restoreCardToZone(
  state: any,
  card: any,
  ownerId: string,
  zoneName: string,
): void {
  const owner = String(ownerId || '').trim();
  const zone = String(zoneName || '').trim().toLowerCase();
  if (!state || !owner || !zone) return;
  if (zone === 'stack') {
    putCardIntoOwnerGraveyardFromFailedEntry(state, card, owner);
    return;
  }
  state.zones = state.zones || {};
  const zones = state.zones[owner] || {};
  state.zones[owner] = zones;
  const list = Array.isArray(zones[zone]) ? zones[zone] : [];
  zones[zone] = list;
  list.push({ ...card, zone });
  const countKey = zone + 'Count';
  if (typeof zones[countKey] === 'number' || zones[countKey] == null) zones[countKey] = list.length;
}
