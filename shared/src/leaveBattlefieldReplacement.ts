function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasLeaveBattlefieldExileReplacement(obj: any): boolean {
  if (String(obj?.leaveBattlefieldReplacement || '').trim().toLowerCase() === 'exile') {
    return true;
  }

  if (String(obj?.card?.leaveBattlefieldReplacement || '').trim().toLowerCase() === 'exile') {
    return true;
  }

  const oracleText = normalizeText(obj?.oracle_text || obj?.card?.oracle_text || '');
  return oracleText.includes('if it would leave the battlefield, exile it instead of putting it anywhere else');
}

export function getLeaveBattlefieldDestination(
  obj: any,
  destination: 'graveyard' | 'exile' | 'hand'
): 'graveyard' | 'exile' | 'hand' {
  if (destination === 'exile') return 'exile';
  return hasLeaveBattlefieldExileReplacement(obj) ? 'exile' : destination;
}
