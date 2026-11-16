// rules-engine/src/imprintExiledKeywordGrants.ts
// B98: Death-Mask Duplicant — "As long as a card exiled with this creature has
// flying, this creature has flying. The same is true for …"
// Public: parseImprintExiledKeywordList, imprintExiledGrantsKeyword.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalize(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function escapeRegExpWord(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const IMPRINT_KEYWORD_RE = /as long as a card exiled with (?:this creature|~|it) has flying, (?:this creature|~|it) has flying\. the same is true for ([^.]+)\./i;

export function parseImprintExiledKeywordList(oracle: string): string[] {
  const text = normalize(oracle).toLowerCase();
  const m = text.match(IMPRINT_KEYWORD_RE);
  if (!m) {
    if (/as long as a card exiled with (?:this creature|~|it) has flying/i.test(text)) return ['flying'];
    return [];
  }
  const rest = String(m[1] || '');
  const names = rest.split(/,| and /i).map((p) => p.trim()).filter(Boolean);
  return ['flying', ...names];
}

export function cardsExiledWithPermanent(perm: any, state?: any): any[] {
  const direct = perm?.imprintedCards || perm?.exiledWith || perm?.linkedExiledCards;
  if (Array.isArray(direct) && direct.length) return direct;
  const id = String(perm?.id || '');
  if (!id || !state) return [];
  const out: any[] = [];
  const bags: any[] = [];
  if (Array.isArray(state.players)) {
    for (const p of state.players) if (Array.isArray(p?.exile)) bags.push(p.exile);
  }
  if (state.zones && typeof state.zones === 'object') {
    for (const z of Object.values(state.zones) as any[]) {
      if (Array.isArray(z?.exile)) bags.push(z.exile);
    }
  }
  if (Array.isArray(state.exile)) bags.push(state.exile);
  for (const exile of bags) {
    for (const card of exile) {
      const linked = String(card?.exiledBy || card?.imprintedBy || card?.linkedPermanentId || '');
      if (linked && linked === id) out.push(card);
    }
  }
  return out;
}

function cardHasKeywordOrProtection(card: any, keyword: string): boolean {
  const kw = String(keyword || '').toLowerCase();
  const oracle = String(card?.oracle_text || card?.card?.oracle_text || '');
  const kws = Array.isArray(card?.keywords) ? card.keywords : (Array.isArray(card?.card?.keywords) ? card.card.keywords : []);
  if (kws.some((k: any) => String(k).toLowerCase() === kw || String(k).toLowerCase().startsWith(kw + ' '))) return true;
  if (kw === 'landwalk') return /\b(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk|landwalk)\b/i.test(oracle) || kws.some((k: any) => /walk/i.test(String(k)));
  if (kw === 'protection') return /\bprotection from\b/i.test(oracle) || kws.some((k: any) => String(k).toLowerCase().startsWith('protection'));
  return new RegExp('\\b' + escapeRegExpWord(kw) + '\\b', 'i').test(oracle.split('\n')[0] || oracle);
}

export function imprintExiledGrantsKeyword(perm: any, keyword: string, state?: any): boolean {
  const list = parseImprintExiledKeywordList(oracleOf(perm));
  const kw = String(keyword || '').toLowerCase();
  if (!list.some((k) => k.toLowerCase() === kw || (kw.startsWith('protection') && k.toLowerCase() === 'protection'))) return false;
  const wanted = kw === 'protection' || kw.startsWith('protection') ? 'protection' : kw;
  return cardsExiledWithPermanent(perm, state).some((card) => cardHasKeywordOrProtection(card, wanted));
}
