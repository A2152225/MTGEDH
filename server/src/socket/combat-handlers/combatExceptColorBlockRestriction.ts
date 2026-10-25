import { activeLevelUpTextForPermanent } from '../../state/modules/levelUpActiveText.js';
// server/src/socket/combat-handlers/combatExceptColorBlockRestriction.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker), Batch 11.
// - "~ can't be blocked except by <color> creatures" (self oracle / granted text)
// - "Enchanted/Equipped creature can't be blocked by <color> creatures" and the
//   "except by <color> creatures" form, read from Auras/Equipment attached to the attacker.
// Public entry symbols: getExceptColorBlockRestrictionReason, parseAttachedColorBlockClauses.

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const COLOR_LIST = '((?:(?:white|blue|black|red|green)(?:,? (?:and\\/or |or )?)?)+)';

const SELF_EXCEPT_RE = new RegExp(`(?:^|[\\n.]\\s*)(?:this creature|it|~)?\\s*can(?:'t|not) be blocked except by ${COLOR_LIST} creatures\\b`, 'gi');
const ATTACHED_RE = new RegExp(`(?:enchanted|equipped) creature can(?:'t|not) be blocked (except )?by ${COLOR_LIST} creatures\\b`, 'gi');

function norm(raw: unknown): string {
  return String(raw || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
}

function letters(list: string): string[] {
  return [...list.matchAll(/white|blue|black|red|green/g)].map((m) => COLOR_LETTER[m[0]]);
}

export interface ColorBlockClause { except: boolean; colors: string[] }

export function parseSelfExceptColorClauses(texts: readonly string[]): ColorBlockClause[] {
  const out: ColorBlockClause[] = [];
  for (const raw of texts) {
    for (const m of norm(raw).matchAll(SELF_EXCEPT_RE)) out.push({ except: true, colors: letters(m[1]) });
  }
  return out;
}

export function parseAttachedColorBlockClauses(texts: readonly string[]): ColorBlockClause[] {
  const out: ColorBlockClause[] = [];
  for (const raw of texts) {
    for (const m of norm(raw).matchAll(ATTACHED_RE)) out.push({ except: Boolean(m[1]), colors: letters(m[2]) });
  }
  return out;
}

function withSelfName(text: string, name: string): string {
  let out = text;
  for (const n of [name, name.split(',')[0]]) {
    const trimmed = n.trim();
    if (trimmed) out = out.split(trimmed).join('~');
  }
  return out;
}

function blockerColorLetters(blocker: any): string[] {
  const raw = Array.isArray(blocker?.colors) ? blocker.colors
    : Array.isArray(blocker?.card?.colors) ? blocker.card.colors : [];
  return raw.map((entry: unknown) => String(entry || '').trim().toUpperCase().slice(0, 1));
}

function attachedTexts(attacker: any, battlefield: readonly any[]): string[] {
  const id = String(attacker?.id || '');
  if (!id) return [];
  const ids = new Set<string>((Array.isArray(attacker?.attachments) ? attacker.attachments : []).map(String));
  return (battlefield || [])
    .filter((p: any) => p && (String(p.attachedTo || '') === id || ids.has(String(p.id || ''))))
    .map((p: any) => String(p?.card?.oracle_text || p?.oracle_text || ''));
}

export function getExceptColorBlockRestrictionReason(
  attacker: any,
  blocker: any,
  attackerTexts: readonly string[],
  battlefield: readonly any[] = [],
): string | null {
  const clauses = [
    ...parseSelfExceptColorClauses([
      // Level-up cards gate this clause by level: only the band matching the level counters applies.
      ...[String(attacker?.card?.oracle_text || ''), String(attacker?.oracle_text || '')]
        .map((t) => activeLevelUpTextForPermanent(attacker, t))
        .map((t) => withSelfName(t, String(attacker?.card?.name || attacker?.name || ''))),
      ...attackerTexts,
    ]),
    ...parseAttachedColorBlockClauses(attachedTexts(attacker, battlefield)),
  ];
  if (clauses.length === 0) return null;
  const blockerColors = blockerColorLetters(blocker);
  for (const clause of clauses) {
    const shares = clause.colors.some((c) => blockerColors.includes(c));
    if (clause.except && !shares) return `Attacker can't be blocked except by ${clause.colors.join('/')} creatures`;
    if (!clause.except && shares) return `Attacker can't be blocked by ${clause.colors.join('/')} creatures`;
  }
  return null;
}