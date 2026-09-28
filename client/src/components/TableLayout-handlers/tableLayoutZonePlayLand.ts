// client/src/components/TableLayout-handlers/tableLayoutZonePlayLand.ts
// Helpers for zone-card context menu land play enablement.

export type ZonePlayLandZone = 'hand' | 'graveyard' | 'exile' | 'library' | 'commander' | 'battlefield';

export function canPlayLandFromZoneContext(args: {
  zone: ZonePlayLandZone;
  cardId: string;
  playableCards?: string[] | null;
  reasonCannotPlayLand?: string | null;
}): boolean {
  if (args.zone === 'hand') {
    return !args.reasonCannotPlayLand;
  }
  if (args.zone === 'graveyard' || args.zone === 'exile' || args.zone === 'library') {
    return Boolean(args.playableCards?.includes(args.cardId));
  }
  return false;
}

export function reasonCannotPlayLandFromZoneContext(args: {
  zone: ZonePlayLandZone;
  cardId: string;
  playableCards?: string[] | null;
  reasonCannotPlayLand?: string | null;
}): string | null {
  if (args.zone === 'hand') {
    return args.reasonCannotPlayLand ?? null;
  }
  if (args.zone === 'graveyard' || args.zone === 'exile' || args.zone === 'library') {
    return args.playableCards?.includes(args.cardId) ? null : 'Not currently playable from this zone';
  }
  return 'Cannot play a land from this zone';
}
