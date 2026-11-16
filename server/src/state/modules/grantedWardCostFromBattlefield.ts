// server/src/state/modules/grantedWardCostFromBattlefield.ts
// Read granted Ward costs (including "Ward—Pay N life") from a permanent's
// continuous abilities or from a battlefield grant such as Cultist of the Absolute.
// Public: extractWardCostText, findBattlefieldGrantedWardCost, findAnyGrantedWardCost.

const LIFE_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function normalizeOracle(text: unknown): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2014\u2013]/g, '-');
}

/** "Ward {2}" or "Ward—Pay 3 life" / "pay 3 life" → the cost string the ward prompt already understands. */
export function extractWardCostText(text: unknown): string | null {
  const raw = normalizeOracle(text);
  const quoted = raw.match(/"ward\s*(?:((?:\{[^}]+\}(?:\s*\{[^}]+\})*))|-\s*([^"]+))"/i);
  if (quoted) {
    const cost = String(quoted[1] || quoted[2] || '').trim().replace(/[.,;]+$/g, '');
    return cost || null;
  }
  const mana = raw.match(/\bward\s*((?:\{[^}]+\}(?:\s*\{[^}]+\})*))/i);
  if (mana) return String(mana[1] || '').trim().toUpperCase();
  const dashed = raw.match(/\bward\s*-\s*([^.]+)/i);
  if (dashed) {
    const cost = String(dashed[1] || '').trim().replace(/[.,;"']+$/g, '');
    return cost || null;
  }
  return null;
}

export function parseWardPayLifeAmount(cost: unknown): number | null {
  const match = normalizeOracle(cost).toLowerCase().match(/\bpay\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (!match) return null;
  const token = String(match[1] || '').toLowerCase();
  const amount = /^\d+$/.test(token) ? Number.parseInt(token, 10) : (LIFE_WORDS[token] ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isCommanderCreature(permanent: any): boolean {
  if (!permanent) return false;
  const typeLine = String(permanent.card?.type_line || permanent.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  return Boolean(
    permanent.isCommander
    || permanent.commander
    || permanent.card?.isCommander
    || permanent.card?.commander
  );
}

function grantAppliesToPermanent(oracle: string, permanent: any, grantController: string): boolean {
  const text = normalizeOracle(oracle);
  if (!/\bward\b/i.test(text)) return false;
  const owner = String(permanent?.owner || permanent?.card?.owner || '');
  const controller = String(permanent?.controller || '');
  if (/\bcommander creatures you own\b/i.test(text)) {
    return isCommanderCreature(permanent) && owner === String(grantController);
  }
  if (/\bcreatures you own\b/i.test(text) && /\bhave\b/i.test(text)) {
    const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
    return typeLine.includes('creature') && owner === String(grantController);
  }
  if (/\bcreatures you control\b/i.test(text) && /\bhave\b/i.test(text)) {
    const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
    return typeLine.includes('creature') && controller === String(grantController);
  }
  return false;
}

function abilityList(permanent: any): string[] {
  const lists = [
    permanent?.continuousAbilities,
    permanent?.grantedAbilities,
    permanent?.grantedKeywords,
    permanent?.keywords,
  ];
  const out: string[] = [];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const entry of list) out.push(String(entry || ''));
    } else if (typeof list === 'string' && list.trim()) {
      out.push(list);
    }
  }
  return out;
}

export function findBattlefieldGrantedWardCost(state: any, permanent: any): string | null {
  if (!permanent || !state) return null;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    const oracle = String(source.card?.oracle_text || source.oracle_text || '');
    const grantController = String(source.controller || '');
    if (!grantAppliesToPermanent(oracle, permanent, grantController)) continue;
    const cost = extractWardCostText(oracle);
    if (cost) return cost;
  }
  return null;
}

export function findAnyGrantedWardCost(permanent: any, state?: any): string | null {
  if (!permanent) return null;
  if (typeof permanent.wardCost === 'string' && permanent.wardCost.trim()) return permanent.wardCost.trim();
  for (const ability of abilityList(permanent)) {
    const trimmed = String(ability || '').trim();
    const manaOnly = /^ward\s*((?:\{[^}]+\})+)$/i.exec(trimmed);
    if (manaOnly) return String(manaOnly[1] || '').toUpperCase();
    const extracted = extractWardCostText(trimmed.startsWith('{') || /^pay\s+/i.test(trimmed) ? `Ward—${trimmed}` : trimmed);
    if (extracted) return extracted;
  }
  if (state) return findBattlefieldGrantedWardCost(state, permanent);
  return null;
}
