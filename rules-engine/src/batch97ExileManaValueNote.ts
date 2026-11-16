// rules-engine/src/batch97ExileManaValueNote.ts
// B97: shared exile-path hook for "Note the mana value of each card as it's
// put into exile." (Bell Borca, Spectral Sergeant.) Call this from every
// move-into-exile chokepoint. Public: noteManaValueAsExiled.

const NOTE_RE = /note the mana value of each card as it's put into exile/i;

function cardManaValue(card: any): number {
  const raw = card?.mana_value ?? card?.cmc ?? card?.manaValue ?? card?.card?.mana_value ?? card?.card?.cmc;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  const cost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || '');
  let total = 0;
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cost))) {
    const inner = m[1];
    if (/^\d+$/.test(inner)) total += parseInt(inner, 10);
    else if (/^x$/i.test(inner)) total += 0;
    else total += 1;
  }
  return total;
}

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

/** Stamp each noting permanent with the exiled card's mana value for this turn. */
export function noteManaValueAsExiled(state: any, card: any): void {
  if (!state || !card) return;
  const mv = cardManaValue(card);
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const turn = Number(state.turnNumber ?? state.turn ?? 0);
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    if (!NOTE_RE.test(oracleOf(perm))) continue;
    if (perm.notedManaValuesTurn !== turn) {
      perm.notedManaValuesThisTurn = [];
      perm.notedManaValuesTurn = turn;
    }
    perm.notedManaValuesThisTurn = Array.isArray(perm.notedManaValuesThisTurn) ? perm.notedManaValuesThisTurn : [];
    perm.notedManaValuesThisTurn.push(mv);
  }
}
