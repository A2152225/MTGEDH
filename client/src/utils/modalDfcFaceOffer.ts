// Which faces of a modal double-faced card to offer.
// A land face is not instant speed: while responding (or otherwise outside
// the land-play window) it is omitted. If that leaves one spell face, the
// caller casts it without asking which side.
// Public entry: isLandFaceTypeLine, modalDfcOfferedFaceIndexes.

const LAND_RE = /\bland\b/i;

export function isLandFaceTypeLine(typeLine: string | null | undefined): boolean {
  return LAND_RE.test(String(typeLine || ''));
}

export function modalDfcOfferedFaceIndexes(
  faces: ReadonlyArray<{ type_line?: string | null; typeLine?: string | null } | null | undefined>,
  canPlayLandNow: boolean,
): number[] {
  return faces
    .map((face, index) => ({
      index,
      typeLine: String(face?.type_line ?? face?.typeLine ?? ''),
    }))
    .filter(({ typeLine }) => canPlayLandNow || !isLandFaceTypeLine(typeLine))
    .map(({ index }) => index);
}
