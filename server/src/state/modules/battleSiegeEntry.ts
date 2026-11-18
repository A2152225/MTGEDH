/**
 * Battle / Siege ETB helpers (CR 310): defense counters and protector choice.
 * Siege reminder text is stripped by the oracle reminder scrubber, so protector
 * choice is injected here rather than parsed from oracle IR.
 *
 * Public: readPrintedBattleDefense, isBattleCard, isSiegeCard,
 * applyBattleDefenseCountersOnEntry, getBattleProtectorAsEntersRequirement.
 */

export function isBattleCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  if (/\bbattle\b/.test(typeLine)) return true;
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  return faces.some((face: any) => /\bbattle\b/i.test(String(face?.type_line || face?.typeLine || '')));
}

export function isSiegeCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  if (/\bsiege\b/.test(typeLine)) return true;
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  return faces.some((face: any) => /\bsiege\b/i.test(String(face?.type_line || face?.typeLine || '')));
}

export function readPrintedBattleDefense(card: any): number | null {
  const direct = Number(card?.defense ?? card?.printedDefense);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);

  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  for (const face of faces) {
    const typeLine = String(face?.type_line || face?.typeLine || '').toLowerCase();
    if (!/\bbattle\b/.test(typeLine)) continue;
    const faceDefense = Number(face?.defense);
    if (Number.isFinite(faceDefense) && faceDefense > 0) return Math.floor(faceDefense);
  }
  return null;
}

/**
 * Stamp defense counters equal to printed defense (CR 310.4b).
 */
export function applyBattleDefenseCountersOnEntry(permanent: any, card: any): number | null {
  if (!permanent || !isBattleCard(card)) return null;
  const defense = readPrintedBattleDefense(card);
  if (defense == null) return null;

  permanent.counters = { ...(permanent.counters || {}) };
  permanent.counters.defense = Math.max(Number(permanent.counters.defense || 0), defense);
  permanent.defense = permanent.counters.defense;
  permanent.printedDefense = defense;
  permanent.card = {
    ...(permanent.card || {}),
    defense: String(defense),
    printedDefense: defense,
  };
  return defense;
}

export function getBattleProtectorAsEntersRequirement(card: any): {
  kind: 'opponent';
  mandatory: true;
  reason: string;
  battleProtector: true;
} | null {
  if (!isBattleCard(card)) return null;
  // All battles designate a protector; Sieges make this especially visible.
  return {
    kind: 'opponent',
    mandatory: true,
    reason: isSiegeCard(card)
      ? 'Choose an opponent to protect this Siege'
      : 'Choose an opponent to protect this Battle',
    battleProtector: true,
  };
}
