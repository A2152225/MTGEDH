// server/src/state/modules/staticEffectSpecCommanderCondition.ts
// Condition kind 'controls_your_commander': "as long as you control your commander" (Commander Legends /
// Lieutenant-style statics). A commander is identified by state.commandZone[player].commanderIds (card ids) or
// by an isCommander flag on the permanent or its card; "your" commander means one you own.
// Public entry symbols: parseCommanderCondition, controlsOwnCommander.

export function parseCommanderCondition(raw: string): { kind: string } | null {
  const c = String(raw || '').toLowerCase().replace(/[.,]+$/, '').trim();
  return /^you control (?:your|a) commander$/.test(c) ? { kind: 'controls_your_commander' } : null;
}

export function controlsOwnCommander(controllerId: string, battlefield: readonly any[], state: any): boolean {
  const controller = String(controllerId || '').trim();
  if (!controller) return false;
  const ids = new Set<string>(
    (Array.isArray(state?.commandZone?.[controller]?.commanderIds) ? state.commandZone[controller].commanderIds : [])
      .map((id: unknown) => String(id || '').trim()).filter(Boolean),
  );
  return (battlefield || []).some((perm: any) => {
    if (!perm || perm.phasedOut || String(perm.controller || '') !== controller) return false;
    const owner = String(perm.owner || perm.card?.owner || controller);
    if (owner !== controller) return false;
    if (perm.isCommander === true || perm.card?.isCommander === true) return true;
    return ids.has(String(perm.card?.id || '')) || ids.has(String(perm.id || ''));
  });
}
