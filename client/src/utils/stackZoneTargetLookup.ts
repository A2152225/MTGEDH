/**
 * Resolve a stack target id to a graveyard or exile card.
 * Player objects on the table view do not carry zone lists; those live on view.zones.
 * Activated abilities also stamp copyRetargetValidTargets / targetDetails on the stack item.
 *
 * Public entry symbols: lookupStackZoneTarget.
 */

export type StackZoneName = 'graveyard' | 'exile';

export interface StackZoneTargetHit {
  name: string;
  ownerId: string;
  zone: StackZoneName;
  card?: any;
}

function cardName(card: any): string | undefined {
  const direct = card?.name || card?.card?.name;
  if (direct) return String(direct);
  const faces = card?.card_faces || card?.card?.card_faces;
  if (Array.isArray(faces) && faces[0]?.name) return String(faces[0].name);
  return undefined;
}

function zoneFromHint(value: unknown): StackZoneName | undefined {
  const text = String(value || '').toLowerCase();
  if (text.includes('graveyard')) return 'graveyard';
  if (text.includes('exile')) return 'exile';
  return undefined;
}

function hitFromCard(card: any, ownerId: string, zone: StackZoneName): StackZoneTargetHit | undefined {
  const name = cardName(card);
  if (!name) return undefined;
  return { name, ownerId, zone, card };
}

export function lookupStackZoneTarget(args: {
  targetId: string;
  players?: readonly any[] | null;
  zones?: Record<string, { graveyard?: readonly any[]; exile?: readonly any[] } | undefined> | null;
  stack?: readonly any[] | null;
}): StackZoneTargetHit | undefined {
  const targetId = String(args.targetId || '');
  if (!targetId) return undefined;

  for (const player of args.players || []) {
    for (const zone of ['graveyard', 'exile'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const card = cards.find((entry: any) => String(entry?.id || '') === targetId);
      const hit = card ? hitFromCard(card, String(player?.id || ''), zone) : undefined;
      if (hit) return hit;
    }
  }

  for (const [ownerId, playerZones] of Object.entries(args.zones || {})) {
    for (const zone of ['graveyard', 'exile'] as const) {
      const cards = Array.isArray(playerZones?.[zone]) ? playerZones[zone] : [];
      const card = cards.find((entry: any) => String(entry?.id || '') === targetId);
      const hit = card ? hitFromCard(card, ownerId, zone) : undefined;
      if (hit) return hit;
    }
  }

  for (const item of args.stack || []) {
    const hinted = [
      ...(Array.isArray(item?.copyRetargetValidTargets) ? item.copyRetargetValidTargets : []),
      ...(Array.isArray(item?.targetDetails) ? item.targetDetails : []),
    ];
    const match = hinted.find((entry: any) => String(entry?.id || '') === targetId);
    const zone = zoneFromHint(match?.zone || match?.type);
    const name = match?.name ? String(match.name) : '';
    if (!match || !zone || !name) continue;
    const imageUrl = match.imageUrl || match.image_uris?.small;
    return {
      name,
      ownerId: String(match.zoneOwnerId || match.controllerId || match.controller || ''),
      zone,
      card: {
        id: targetId,
        name,
        image_uris: imageUrl ? { small: String(imageUrl), normal: String(imageUrl) } : undefined,
      },
    };
  }

  return undefined;
}
