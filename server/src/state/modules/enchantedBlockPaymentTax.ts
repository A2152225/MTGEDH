// server/src/state/modules/enchantedBlockPaymentTax.ts
// Awesome Presence family: "Enchanted creature can't be blocked unless defending
// player pays {N} for each creature they control that's blocking it."
// The declare-blockers path adds this onto the existing pay-or-cancel block cost prompt.
// Public: collectEnchantedCreatureBlockPayment.

const PAY_PER_BLOCKER_RE =
  /enchanted creature can't be blocked unless defending player pays \{(\d+)\} for each creature they control that's blocking it/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

export function collectEnchantedCreatureBlockPayment(
  state: any,
  defendingPlayerId: string,
  assignments: ReadonlyArray<{ blockerId?: string; attackerId?: string }>,
): { cost: number; sources: string[] } {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const byId = new Map<string, any>(battlefield.map((perm: any) => [String(perm?.id || ''), perm]));
  let cost = 0;
  const sources: string[] = [];
  const defender = String(defendingPlayerId || '');
  for (const aura of battlefield) {
    if (!aura || aura.phasedOut === true) continue;
    const match = oracleOf(aura).match(PAY_PER_BLOCKER_RE);
    if (!match) continue;
    const per = Number(match[1]);
    if (!Number.isFinite(per) || per <= 0) continue;
    const hostId = String(aura.attachedTo || '');
    if (!hostId) continue;
    const blocking = assignments.filter((entry) => {
      if (String(entry?.attackerId || '') !== hostId) return false;
      const blocker = byId.get(String(entry?.blockerId || ''));
      return blocker && String(blocker.controller || '') === defender;
    }).length;
    if (blocking <= 0) continue;
    cost += per * blocking;
    const name = String(aura?.card?.name || 'an Aura');
    if (!sources.includes(name)) sources.push(name);
  }
  return { cost, sources };
}
