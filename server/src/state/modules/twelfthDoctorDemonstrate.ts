// server/src/state/modules/twelfthDoctorDemonstrate.ts
// "The first spell you cast from anywhere other than your hand each turn has
// demonstrate." Detected by oracle pattern, not card name. Stamps
// grantedDemonstrate so the existing demonstrate handler can queue its prompt.
// Public: maybeGrantTwelfthDoctorDemonstrate, hasTwelfthDoctorDemonstrateGrant,
// isCastFromAnywhereOtherThanHand, TWELFTH_DOCTOR_DEMONSTRATE_RE.

export const TWELFTH_DOCTOR_DEMONSTRATE_RE =
  /the first spell you cast from anywhere other than (?:your |a )?hand each turn has demonstrate/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || perm?.oracleText || '')
    .replace(/’/g, "'");
}

const NON_HAND_ZONES = new Set([
  'exile',
  'graveyard',
  'command',
  'command_zone',
  'command zone',
  'library',
  'battlefield',
  'stack',
  'outside',
]);

export function isCastFromAnywhereOtherThanHand(zone: unknown): boolean {
  const raw = String(zone || '').trim().toLowerCase().replace(/^your\s+/, '').replace(/_/g, ' ');
  if (!raw || raw === 'hand') return false;
  if (NON_HAND_ZONES.has(raw)) return true;
  return NON_HAND_ZONES.has(raw.replace(/\s+/g, '_'));
}

export function hasTwelfthDoctorDemonstrateGrant(state: any, playerId: string): boolean {
  const pid = String(playerId || '').trim();
  if (!pid || !state) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '').trim() !== pid) return false;
    return TWELFTH_DOCTOR_DEMONSTRATE_RE.test(oracleOf(perm));
  });
}

function alreadyUsedThisTurn(state: any, playerId: string, currentId: string): boolean {
  const used = (state?.twelfthDoctorDemonstrateUsedThisTurn || {}) as Record<string, boolean | string>;
  const marked = used[playerId];
  if (marked === true) return true;
  if (typeof marked === 'string' && marked && marked !== currentId) return true;
  const list: any[] = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
  return list.some((entry: any) => {
    if (!entry) return false;
    if (String(entry.casterId || entry.controller || entry.playerId || '') !== playerId) return false;
    const entryId = String(entry.cardId || entry.id || entry.spellId || '');
    if (entryId && currentId && entryId === currentId) return false;
    return isCastFromAnywhereOtherThanHand(entry.fromZone || entry.sourceZone || entry.zone || entry.castFromZone);
  });
}

export function maybeGrantTwelfthDoctorDemonstrate(args: {
  state: any;
  playerId: string;
  cardOrItem: any;
  fromZone?: string;
}): boolean {
  const state = args.state;
  const playerId = String(args.playerId || '').trim();
  const item = args.cardOrItem;
  if (!state || !playerId || !item) return false;
  const fromZone = args.fromZone
    || item.fromZone
    || item.sourceZone
    || item.castFromZone
    || item.card?.fromZone
    || item.card?.sourceZone
    || '';
  if (!isCastFromAnywhereOtherThanHand(fromZone)) return false;
  if (!hasTwelfthDoctorDemonstrateGrant(state, playerId)) return false;
  const currentId = String(item.id || item.card?.id || item.sourceId || '').trim();
  if (alreadyUsedThisTurn(state, playerId, currentId)) return false;
  item.grantedDemonstrate = true;
  if (item.card && typeof item.card === 'object') item.card.grantedDemonstrate = true;
  state.twelfthDoctorDemonstrateUsedThisTurn = state.twelfthDoctorDemonstrateUsedThisTurn || {};
  state.twelfthDoctorDemonstrateUsedThisTurn[playerId] = currentId || true;
  return true;
}
