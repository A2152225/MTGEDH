// server/src/state/modules/batch91BlitzCastGrants.ts
// B91: "Each creature spell you cast with mana value N or greater has blitz.
// The blitz cost is equal to its mana cost." (Henzie "Toolbox" Torre).
// Also "Blitz costs you pay cost {1} less for each time you've cast your
// commander from the command zone this game."
// Public: parseBatch91BlitzGrantSentence, getGrantedBlitzAlternateCost,
// countCommanderCastsFromCommandZone, reduceBlitzManaCostByCommanderTaxDiscount.

const GRANT_RE =
  /each creature spell you cast with mana value (\d+|[a-z]+) or greater has blitz(?:\. the blitz cost is equal to its mana cost)?/i;

const WORD_COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseThreshold(raw: string): number | undefined {
  const t = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_COUNTS[t];
}

function cardManaValue(card: any): number {
  const c = card?.card || card;
  const cmc = Number(c?.cmc ?? c?.mana_value ?? c?.manaValue);
  if (Number.isFinite(cmc)) return cmc;
  let mv = 0;
  for (const sym of String(c?.mana_cost || c?.manaCost || '').match(/\{[^}]+\}/g) || []) {
    const s = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(s)) mv += parseInt(s, 10);
    else if (s !== 'X') mv += 1;
  }
  return mv;
}

function isCreatureSpell(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || card?.card?.type_line || '').toLowerCase();
  return /\bcreature\b/.test(tl);
}

function normalizeOracle(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.card?.oracleText || perm?.oracle_text || perm?.oracleText || '');
}

export function parseBatch91BlitzGrantSentence(oracle: string): { minManaValue: number } | undefined {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(GRANT_RE);
  if (!m) return undefined;
  const n = parseThreshold(m[1]);
  if (!Number.isFinite(n as number)) return undefined;
  return { minManaValue: n as number };
}

export function countCommanderCastsFromCommandZone(state: any, playerId: string): number {
  const pid = String(playerId || '').trim();
  if (!pid) return 0;
  const direct = Number(
    state?.commanderCastCount?.[pid]
    ?? state?.timesCastCommanderFromCommandZone?.[pid]
    ?? state?.commandZone?.[pid]?.castCount,
  );
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
  const list = Array.isArray(state?.spellsCastThisGame) ? state.spellsCastThisGame
    : Array.isArray(state?.commanderCasts) ? state.commanderCasts
    : [];
  let n = 0;
  for (const entry of list) {
    if (String(entry?.casterId || entry?.controller || entry?.playerId || '') !== pid) continue;
    if (entry?.fromCommandZone === true || entry?.castFrom === 'command' || entry?.isCommanderCast === true) n += 1;
  }
  return n;
}

export function reduceBlitzManaCostByCommanderTaxDiscount(manaCost: string, discount: number): string {
  const cost = String(manaCost || '').trim();
  if (!cost || !(discount > 0)) return cost;
  const symbols = cost.match(/\{[^}]+\}/g) || [];
  if (!symbols.length) return cost;
  let remaining = Math.floor(discount);
  const out: string[] = [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    if (remaining > 0 && /^\d+$/.test(inner)) {
      const n = parseInt(inner, 10);
      const next = Math.max(0, n - remaining);
      remaining -= Math.min(n, remaining);
      if (next > 0) out.push(`{${next}}`);
    } else {
      out.push(sym);
    }
  }
  return out.join('') || '{0}';
}

function grantsBlitzCostDiscount(oracle: string): boolean {
  return /blitz costs you pay cost \{1\} less for each time you've cast your commander from the command zone this game/i.test(
    String(oracle || '').replace(/\u2019/g, "'"),
  );
}

export function getGrantedBlitzAlternateCost(
  state: any,
  playerId: string,
  card: any,
): { manaCost: string; sourceName: string; sourceId: string } | undefined {
  if (!isCreatureSpell(card)) return undefined;
  const mv = cardManaValue(card);
  const pid = String(playerId || '').trim();
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let grant: { manaCost: string; sourceName: string; sourceId: string } | undefined;
  let discount = 0;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== pid) continue;
    const oracle = normalizeOracle(perm);
    const parsed = parseBatch91BlitzGrantSentence(oracle);
    if (parsed && mv >= parsed.minManaValue && !grant) {
      const manaCost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || '').replace(/\s+/g, '');
      if (manaCost) {
        grant = {
          manaCost,
          sourceName: String(perm.card?.name || 'Blitz grant').trim(),
          sourceId: String(perm.id || ''),
        };
      }
    }
    if (grantsBlitzCostDiscount(oracle)) {
      discount += countCommanderCastsFromCommandZone(state, pid);
    }
  }
  if (!grant) return undefined;
  if (discount > 0) grant = { ...grant, manaCost: reduceBlitzManaCostByCommanderTaxDiscount(grant.manaCost, discount) };
  return grant;
}

