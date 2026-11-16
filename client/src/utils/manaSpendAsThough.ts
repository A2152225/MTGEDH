// client/src/utils/manaSpendAsThough.ts
// Client mirror of Celestial Dawn / Mycosynth Lattice spend-as-though rules
// for PaymentPicker validation and auto-pay.

export type ClientManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export const CLIENT_MANA_COLORS: ClientManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export type ClientManaSpendRules = {
  anyColor: boolean;
  colorAsAny: ClientManaColor | null;
  otherOnlyColorless: boolean;
};

export const DEFAULT_CLIENT_MANA_SPEND_RULES: ClientManaSpendRules = {
  anyColor: false,
  colorAsAny: null,
  otherOnlyColorless: false,
};

const WORD_TO_COLOR: Record<string, ClientManaColor> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
  W: 'W', U: 'U', B: 'B', R: 'R', G: 'G', C: 'C',
};

function normalizeOracle(oracle: string): string {
  return String(oracle || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function parsePlayersSpendManaAsAnyColor(oracle: string): boolean {
  return /players may spend mana as though it were mana of any color/i.test(normalizeOracle(oracle));
}

function parseSpendColorManaAsAny(oracle: string): ClientManaColor | null {
  const m = normalizeOracle(oracle).match(/you may spend (white|blue|black|red|green) mana as though it were mana of any color/i);
  return m ? WORD_TO_COLOR[m[1].toLowerCase()] : null;
}

function parseSpendOtherManaOnlyColorless(oracle: string): boolean {
  return /you may spend other mana only as though it were colorless mana/i.test(normalizeOracle(oracle));
}

export function getClientManaSpendAsThoughRules(
  permanents: readonly any[] | undefined,
  payerId?: string,
): ClientManaSpendRules {
  const rules: ClientManaSpendRules = { ...DEFAULT_CLIENT_MANA_SPEND_RULES };
  const pid = String(payerId || '');
  for (const permanent of Array.isArray(permanents) ? permanents : []) {
    if (!permanent || (permanent as any).phasedOut === true) continue;
    const oracle = String(permanent.card?.oracle_text || (permanent as any).oracle_text || '');
    if (!oracle) continue;
    if (parsePlayersSpendManaAsAnyColor(oracle)) rules.anyColor = true;
    const controller = String(permanent.controller || (permanent as any).controllerId || '');
    if (pid && controller && controller !== pid) continue;
    const colorAsAny = parseSpendColorManaAsAny(oracle);
    if (colorAsAny) rules.colorAsAny = colorAsAny;
    if (parseSpendOtherManaOnlyColorless(oracle)) rules.otherOnlyColorless = true;
  }
  if (rules.anyColor) {
    rules.colorAsAny = null;
    rules.otherOnlyColorless = false;
  }
  return rules;
}

export function canSpendClientManaAs(
  from: ClientManaColor,
  need: ClientManaColor | 'generic',
  rules: ClientManaSpendRules = DEFAULT_CLIENT_MANA_SPEND_RULES,
): boolean {
  if (need === 'generic') return true;
  if (rules.anyColor) return need !== 'C' || from === 'C';
  if (rules.colorAsAny && from === rules.colorAsAny) return need !== 'C';
  if (rules.otherOnlyColorless) return need === 'C';
  if (need === 'C') return from === 'C';
  return from === need;
}

function take(
  pool: Record<ClientManaColor, number>,
  need: ClientManaColor | 'generic',
  rules: ClientManaSpendRules,
  prefer: ClientManaColor[],
): boolean {
  for (const from of prefer) {
    if ((pool[from] || 0) <= 0) continue;
    if (!canSpendClientManaAs(from, need, rules)) continue;
    pool[from] -= 1;
    return true;
  }
  return false;
}

export function canPayCostWithSpendAsThough(
  cost: { colors: Record<ClientManaColor, number>; generic: number; hybrids: ClientManaColor[][] },
  pool: Record<ClientManaColor, number>,
  rules: ClientManaSpendRules = DEFAULT_CLIENT_MANA_SPEND_RULES,
): boolean {
  const left: Record<ClientManaColor, number> = {
    W: Number(pool.W || 0), U: Number(pool.U || 0), B: Number(pool.B || 0),
    R: Number(pool.R || 0), G: Number(pool.G || 0), C: Number(pool.C || 0),
  };
  for (const c of CLIENT_MANA_COLORS) {
    const amount = Math.max(0, Math.floor(Number(cost.colors?.[c] || 0)));
    for (let i = 0; i < amount; i++) {
      if (!take(left, c, rules, [c, ...CLIENT_MANA_COLORS.filter((key) => key !== c)])) return false;
    }
  }
  for (const group of cost.hybrids || []) {
    let paid = false;
    for (const need of group) {
      if (take(left, need, rules, [need, ...CLIENT_MANA_COLORS.filter((key) => key !== need)])) {
        paid = true;
        break;
      }
    }
    if (!paid) return false;
  }
  const generic = Math.max(0, Math.floor(Number(cost.generic || 0)));
  for (let i = 0; i < generic; i++) {
    if (!take(left, 'generic', rules, ['C', 'W', 'U', 'B', 'R', 'G'])) return false;
  }
  return true;
}

export function applySpendAsThoughToSources<T extends { options: ClientManaColor[] }>(
  sources: T[],
  rules: ClientManaSpendRules,
): T[] {
  if (!rules.anyColor && !rules.colorAsAny && !rules.otherOnlyColorless) return sources;
  const colored: ClientManaColor[] = ['W', 'U', 'B', 'R', 'G'];
  return sources.map((source) => {
    const next = new Set<ClientManaColor>();
    for (const from of source.options || []) {
      if (rules.anyColor) {
        for (const color of colored) next.add(color);
        if (from === 'C') next.add('C');
        continue;
      }
      if (rules.colorAsAny && from === rules.colorAsAny) {
        for (const color of colored) next.add(color);
        continue;
      }
      if (rules.otherOnlyColorless) {
        next.add('C');
        continue;
      }
      next.add(from);
    }
    return { ...source, options: [...next] };
  });
}


export function remainingCostAfterSpendAsThough(
  cost: { colors: Record<ClientManaColor, number>; generic: number; hybrids: ClientManaColor[][] },
  pool: Record<ClientManaColor, number>,
  rules: ClientManaSpendRules = DEFAULT_CLIENT_MANA_SPEND_RULES,
): { colors: Record<ClientManaColor, number>; generic: number; hybrids: ClientManaColor[][] } {
  const left: Record<ClientManaColor, number> = {
    W: Number(pool.W || 0), U: Number(pool.U || 0), B: Number(pool.B || 0),
    R: Number(pool.R || 0), G: Number(pool.G || 0), C: Number(pool.C || 0),
  };
  const colors: Record<ClientManaColor, number> = { ...cost.colors };
  for (const color of CLIENT_MANA_COLORS) {
    let amount = Math.max(0, Math.floor(Number(colors[color] || 0)));
    while (amount > 0 && take(left, color, rules, [color, ...CLIENT_MANA_COLORS.filter((key) => key !== color)])) {
      amount -= 1;
    }
    colors[color] = amount;
  }
  const hybrids: ClientManaColor[][] = [];
  for (const group of cost.hybrids || []) {
    let paid = false;
    for (const need of group) {
      if (take(left, need, rules, [need, ...CLIENT_MANA_COLORS.filter((key) => key !== need)])) {
        paid = true;
        break;
      }
    }
    if (!paid) hybrids.push(group);
  }
  let generic = Math.max(0, Math.floor(Number(cost.generic || 0)));
  while (generic > 0 && take(left, 'generic', rules, ['C', 'W', 'U', 'B', 'R', 'G'])) generic -= 1;
  return { colors, generic, hybrids };
}

export function canonicalizePaymentItemsToProducedColors<T extends { mana?: string; paymentSourceId?: string; permanentId?: string }>(
  items: T[],
  sources: Array<{ id: string; options?: readonly string[] }>,
  rules: ClientManaSpendRules = DEFAULT_CLIENT_MANA_SPEND_RULES,
): T[] {
  const byId = new Map(sources.map((source) => [String(source.id), source]));
  return items.map((item) => {
    const source = byId.get(String(item.paymentSourceId || item.permanentId || ''));
    if (!source) return item;
    const assigned = String(item.mana || '') as ClientManaColor;
    const produced = (source.options || []).filter((option): option is ClientManaColor =>
      (CLIENT_MANA_COLORS as string[]).includes(String(option)),
    );
    if (produced.includes(assigned)) return item;
    const actual = produced.find((from) => canSpendClientManaAs(from, assigned, rules));
    return actual ? { ...item, mana: actual } : item;
  });
}
