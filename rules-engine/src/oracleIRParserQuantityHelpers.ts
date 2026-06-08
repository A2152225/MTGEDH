import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
} from './oracleIR';
import { normalizeOracleText, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { tryParseExileTopOnly } from './oracleIRParserExileTopOnly';

export type SplitQuantityAndWhereX = {
  readonly quantityPart: string;
  readonly whereX?: OracleClauseCondition;
};

/** Splits "x cards, where X is …" / "that many cards, where X is …" into quantity text and optional where clause. */
export function splitQuantityTailAndWhereX(quantityTail: string): SplitQuantityAndWhereX {
  const normalized = normalizeOracleText(String(quantityTail || ''));
  if (!normalized) return { quantityPart: '' };

  const lifeWhere = normalized.match(/^(.+?)\s+life,\s*where\s+x\s+is\s+(.+)$/i);
  if (lifeWhere) {
    const quantityPart = String(lifeWhere[1] || '').trim();
    const whereRaw = String(lifeWhere[2] || '').trim().replace(/[.;:,]+$/g, '').trim();
    if (!quantityPart || !whereRaw) return { quantityPart: normalized };
    return {
      quantityPart,
      whereX: { kind: 'where', raw: whereRaw },
    };
  }

  const match = normalized.match(/^(.+?),\s*where\s+x\s+is\s+(.+)$/i);
  if (match) {
    const quantityPart = String(match[1] || '').trim();
    const whereRaw = String(match[2] || '').trim().replace(/[.;:,]+$/g, '').trim();
    if (!quantityPart || !whereRaw) return { quantityPart: normalized };
    return {
      quantityPart,
      whereX: { kind: 'where', raw: whereRaw },
    };
  }

  return { quantityPart: normalized };
}

export function parseQuantityWithOptionalWhereX(quantityTail: string): {
  readonly amount: OracleQuantity;
  readonly whereX?: OracleClauseCondition;
} {
  const { quantityPart, whereX } = splitQuantityTailAndWhereX(quantityTail);
  const normalizedPart = normalizeOracleText(quantityPart);
  const lifeOnly = normalizedPart.match(/^(.+?)\s+life$/i);
  const amount = parseQuantity(lifeOnly ? String(lifeOnly[1] || '').trim() : quantityPart);
  return {
    amount,
    ...(whereX ? { whereX } : {}),
  };
}

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

export type QuantityEffectStepKind =
  | 'mill'
  | 'draw'
  | 'scry'
  | 'surveil'
  | 'discard'
  | 'gain_life'
  | 'lose_life';

export function buildDamageStepFromClauseParts(args: {
  readonly source?: OracleObjectSelector;
  readonly target: OracleObjectSelector;
  readonly quantityTail: string;
  readonly rawClause: string;
  readonly withMeta: WithMeta;
  readonly division?: 'as_you_choose' | 'evenly_rounded_down';
  readonly optional?: boolean;
  readonly sequence?: 'then';
}): OracleEffectStep {
  const { amount, whereX } = parseQuantityWithOptionalWhereX(args.quantityTail);
  const step: OracleEffectStep = {
    kind: 'deal_damage',
    amount,
    target: args.target,
    ...(args.source ? { source: args.source } : {}),
    ...(whereX ? { whereX } : {}),
    ...(args.division ? { division: args.division } : {}),
    ...(args.optional ? { optional: true } : {}),
    ...(args.sequence ? { sequence: args.sequence } : {}),
    raw: args.rawClause,
  } as OracleEffectStep;
  return args.withMeta(step);
}

export function buildQuantityStepFromClauseParts(args: {
  readonly kind: QuantityEffectStepKind;
  readonly who: OraclePlayerSelector;
  readonly quantityTail: string;
  readonly rawClause: string;
  readonly withMeta: WithMeta;
  readonly optional?: boolean;
  readonly sequence?: 'then';
}): OracleEffectStep {
  const { amount, whereX } = parseQuantityWithOptionalWhereX(args.quantityTail);
  const step: OracleEffectStep = {
    kind: args.kind,
    who: args.who,
    amount,
    ...(whereX ? { whereX } : {}),
    ...(args.optional ? { optional: true } : {}),
    ...(args.sequence ? { sequence: args.sequence } : {}),
    raw: args.rawClause,
  } as OracleEffectStep;
  return args.withMeta(step);
}

export function buildMillStepFromClauseParts(args: {
  readonly who: OraclePlayerSelector;
  readonly quantityTail: string;
  readonly rawClause: string;
  readonly withMeta: WithMeta;
  readonly optional?: boolean;
  readonly sequence?: 'then';
}): OracleEffectStep {
  return buildQuantityStepFromClauseParts({ ...args, kind: 'mill' });
}

/** True when a quantity tail can be parsed via buildQuantityStepFromClauseParts (incl. ", where X is …"). */
export function quantityTailSupportsDynamicQuantity(quantityTail: string): boolean {
  const normalized = normalizeOracleText(quantityTail);
  if (!normalized) return false;
  if (/,\s*where\s+x\s+is\s+/i.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^x(?:,|\b|$)/i.test(normalized)) return true;
  if (/^(?:that many|that much)\b/i.test(normalized)) return true;
  if (/^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(normalized)) return true;
  return isSimpleCardQuantityTail(normalized);
}

/** True when the tail is a simple "N cards" quantity (not "for each", "equal to", etc.). */
export function isSimpleCardQuantityTail(quantityTail: string): boolean {
  const normalized = normalizeOracleText(quantityTail);
  if (!normalized || !/\bcards?\b/i.test(normalized)) return false;
  if (/\bfor\s+each\b/i.test(normalized)) return false;
  if (/\bcards?\s+equal\s+to\b/i.test(normalized)) return false;
  if (/\bmore\s+cards?\b/i.test(normalized)) return false;
  if (/\sand\s+loses?\s+/i.test(normalized)) return false;
  if (/\sand\s+gains?\s+/i.test(normalized)) return false;
  if (/\sand\s+convert\b/i.test(normalized)) return false;
  if (/\sand\s+reveal\b/i.test(normalized)) return false;
  if (/\sand\s+sacrifices?\b/i.test(normalized)) return false;
  if (/\sif\s+/i.test(normalized)) return false;
  if (/\sinstead$/i.test(normalized)) return false;
  if (/^until you exile/i.test(normalized)) return false;
  if (/,/.test(normalized)) return false;
  return true;
}

function parseTopLibraryInfoOwner(ownerRaw: string): OraclePlayerSelector | null {
  const normalized = normalizeOracleText(ownerRaw).replace(/[.]+$/g, '').trim();
  if (normalized === 'your') return { kind: 'you' };
  if (normalized === "target player's" || normalized === "that player's") return { kind: 'target_player' };
  if (normalized === "target opponent's" || normalized === "that opponent's") return { kind: 'target_opponent' };
  return null;
}

export function tryParseLookTopClause(args: {
  readonly clause: string;
  readonly rawClause: string;
  readonly withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const working = normalizeOracleText(args.clause)
    .replace(/^(?:\{[^}]+\}(?:,\s*)?)+\s*:\s*/i, '')
    .replace(/^when(?:ever)?\s+.+?,\s*/i, '')
    .replace(/^at\s+the\s+beginning\s+of\s+.+?,\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!working) return null;

  const thatManyFromTop = working.match(
    /^(?:you may\s+)?(look at|reveal)\s+that many cards from the top of (your|target player's|target opponent's|that player's|that opponent's)\s+library$/i
  );
  if (thatManyFromTop) {
    const who = parseTopLibraryInfoOwner(String(thatManyFromTop[2] || '').trim());
    if (!who) return null;
    return args.withMeta({
      kind: /^reveal/i.test(String(thatManyFromTop[1] || '').trim()) ? 'reveal_top' : 'look_top',
      who,
      amount: { kind: 'reference_amount', raw: 'that many' },
      raw: args.rawClause,
    } as OracleEffectStep);
  }

  const match = working.match(
    /^(?:you may\s+)?(look at|reveal)\s+the\s+top\s+(.+?)\s+of\s+(your|target player's|target opponent's|that player's|that opponent's)\s+library(?:\s+any time)?(?:,\s*where\s+x\s+is\s+(.+))?$/i
  );
  if (!match) return null;

  const who = parseTopLibraryInfoOwner(String(match[3] || '').trim());
  if (!who) return null;

  const whereRaw = String(match[4] || '').trim();
  const quantityTail = whereRaw
    ? `${String(match[2] || '').trim()}, where x is ${whereRaw}`
    : String(match[2] || '').trim();
  const singularCard = /^card$/i.test(quantityTail);
  const { amount, whereX } = singularCard
    ? { amount: { kind: 'number' as const, value: 1 }, whereX: undefined }
    : parseQuantityWithOptionalWhereX(quantityTail);

  return args.withMeta({
    kind: /^reveal/i.test(String(match[1] || '').trim()) ? 'reveal_top' : 'look_top',
    who,
    amount,
    ...(whereX ? { whereX } : {}),
    raw: args.rawClause,
  } as OracleEffectStep);
}

export function tryParseExileTopClause(args: {
  readonly clause: string;
  readonly rawClause: string;
  readonly withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const working = normalizeOracleText(args.clause)
    .replace(/^(?:\{[^}]+\}(?:,\s*)?)+\s*:\s*/i, '')
    .replace(/^when(?:ever)?\s+.+?,\s*/i, '')
    .replace(/^at\s+the\s+beginning\s+of\s+.+?,\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!working) return null;

  const parsed = tryParseExileTopOnly({ clauses: [working], idx: 0 });
  if (!parsed?.step || parsed.step.kind !== 'exile_top') return null;
  return args.withMeta(parsed.step);
}

/** Parses "enchanted player mills …" and other player-prefixed mill clauses. */
export function tryParsePlayerMillClause(args: {
  readonly clause: string;
  readonly rawClause: string;
  readonly withMeta: WithMeta;
}): OracleEffectStep | null {
  const working = normalizeOracleText(args.clause)
    .replace(/^[\u2022]\s+/, '')
    .trim();

  const enchantedPlayerMill = working.match(
    /^enchanted\s+player\s+mills?\s+(.+)$/i
  );
  if (enchantedPlayerMill) {
    return buildMillStepFromClauseParts({
      who: parsePlayerSelector('enchanted player'),
      quantityTail: String(enchantedPlayerMill[1] || '').trim(),
      rawClause: args.rawClause,
      withMeta: args.withMeta,
    });
  }

  return null;
}
