/**
 * Variable power/toughness for created tokens ("create an X/X blue Shark creature
 * token with flying, where X is that spell's mana value").
 *
 * The token descriptor parser only understands numeric P/T, so X/X tokens were created
 * without power/toughness at all (and then never died to state-based actions). This leaf
 * resolves X through the caller-supplied resolver (the same "where X is ..." / announced-X
 * evaluation used for token amounts) and stamps the numeric P/T onto the characteristics.
 */

export interface VariableTokenPt {
  readonly powerIsX: boolean;
  readonly toughnessIsX: boolean;
  readonly fixedPower?: number;
  readonly fixedToughness?: number;
}

const VARIABLE_PT_RE = /(?:^|[\s,])(x|\d+)\/(x|\d+)(?=$|[\s,])/i;

/** Reads an X/X, X/1, 1/X style P/T from the token hint (or clause). Null when not variable. */
export function readVariableTokenPt(tokenHint: string, clauseRaw?: string): VariableTokenPt | null {
  for (const source of [tokenHint, clauseRaw]) {
    const text = String(source || '').trim();
    if (!text) continue;
    const match = text.match(VARIABLE_PT_RE);
    if (!match) continue;
    const powerRaw = String(match[1] || '').toLowerCase();
    const toughnessRaw = String(match[2] || '').toLowerCase();
    const powerIsX = powerRaw === 'x';
    const toughnessIsX = toughnessRaw === 'x';
    if (!powerIsX && !toughnessIsX) return null;
    return {
      powerIsX,
      toughnessIsX,
      ...(powerIsX ? {} : { fixedPower: parseInt(powerRaw, 10) }),
      ...(toughnessIsX ? {} : { fixedToughness: parseInt(toughnessRaw, 10) }),
    };
  }
  return null;
}

/**
 * Returns characteristics with numeric P/T when the token is X/X-style and X resolves;
 * `null` when the token is variable but X cannot be determined (caller should skip rather
 * than create a creature with no toughness); the input unchanged when not variable.
 */
export function applyVariableTokenPowerToughness<T extends { power?: number; toughness?: number }>(
  characteristics: T,
  tokenHint: string,
  clauseRaw: string,
  resolveX: () => number | null,
): T | null {
  const variable = readVariableTokenPt(tokenHint, clauseRaw);
  if (!variable) return characteristics;
  const rawX = resolveX();
  if (rawX === null || !Number.isFinite(rawX)) return null;
  const x = Math.max(0, Math.floor(rawX));
  return {
    ...characteristics,
    power: variable.powerIsX ? x : (variable.fixedPower ?? characteristics.power),
    toughness: variable.toughnessIsX ? x : (variable.fixedToughness ?? characteristics.toughness),
  };
}