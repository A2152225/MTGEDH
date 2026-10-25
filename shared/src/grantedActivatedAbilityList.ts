/**
 * Canonical ordered list of granted activated-ability lines on a permanent.
 * Shared by the client ability buttons (ids `<cardId>-granted-<n>`) and the server
 * activation handler so both resolve the same `<n>`.
 * Continuous (spec-system) grants arrive lowercased; canonicalize restores `{T}`-style symbols.
 * Public: canonicalizeGrantedAbilityText, normalizeGrantedActivatedAbilityLine, listGrantedActivatedAbilityLines.
 */

const TAP_FOR_TOKENS: Record<string, string> = {
  tap_for_any_color: '{T}: Add one mana of any color.',
  tap_for_green: '{T}: Add {G}.',
  tap_for_white: '{T}: Add {W}.',
  tap_for_blue: '{T}: Add {U}.',
  tap_for_black: '{T}: Add {B}.',
  tap_for_red: '{T}: Add {R}.',
};

/**
 * Upper-case mana/tap symbols, the first letter, the effect's first letter and each later sentence
 * ("{t}: add {c}{c}. spend this mana only ..." -> "{T}: Add {C}{C}. Spend this mana only ...").
 * Index parity is unaffected: order is unchanged and dedupe keys are lowercased.
 */
export function canonicalizeGrantedAbilityText(text: string): string {
  const withSymbols = String(text || '').trim().replace(/\{[^}]*\}/g, (sym) => sym.toUpperCase());
  const upFirst = (_m: string, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`;
  return withSymbols
    .replace(/^([^A-Za-z{]*)([a-z])/, upFirst)
    .replace(/^([^:]*:\s*)([a-z])/, upFirst)
    .replace(/([.!?]\s+)([a-z])/g, upFirst);
}

/** One granted entry -> activated ability line, or null for keywords / triggers / statics. */
export function normalizeGrantedActivatedAbilityLine(entry: string): string | null {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const token = TAP_FOR_TOKENS[raw.toLowerCase()];
  if (token) return token;

  const quoted = raw.match(/["\u201C\u201D]([^"\u201C\u201D]*:[^"\u201C\u201D]*)["\u201C\u201D]/);
  if (quoted?.[1]) return canonicalizeGrantedAbilityText(quoted[1]);

  if (/^(when|whenever|at)\b/i.test(raw)) return null;
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const cost = raw.slice(0, colon);
  if (/\{[^}]+\}/.test(cost) || /^(Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap|Return|Put)\b/i.test(raw)) {
    return canonicalizeGrantedAbilityText(raw);
  }
  return null;
}

/**
 * Index n of this list is the ability behind id `<cardId>-granted-<n>`. Duplicates collapse
 * (Cryptolith Rite grants both `tap_for_any_color` and its quoted text, which normalize alike).
 */
export function listGrantedActivatedAbilityLines(entries: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const line = normalizeGrantedActivatedAbilityLine(String(entry || ''));
    const key = line?.toLowerCase().replace(/\.$/, '');
    if (line && key && !seen.has(key)) {
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}
