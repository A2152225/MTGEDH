// server/src/state/modules/legendRuleExemptions.ts
// B43: generic 'The "legend rule" doesn't apply to <group> you control.' statics (Mirror Box, Sliver Gravemother,
// Cadric-style token lines, Mirror Gallery's global form). CR 704.5j is skipped for an exempt legendary.
// Origin parent: legend-rule detection in server/src/rules-engine/index.ts (runSBA path).
// Public entry symbol: isLegendRuleExempt.

const LINE_RE = /the ["\u201c\u201d]legend rule["\u201c\u201d] doesn't apply(?: to ([^.\n]+?))?(?:\.|$)/gim;
// B78: Brothers Yamazaki — "If there are exactly two permanents named ~ on the battlefield, the legend rule doesn't apply to them."
const EXACT_NAMED_RE =
  /if there are exactly (\d+|one|two|three|four|five|six|seven|eight|nine|ten) permanents? named ([^.]+?) on the battlefield, the ["\u201c\u201d]?legend rule["\u201c\u201d]? doesn't apply to them/gim;
const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function oracleText(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').replace(/[\u2018\u2019]/g, "'");
}

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ves')) return w.slice(0, -3) + 'f';
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** True when the group phrase (e.g. "creature tokens you control") covers the permanent, judged from the source's controller. */
function groupCovers(group: string, perm: any, source: any): boolean {
  let g = group.trim().toLowerCase();
  const youControl = / you control$/.test(g);
  if (youControl) {
    if (String(perm?.controller || '') !== String(source?.controller || '')) return false;
    g = g.replace(/ you control$/, '');
  }
  if (/^other /.test(g)) { if (perm === source || perm?.id === source?.id) return false; g = g.replace(/^other /, ''); }
  const typeLine = String(perm?.card?.type_line || '').toLowerCase();
  const isToken = perm?.isToken === true || perm?.card?.isToken === true || /\btoken\b/.test(typeLine);
  const words = g.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  for (const raw of words) {
    const w = singular(raw);
    if (w === 'permanent') continue;
    if (w === 'token') { if (!isToken) return false; continue; }
    if (w === 'nontoken') { if (isToken) return false; continue; }
    if (!new RegExp('\\b' + w + 's?\\b').test(typeLine)) return false;
  }
  return true;
}

export function isLegendRuleExempt(perm: any, battlefield: readonly any[] | undefined): boolean {
  const list = Array.isArray(battlefield) ? battlefield : [];
  for (const src of list) {
    if (!src || src.phasedOut) continue;
    const text = oracleText(src);
    if (!/legend rule/i.test(text)) continue;
    LINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINE_RE.exec(text))) {
      if (!m[1]) return true; // Mirror Gallery: doesn't apply at all.
      if (groupCovers(m[1], perm, src)) return true;
    }
    // B78: exactly-N named permanents (Brothers Yamazaki).
    EXACT_NAMED_RE.lastIndex = 0;
    while ((m = EXACT_NAMED_RE.exec(text))) {
      const raw = String(m[1] || '').toLowerCase();
      const need = /^\d+$/.test(raw) ? Number(raw) : COUNT_WORDS[raw];
      const wanted = String(m[2] || '').trim().toLowerCase().replace(/\u2019/g, "'");
      if (!Number.isFinite(need) || !wanted) continue;
      const named = list.filter((p) => p && !p.phasedOut
        && String(p.card?.name || p.name || '').trim().toLowerCase() === wanted);
      if (named.length === need
        && named.some((p) => String(p.id || '') === String(perm?.id || ''))) {
        return true;
      }
    }
  }
  return false;
}
