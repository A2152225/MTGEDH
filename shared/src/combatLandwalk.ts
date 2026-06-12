export const LANDWALK_TYPES = [
  { keyword: 'plainswalk', subtype: 'plains', label: 'Plains' },
  { keyword: 'islandwalk', subtype: 'island', label: 'Island' },
  { keyword: 'swampwalk', subtype: 'swamp', label: 'Swamp' },
  { keyword: 'mountainwalk', subtype: 'mountain', label: 'Mountain' },
  { keyword: 'forestwalk', subtype: 'forest', label: 'Forest' },
] as const;

type BattlefieldLikePermanent = {
  controller?: string;
  card?: { type_line?: string; oracle_text?: string; keywords?: readonly string[] };
  type_line?: string;
  oracle_text?: string;
  grantedAbilities?: readonly unknown[];
};

export function playerControlsLandWithSubtype(
  battlefield: ReadonlyArray<BattlefieldLikePermanent>,
  playerId: string | undefined,
  landSubtype: string,
): boolean {
  if (!playerId) return false;
  const normalizedSubtype = landSubtype.toLowerCase();
  const subtypePattern = new RegExp(`\\b${normalizedSubtype}\\b`, 'i');

  return battlefield.some((perm) => {
    if (!perm || String(perm.controller) !== String(playerId)) return false;
    const typeLine = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
    if (!typeLine.includes('land')) return false;
    return subtypePattern.test(typeLine);
  });
}

export function permanentTextHasLandwalk(permanent: BattlefieldLikePermanent | undefined, walkKeyword: string): boolean {
  if (!permanent) return false;
  const normalized = walkKeyword.toLowerCase();
  const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '').toLowerCase();
  const keywords = Array.isArray(permanent.card?.keywords)
    ? permanent.card.keywords.map((keyword) => String(keyword).toLowerCase())
    : [];
  const granted = Array.isArray(permanent.grantedAbilities)
    ? permanent.grantedAbilities.map((entry) => String(entry || '').toLowerCase())
    : [];

  return keywords.includes(normalized)
    || new RegExp(`\\b${normalized}\\b`).test(oracle)
    || granted.some((entry) => entry.includes(normalized));
}

export function permanentHasLandwalk(
  permanent: BattlefieldLikePermanent | undefined,
  walkKeyword: string,
  battlefield?: ReadonlyArray<BattlefieldLikePermanent>,
): boolean {
  if (permanentTextHasLandwalk(permanent, walkKeyword)) return true;
  if (!permanent || !battlefield?.length) return false;

  const controllerId = permanent.controller;
  const normalized = walkKeyword.toLowerCase();
  if (!controllerId) return false;

  for (const source of battlefield) {
    if (!source?.card?.oracle_text || source.controller !== controllerId) continue;
    const oracle = source.card.oracle_text.toLowerCase();
    const grantPattern = new RegExp(`creatures?\\s+(?:you\\s+control\\s+)?have\\s+${normalized}`, 'i');
    if (!grantPattern.test(oracle)) continue;
    const typeLine = String(permanent.card?.type_line || permanent.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) return true;
  }

  return false;
}

export function getLandwalkUnblockableReason(
  attacker: BattlefieldLikePermanent | undefined,
  defendingPlayerId: string | undefined,
  battlefield: ReadonlyArray<BattlefieldLikePermanent>,
): string | undefined {
  for (const entry of LANDWALK_TYPES) {
    if (!permanentHasLandwalk(attacker, entry.keyword, battlefield)) continue;
    if (playerControlsLandWithSubtype(battlefield, defendingPlayerId, entry.subtype)) {
      return `Attacker has ${entry.keyword} and defending player controls a ${entry.label}`;
    }
  }
  return undefined;
}
