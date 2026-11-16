/**
 * On-cast optional prompts for printed or granted casualty / demonstrate / conspire.
 * Pure helpers live here so tests do not need the socket layer.
 * Public: readCasualtyValue, hasDemonstrate, hasConspire, isCasualtyLegalSacrifice,
 * creaturesSharingColorWithSpell, buildCasualtyPaymentStep, buildConspirePaymentStep,
 * buildDemonstrateChoiceStep, stampOnCastKeywordFlags, shouldCopyForOnCastKeyword.
 */
const CASUALTY_RE = /\bcasualty\s+(\d+)\b/i;
const CASUALTY_X_RE = /\bcasualty\s+x\b/i;
const DEMONSTRATE_RE = /\bdemonstrate\b/i;
const CONSPIRE_RE = /\bconspire\b/i;

export type OnCastKeywordFlags = {
  casualtyResolved?: boolean;
  casualtyPaid?: boolean;
  casualtyValue?: number;
  casualtyX?: boolean;
  casualtyCopyIsntLegendary?: boolean;
  casualtyStartingLoyalty?: number;
  conspireResolved?: boolean;
  conspirePaid?: boolean;
  demonstrateResolved?: boolean;
  demonstratePaid?: boolean;
  demonstrateOpponentId?: string;
};

function oracleOf(card: any, oracleText?: string): string {
  return String(oracleText || card?.oracle_text || card?.oracleText || card?.card?.oracle_text || '');
}

function grantedNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function readCasualtyValue(card: any, oracleText?: string): number | null {
  const printed = String(oracleOf(card, oracleText)).match(CASUALTY_RE);
  const printedN = printed ? Number(printed[1]) : null;
  const granted = grantedNumber(card?.grantedCasualty ?? card?.card?.grantedCasualty);
  if (printedN && Number.isFinite(printedN) && printedN > 0) {
    return granted != null ? Math.max(printedN, granted) : printedN;
  }
  return granted;
}

export function hasCasualtyX(card: any, oracleText?: string): boolean {
  const granted = card?.grantedCasualtyX === true || card?.card?.grantedCasualtyX === true;
  if (granted) return true;
  return CASUALTY_X_RE.test(oracleOf(card, oracleText));
}

export function hasDemonstrate(card: any, oracleText?: string): boolean {
  if (card?.grantedDemonstrate === true || card?.card?.grantedDemonstrate === true) return true;
  return DEMONSTRATE_RE.test(oracleOf(card, oracleText));
}

export function hasConspire(card: any, oracleText?: string): boolean {
  if (card?.grantedConspire === true || card?.card?.grantedConspire === true) return true;
  return CONSPIRE_RE.test(oracleOf(card, oracleText));
}

export function effectivePower(permanent: any, state?: any): number {
  if (typeof state === 'object' && state && typeof (permanent as any)?.power === 'number') {
    // Prefer the caller-supplied getEffectivePower when attached later; keep a local fallback.
  }
  const marked = Number(permanent?.power ?? permanent?.card?.power ?? 0);
  if (Number.isFinite(marked)) return marked;
  const fromCard = Number(String(permanent?.card?.power || '0').split('/')[0]);
  return Number.isFinite(fromCard) ? fromCard : 0;
}

export function isCasualtyLegalSacrifice(permanent: any, playerId: string, minPower: number, powerOf?: (perm: any) => number): boolean {
  if (!permanent || String(permanent.controller || permanent.controllerId || '') !== String(playerId)) return false;
  const typeLine = String(permanent.card?.type_line || permanent.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  const power = powerOf ? powerOf(permanent) : effectivePower(permanent);
  return power >= minPower;
}

export function colorsOfSpell(card: any): string[] {
  const colors = new Set<string>();
  const listed = card?.colors || card?.card?.colors || card?.color_identity || card?.card?.color_identity;
  if (Array.isArray(listed)) {
    for (const c of listed) {
      const ch = String(c || '').toUpperCase();
      if (/^[WUBRG]$/.test(ch)) colors.add(ch);
    }
  }
  const cost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || '');
  for (const ch of cost.toUpperCase()) {
    if ('WUBRG'.includes(ch)) colors.add(ch);
  }
  return [...colors];
}

export function colorsOfPermanent(permanent: any): string[] {
  return colorsOfSpell(permanent?.card || permanent);
}

export function creaturesSharingColorWithSpell(battlefield: any[], playerId: string, spellCard: any): any[] {
  const spellColors = colorsOfSpell(spellCard);
  if (spellColors.length === 0) return [];
  return (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
    if (!perm || String(perm.controller || perm.controllerId || '') !== String(playerId)) return false;
    if (perm.tapped === true) return false;
    const typeLine = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
    const colors = colorsOfPermanent(perm);
    return colors.some((c) => spellColors.includes(c));
  });
}

export function buildCasualtyPaymentStep(args: {
  playerId: string;
  cardId: string;
  cardName: string;
  sourceId?: string;
  sourceImage?: string;
  casualtyValue: number;
  availableTargets: Array<Record<string, unknown>>;
  castSpellFromHandArgs?: Record<string, unknown>;
  casualtyX?: boolean;
}): Record<string, unknown> {
  const casualtyX = args.casualtyX === true;
  const n = casualtyX ? 1 : Math.max(1, Math.floor(Number(args.casualtyValue || 1)));
  const name = String(args.cardName || 'Spell');
  const label = casualtyX ? 'Casualty X' : `Casualty ${n}`;
  return {
    type: 'additional_cost_payment',
    playerId: args.playerId,
    sourceId: args.sourceId || args.cardId,
    sourceName: name,
    sourceImage: args.sourceImage,
    description: casualtyX
      ? `Casualty X (optional): You may sacrifice a creature with power X or greater as you cast ${name}. When you do, copy this spell. The copy isn\'t legendary and has starting loyalty X. Submit with 0 selections to decline.`
      : `Casualty ${n} (optional): You may sacrifice a creature with power ${n} or greater as you cast ${name}. When you do, copy this spell. Submit with 0 selections to decline.`,
    mandatory: false,
    cardId: args.cardId,
    cardName: name,
    costType: 'sacrifice',
    amount: 1,
    additionalCostKeyword: 'casualty',
    casualtyValue: n,
    casualtyX,
    title: `${label} (optional) — ${name}`,
    imageUrl: args.sourceImage,
    availableTargets: args.availableTargets,
    ...(args.castSpellFromHandArgs ? { castSpellFromHandArgs: args.castSpellFromHandArgs } : {}),
  };
}

export function buildConspirePaymentStep(args: {
  playerId: string;
  cardId: string;
  cardName: string;
  sourceId?: string;
  sourceImage?: string;
  availableTargets: Array<Record<string, unknown>>;
  castSpellFromHandArgs?: Record<string, unknown>;
}): Record<string, unknown> {
  const name = String(args.cardName || 'Spell');
  return {
    type: 'additional_cost_payment',
    playerId: args.playerId,
    sourceId: args.sourceId || args.cardId,
    sourceName: name,
    sourceImage: args.sourceImage,
    description: `Conspire (optional): You may tap two untapped creatures you control that share a color with ${name}. When you do, copy it. Submit with 0 selections to decline.`,
    mandatory: false,
    cardId: args.cardId,
    cardName: name,
    costType: 'conspire',
    amount: 2,
    additionalCostKeyword: 'conspire',
    minTargets: 0,
    maxTargets: 2,
    title: `Conspire (optional) — ${name}`,
    imageUrl: args.sourceImage,
    availableTargets: args.availableTargets,
    ...(args.castSpellFromHandArgs ? { castSpellFromHandArgs: args.castSpellFromHandArgs } : {}),
  };
}

export function buildDemonstrateChoiceStep(args: {
  playerId: string;
  cardId: string;
  cardName: string;
  sourceId?: string;
  sourceImage?: string;
  opponents: Array<{ id: string; name: string }>;
}): Record<string, unknown> {
  const name = String(args.cardName || 'Spell');
  const opponentOptions = (args.opponents || []).map((opp) => ({
    id: `opponent:${opp.id}`,
    label: `Copy ${name} and give ${opp.name} a copy`,
    description: 'You get a copy, and this opponent also gets a copy.',
  }));
  return {
    type: 'option_choice',
    playerId: args.playerId,
    sourceId: args.sourceId || args.cardId,
    sourceName: name,
    sourceImage: args.sourceImage,
    description: `Demonstrate (optional): You may copy ${name}. If you do, choose an opponent to also copy it.`,
    mandatory: false,
    additionalCostKeyword: 'demonstrate',
    demonstratePrompt: true,
    title: `Demonstrate (optional) — ${name}`,
    imageUrl: args.sourceImage,
    options: [
      ...opponentOptions,
      { id: 'decline', label: 'Decline', description: `Do not copy ${name}.` },
    ],
    minSelections: 1,
    maxSelections: 1,
  };
}

export function stampOnCastKeywordFlags(target: any, flags: OnCastKeywordFlags): void {
  if (!target || typeof target !== 'object') return;
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) (target as any)[key] = value;
  }
  if (target.card && typeof target.card === 'object') {
    for (const [key, value] of Object.entries(flags)) {
      if (value !== undefined) target.card[key] = value;
    }
  }
}

export function shouldCopyForOnCastKeyword(cardOrItem: any): { casualty: boolean; conspire: boolean; demonstrate: boolean; opponentId?: string } {
  const src = cardOrItem || {};
  const card = src.card || src;
  return {
    casualty: src.casualtyPaid === true || card.casualtyPaid === true,
    conspire: src.conspirePaid === true || card.conspirePaid === true,
    demonstrate: src.demonstratePaid === true || card.demonstratePaid === true,
    opponentId: String(src.demonstrateOpponentId || card.demonstrateOpponentId || '').trim() || undefined,
  };
}

export function parseDemonstrateOpponentChoice(choiceId: string | undefined): string | null {
  const raw = String(choiceId || '').trim();
  if (!raw || raw.toLowerCase() === 'decline' || raw.toLowerCase() === 'no') return null;
  if (raw.toLowerCase().startsWith('opponent:')) return raw.slice('opponent:'.length).trim() || null;
  return raw;
}

export function resolveCasualtyPaymentFlags(args: {
  step?: any;
  spellCard?: any;
  selectedIds?: string[];
  battlefield?: any[];
  powerOf?: (perm: any) => number;
}): OnCastKeywordFlags {
  const step = args.step || {};
  const card = args.spellCard || {};
  const casualtyX = step.casualtyX === true || hasCasualtyX(card);
  const ids = Array.isArray(args.selectedIds) ? args.selectedIds : [];
  const battlefield = Array.isArray(args.battlefield) ? args.battlefield : [];
  let sacrificedPower = 0;
  if (ids.length) {
    const perm = battlefield.find((entry: any) => String(entry?.id || '') === String(ids[0]));
    if (perm) sacrificedPower = args.powerOf ? args.powerOf(perm) : effectivePower(perm);
  }
  let value = Number(step.casualtyValue || card.casualtyValue || 0);
  if (casualtyX) value = Math.max(1, sacrificedPower);
  else if (!Number.isFinite(value) || value <= 0) value = Math.max(1, sacrificedPower || 1);
  const flags: OnCastKeywordFlags = {
    casualtyResolved: true,
    casualtyPaid: true,
    casualtyValue: Math.floor(value),
  };
  if (casualtyX) {
    flags.casualtyX = true;
    flags.casualtyCopyIsntLegendary = true;
    flags.casualtyStartingLoyalty = Math.floor(value);
  }
  return flags;
}

function stripLegendaryFromObject(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  const typeLine = String(obj.type_line || obj.typeLine || '');
  if (typeLine) {
    const next = typeLine.replace(/\bLegendary\s+/gi, '').replace(/\s+/g, ' ').trim();
    if (obj.type_line != null) obj.type_line = next;
    if (obj.typeLine != null) obj.typeLine = next;
  }
  if (Array.isArray(obj.supertypes)) {
    obj.supertypes = obj.supertypes.filter((entry: any) => String(entry).toLowerCase() !== 'legendary');
  }
  if (Array.isArray(obj.superTypes)) {
    obj.superTypes = obj.superTypes.filter((entry: any) => String(entry).toLowerCase() !== 'legendary');
  }
  obj.isLegendary = false;
}

export function applyCasualtyXCopyModifiers(copy: any, source: any): void {
  if (!copy) return;
  const src = source || {};
  const card = src.card || src;
  const apply = src.casualtyCopyIsntLegendary === true
    || card.casualtyCopyIsntLegendary === true
    || src.casualtyX === true
    || card.casualtyX === true
    || hasCasualtyX(card);
  if (!apply) return;
  const srcCard = src.card || src;
  if (copy.card && (copy.card === srcCard || copy.card === src || copy.card === source)) {
    copy.card = { ...copy.card };
  }
  const loyaltyRaw = Number(
    src.casualtyStartingLoyalty ?? card.casualtyStartingLoyalty ?? src.casualtyValue ?? card.casualtyValue
  );
  stripLegendaryFromObject(copy);
  if (copy.card && copy.card !== copy) stripLegendaryFromObject(copy.card);
  if (Number.isFinite(loyaltyRaw) && loyaltyRaw > 0) {
    const loyalty = Math.floor(loyaltyRaw);
    const targets = [copy, copy.card].filter(Boolean);
    for (const target of targets) {
      target.loyalty = loyalty;
      target.startingLoyalty = loyalty;
    }
  }
}
