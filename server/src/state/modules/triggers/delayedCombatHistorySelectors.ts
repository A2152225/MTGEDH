/**
 * Resolves combat-history selectors in delayed "at this turn's next end of combat" effects
 * (Venomous Breath, Gaze of the Gorgon, Glyph of Doom, Triton Tactics) into concrete
 * permanents when the delayed trigger fires, so the effect can act on "those creatures".
 */

const SELECTOR_RE =
  /\b(?:all|each) creatures? that (blocked or (?:were|was) blocked by|(?:were|was) blocked by|blocked) (it|that creature|one of those creatures|those creatures|target creature) this turn\b/i;

function idsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(v || '').trim();
  return s ? [s] : [];
}

export function resolveDelayedCombatHistorySelector(
  effect: string,
  referenceIds: string[],
  battlefield: any[],
): { effect: string; ids: string[] } | null {
  const m = SELECTOR_RE.exec(String(effect || ''));
  if (!m) return null;
  const relation = m[1].toLowerCase();
  const refs = new Set(referenceIds.map(String).filter(Boolean));
  const wantBlockers = relation.includes('blocked by');
  const wantBlocked = relation.startsWith('blocked');
  const out = new Set<string>();
  for (const p of battlefield || []) {
    const id = String(p?.id || '');
    if (!id) continue;
    // creatures blocked by a reference creature (attackers the reference blocked)
    if (wantBlockers && idsOf(p?.blockedBy).some((b) => refs.has(b))) out.add(id);
    if (wantBlockers) for (const r of refs) { const rp = battlefield.find((x: any) => String(x?.id) === r); if (idsOf(rp?.blocking).includes(id)) out.add(id); }
    // creatures that blocked a reference creature
    if (wantBlocked && idsOf(p?.blocking).some((a) => refs.has(a))) out.add(id);
    if (wantBlocked) for (const r of refs) { const rp = battlefield.find((x: any) => String(x?.id) === r); if (idsOf(rp?.blockedBy).includes(id)) out.add(id); }
  }
  for (const r of refs) out.delete(r);
  const plural = /^each/i.test(m[0]) ? 'those creatures' : 'those creatures';
  return { effect: effect.replace(m[0], plural), ids: [...out] };
}
