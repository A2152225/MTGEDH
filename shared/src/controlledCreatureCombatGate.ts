/**
 * Generic combat gates of the form:
 *   "~ can't attack or block unless you control three or more creatures."
 *   "This creature can't attack unless you control 2 or more creatures."
 *   "... can't block unless you control at least four other creatures."
 *
 * Shared by server + client so attack/block lists stay in sync.
 */

export interface ControlledCreatureCombatGate {
  /** Minimum creatures the controller must control for the action to be legal. */
  readonly minCreatures: number;
  readonly restrictsAttack: boolean;
  readonly restrictsBlock: boolean;
  /** When true, the gated permanent itself is excluded from the count ("other creatures"). */
  readonly otherOnly: boolean;
}

export interface ControlledCreatureCombatGateViolation {
  readonly illegal: boolean;
  readonly reason?: string;
  readonly gate?: ControlledCreatureCombatGate;
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
};

function normalizeGateText(text: string): string {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCountToken(raw: string): number | null {
  const token = String(raw || '').trim().toLowerCase();
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const n = Number.parseInt(token, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const fromWord = WORD_NUMBERS[token];
  return typeof fromWord === 'number' ? fromWord : null;
}

/**
 * Parse self-gates that require controlling N(+ ) creatures to attack and/or block.
 * Returns null when the oracle text has no such gate.
 */
export function parseControlledCreatureCombatGate(
  oracleText: string,
): ControlledCreatureCombatGate | null {
  const normalized = normalizeGateText(oracleText);
  if (!normalized) return null;

  // Match per sentence so multi-ability cards don't false-positive across clauses.
  const sentences = normalized.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  let best: ControlledCreatureCombatGate | null = null;

  for (const sentence of sentences) {
    // "~ can't attack or block unless you control three or more creatures"
    // "can't attack unless you control 2 or more creatures"
    // "can't block unless you control at least four other creatures"
    const match = sentence.match(
      /can(?:not|'t)\s+(attack(?:\s+or\s+block)?|block(?:\s+or\s+attack)?)\s+unless\s+you\s+control\s+(?:at\s+least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)(?:\s+or\s+more)?\s+(other\s+)?creatures?\b/i,
    );
    if (!match) continue;

    const actionPhrase = String(match[1] || '').toLowerCase();
    const minCreatures = parseCountToken(String(match[2] || ''));
    if (!minCreatures) continue;

    const otherOnly = Boolean(match[3]);
    const restrictsAttack = actionPhrase.includes('attack');
    const restrictsBlock = actionPhrase.includes('block');
    if (!restrictsAttack && !restrictsBlock) continue;

    const candidate: ControlledCreatureCombatGate = {
      minCreatures,
      restrictsAttack,
      restrictsBlock,
      otherOnly,
    };

    // Prefer the stricter (higher) threshold if multiple gates appear.
    if (!best || candidate.minCreatures > best.minCreatures) {
      best = candidate;
    } else if (best && candidate.minCreatures === best.minCreatures) {
      best = {
        minCreatures: best.minCreatures,
        restrictsAttack: best.restrictsAttack || candidate.restrictsAttack,
        restrictsBlock: best.restrictsBlock || candidate.restrictsBlock,
        otherOnly: best.otherOnly || candidate.otherOnly,
      };
    }
  }

  return best;
}

export function getControlledCreatureCombatGateViolation(args: {
  oracleText?: string | null;
  controlledCreatureCount: number;
  /** When otherOnly, pass count excluding the gated permanent. */
  action: 'attack' | 'block';
  permanentName?: string;
}): ControlledCreatureCombatGateViolation {
  const gate = parseControlledCreatureCombatGate(String(args.oracleText || ''));
  if (!gate) return { illegal: false };

  if (args.action === 'attack' && !gate.restrictsAttack) return { illegal: false, gate };
  if (args.action === 'block' && !gate.restrictsBlock) return { illegal: false, gate };

  const count = Math.max(0, Math.floor(Number(args.controlledCreatureCount) || 0));
  if (count >= gate.minCreatures) return { illegal: false, gate };

  const name = String(args.permanentName || 'This creature').trim() || 'This creature';
  const other = gate.otherOnly ? ' other' : '';
  const actionWord = args.action === 'attack' ? 'attack' : 'block';
  return {
    illegal: true,
    gate,
    reason: `${name} can't ${actionWord} unless you control ${gate.minCreatures} or more${other} creatures (you control ${count})`,
  };
}

/**
 * Count creatures controlled by a player for gate evaluation.
 * `isCreature` must match the game's live creature definition (crewed vehicles, etc.).
 */
export function countControlledCreaturesForCombatGate(args: {
  battlefield: ReadonlyArray<{ id?: string; controller?: string } | null | undefined>;
  controllerId: string;
  isCreature: (permanent: any) => boolean;
  /** When evaluating an "other creatures" gate, pass the gated permanent's id to exclude. */
  excludePermanentId?: string | null;
}): number {
  const controllerId = String(args.controllerId || '').trim();
  if (!controllerId || !Array.isArray(args.battlefield)) return 0;
  const excludeId = String(args.excludePermanentId || '').trim();

  let count = 0;
  for (const permanent of args.battlefield) {
    if (!permanent) continue;
    if (String(permanent.controller || '').trim() !== controllerId) continue;
    if (excludeId && String(permanent.id || '').trim() === excludeId) continue;
    if (!args.isCreature(permanent)) continue;
    count += 1;
  }
  return count;
}
