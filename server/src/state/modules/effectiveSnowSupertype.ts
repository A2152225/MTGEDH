// server/src/state/modules/effectiveSnowSupertype.ts
// Layer 4 supertype additions (CR 205.4): "Enchanted land is snow." (Glittering Frost), "Lands you control are
// snow" / "All permanents are snow" style statics. Printed snow is kept.
// Public entry symbols: permanentIsSnowNow.

const ATTACHED_RE = /\benchanted (land|permanent|creature|artifact) is snow\b/i;
const GLOBAL_RE = /(?:^|[.\n]\s*)(?:all |each )?(lands?|permanents?|creatures?|artifacts?)( you control| your opponents control)? (?:are|is) snow\b/i;

export function permanentIsSnowNow(state: any, perm: any, typeLine?: string): boolean {
  const line = String(typeLine ?? perm?.typeSetOverride?.typeLine ?? perm?.card?.type_line ?? '').toLowerCase();
  if (/\bsnow\b/.test(String(perm?.card?.type_line || '').toLowerCase())) return true;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const id = String(perm?.id || '');
  return battlefield.some((src: any) => {
    if (!src?.card || src.phasedOut) return false;
    const text = String(src.card.oracle_text || '');
    if (id && String(src.attachedTo || '') === id && ATTACHED_RE.test(text)) return true;
    const m = GLOBAL_RE.exec(text);
    if (!m) return false;
    const kind = m[1].toLowerCase().replace(/s$/, '');
    if (kind !== 'permanent' && !line.includes(kind)) return false;
    const same = String(src.controller || '') === String(perm?.controller || '');
    if (/you control/i.test(m[2] || '') && !same) return false;
    if (/opponents/i.test(m[2] || '') && same) return false;
    return true;
  });
}
