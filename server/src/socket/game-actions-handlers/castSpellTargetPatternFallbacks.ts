/**
 * socket/game-actions-handlers/castSpellTargetPatternFallbacks.ts
 *
 * Generic oracle-pattern fallbacks for cast-time target requirements that
 * parseTargetRequirements leaves empty or too loose (CR 601.2c):
 *   - divided damage: "deals N damage divided as you choose among one, two, or three targets"
 *   - "deals N damage to each of one or two targets"
 *   - adjective / subtype single targets: "target monocolored permanent",
 *     "target nonblack creature that entered this turn", "target nonbasic land",
 *     "target Vehicle", "target Plains", "target green creature an opponent controls"
 *   - controller wording the parser drops ("you don't control")
 *   - creature-only stat clauses on a type list: "target artifact, enchantment, or
 *     creature with power 4 or greater" (the stat applies only to the creature branch)
 * Plus multi-target clause splitting ("X fights target Y", "Choose target X and target Y",
 * "Destroy target A and target B").
 *
 * Split UI for divided damage is not built here; the reqs only carry `dividedDamageTotal`.
 *
 * Public entry symbols: augmentCastTargetRequirements, permanentMatchesCastTargetPatternExtras,
 * splitMultiTargetClause.
 */
import { permanentMatchesTargetTypeEntry } from "../permanentTargetTypeFilter.js";

const CORE_TYPES = new Set(['creature', 'permanent', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle']);
const NON_PERMANENT_NOUNS = new Set(['player', 'players', 'opponent', 'opponents', 'spell', 'spells', 'ability', 'abilities', 'card', 'cards', 'source', 'sources', 'mode', 'modes']);
const STATUS_ADJECTIVES = new Set(['tapped', 'untapped', 'attacking', 'blocking']);
const ADJECTIVE = String.raw`(?:non-?[a-z]+|white|blue|black|red|green|colorless|monocolored|multicolored|basic|legendary|snow|token|tapped|untapped|attacking|blocking)`;
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function countOf(word: string | undefined, fallback: number): number {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return fallback;
  if (COUNT_WORDS[w]) return COUNT_WORDS[w];
  const n = Number.parseInt(w, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function controllerFromWording(text: string): 'you' | 'opponent' | undefined {
  if (/\b(?:you don't control|you do not control|an opponent controls|your opponents control|that player controls)\b/.test(text)) return 'opponent';
  if (/\byou control\b/.test(text)) return 'you';
  return undefined;
}

function divisionTargetTypes(noun: string): string[] {
  const n = noun.toLowerCase();
  if (/^targets?$/.test(n)) return ['any'];
  const types: string[] = [];
  if (/creature/.test(n)) types.push('creature');
  if (/planeswalker/.test(n)) types.push('planeswalker');
  if (/player/.test(n)) types.push('player');
  if (/battle/.test(n)) types.push('battle');
  return types.length > 0 ? types : ['any'];
}

/** "one", "one or two", "one, two, or three", "any number of", "up to three" -> [min, max]. */
function rangeOf(phrase: string, damageTotal: number | undefined): [number, number] | null {
  const p = phrase.trim().toLowerCase();
  if (/^any number of$/.test(p)) return [1, Math.max(1, damageTotal || 1)];
  const upTo = p.match(/^up to (\w+)$/);
  if (upTo) return [0, countOf(upTo[1], 1)];
  const words = p.replace(/,/g, ' ').split(/\s+/).filter((w) => w && w !== 'or' && w !== 'and');
  const counts = words.map((w) => countOf(w, 0)).filter((n) => n > 0);
  if (counts.length === 0) return null;
  return [Math.min(...counts), Math.max(...counts)];
}

function parseDivisionOrEach(text: string): any | null {
  const divided = text.match(/deals? (\d+|x) damage divided (?:evenly |as you choose )?(?:among|between) (any number of|one, two, or three|one, two, three, or four|one or two|two or three|up to \w+|one|two|three) (targets?|target (?:creatures?|planeswalkers?|players?|battles?)(?:(?:,| and\/or| or) (?:creatures?|planeswalkers?|players?|battles?))*)/);
  if (divided) {
    const total = /^\d+$/.test(divided[1]) ? Number(divided[1]) : undefined;
    const range = rangeOf(divided[2], total);
    if (!range) return null;
    return {
      needsTargets: true,
      targetTypes: divisionTargetTypes(divided[3]),
      minTargets: range[0],
      maxTargets: range[1],
      targetDescription: divided[3].replace(/^targets?$/, 'any target'),
      dividedDamageTotal: total ?? 'X',
    };
  }
  const each = text.match(/to each of (one, two, or three|one or two|two or three|up to \w+) (targets?|target (?:creatures?|planeswalkers?|players?)(?:(?:,| and\/or| or) (?:creatures?|planeswalkers?|players?))*)/);
  if (each) {
    const range = rangeOf(each[1], undefined);
    if (!range) return null;
    return {
      needsTargets: true,
      targetTypes: divisionTargetTypes(each[2]),
      minTargets: range[0],
      maxTargets: range[1],
      targetDescription: each[2].replace(/^targets?$/, 'any target'),
    };
  }
  return null;
}

const SINGLE_TARGET_RE = new RegExp(
  String.raw`(?:\b(up to )?(one|two|three|\d+) )?\btarget ((?:${ADJECTIVE} )*)([a-z][a-z'-]*)` +
  String.raw`((?: (?:you control|you don't control|you do not control|an opponent controls|your opponents control))?)` +
  String.raw`((?: that entered(?: the battlefield)? this turn)?)`,
);

function parseAdjectiveSingleTarget(text: string): any | null {
  const m = text.match(SINGLE_TARGET_RE);
  if (!m) return null;
  const noun = m[4];
  if (NON_PERMANENT_NOUNS.has(noun)) return null;
  // "target creature card" / "target land card" live in graveyards.
  if (new RegExp(String.raw`\btarget (?:${ADJECTIVE} )*${noun} cards?\b`).test(text)) return null;
  const adjectives = String(m[3] || '').trim().split(/\s+/).filter(Boolean);
  const entryWords = adjectives.filter((word) => !STATUS_ADJECTIVES.has(word));
  const singularNoun = noun.endsWith('s') && CORE_TYPES.has(noun.slice(0, -1)) ? noun.slice(0, -1) : noun;
  const baseType = CORE_TYPES.has(singularNoun) ? singularNoun : 'permanent';
  if (baseType !== singularNoun || entryWords.length > 0) entryWords.push(singularNoun);
  const status = adjectives.find((word) => STATUS_ADJECTIVES.has(word));
  const max = countOf(m[2], 1);
  const reqs: any = {
    needsTargets: true,
    targetTypes: [baseType],
    minTargets: m[1] ? 0 : max,
    maxTargets: max,
    targetDescription: m[0].replace(/^.*?\btarget /, '').trim(),
  };
  if (entryWords.length > 0) reqs.castTargetTypeEntry = entryWords.join(' ');
  const ctl = controllerFromWording(String(m[5] || ''));
  if (ctl) reqs.targetControllerConstraint = ctl;
  if (m[6]) reqs.targetRestriction = { type: 'entered_this_turn', description: 'that entered this turn' };
  else if (status) {
    reqs.targetRestriction = status === 'attacking'
      ? { type: 'attacked_this_turn', description: 'that is attacking' }
      : status === 'blocking'
        ? { type: 'blocked_this_turn', description: 'that is blocking' }
        : { type: status, description: `that is ${status}` };
  }
  return reqs;
}

function hasTargetsAlready(reqs: any): boolean {
  return Boolean(reqs?.needsTargets)
    && Number(reqs?.maxTargets || 0) > 0
    && Array.isArray(reqs?.targetTypes)
    && reqs.targetTypes.length > 0;
}

/**
 * Fill in or tighten parsed cast target requirements from generic oracle patterns.
 * Returns the original object when no pattern applies.
 */
export function augmentCastTargetRequirements<T>(oracleText: string, targetReqs: T): T {
  const text = String(oracleText || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (!/\btargets?\b/.test(text)) return targetReqs;
  let reqs: any = targetReqs;

  const division = parseDivisionOrEach(text);
  if (division && (!hasTargetsAlready(reqs) || Number(reqs.maxTargets) < Number(division.maxTargets))) {
    reqs = { ...(reqs || {}), ...division };
  } else if (!hasTargetsAlready(reqs)) {
    const single = parseAdjectiveSingleTarget(text);
    if (single) reqs = { ...(reqs || {}), ...single };
  } else if (hasTargetsAlready(reqs)) {
    const single = parseAdjectiveSingleTarget(text);
    // Parser kept the base type but dropped colour/subtype/controller words.
    if (single && single.targetTypes[0] === 'permanent' && single.castTargetTypeEntry && !reqs.castTargetTypeEntry
      && reqs.targetTypes.length === 1 && String(reqs.targetTypes[0]).toLowerCase() === 'permanent') {
      reqs = { ...reqs, castTargetTypeEntry: single.castTargetTypeEntry };
    } else if (single?.castTargetTypeEntry && !reqs.castTargetTypeEntry && reqs.targetTypes.length === 1
      && String(reqs.targetTypes[0]).toLowerCase() === single.targetTypes[0]) {
      reqs = { ...reqs, castTargetTypeEntry: single.castTargetTypeEntry };
    }
    if (single?.targetControllerConstraint && (!reqs.targetControllerConstraint || reqs.targetControllerConstraint === 'any')) {
      reqs = { ...reqs, targetControllerConstraint: single.targetControllerConstraint };
    }
    if (single?.targetRestriction && !reqs.targetRestriction) {
      reqs = { ...reqs, targetRestriction: single.targetRestriction };
    }
  }

  // "target artifact, enchantment, or creature with power 4 or greater": creature branch only.
  const creatureStat = text.match(/\btarget [a-z ,]*\bor creatures? with (power|toughness) (\d+) or (greater|less)\b/);
  if (creatureStat && hasTargetsAlready(reqs) && !reqs.statRequirement) {
    reqs = {
      ...reqs,
      castTargetCreatureStat: {
        stat: creatureStat[1],
        comparison: creatureStat[3] === 'greater' ? '>=' : '<=',
        value: Number(creatureStat[2]),
      },
    };
  }
  return reqs as T;
}

function readStat(permanent: any, stat: string): number {
  const card = permanent?.card || {};
  const raw = stat === 'power' ? (permanent?.effectivePower ?? permanent?.power ?? card?.power) : (permanent?.effectiveToughness ?? permanent?.toughness ?? card?.toughness);
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Extra per-permanent filters carried by augmented reqs. */
export function permanentMatchesCastTargetPatternExtras(permanent: any, targetReqs: any): boolean {
  if (!targetReqs) return true;
  if (targetReqs.castTargetTypeEntry && !permanentMatchesTargetTypeEntry(permanent, targetReqs.castTargetTypeEntry)) return false;
  const stat = targetReqs.castTargetCreatureStat;
  if (stat) {
    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    const otherTypes = (Array.isArray(targetReqs.targetTypes) ? targetReqs.targetTypes : [])
      .map((t: any) => String(t || '').toLowerCase())
      .filter((t: string) => t && t !== 'creature');
    const matchesOther = otherTypes.some((t: string) => typeLine.includes(t));
    if (typeLine.includes('creature') && !matchesOther) {
      const value = readStat(permanent, stat.stat);
      if (stat.comparison === '>=' ? value < stat.value : value > stat.value) return false;
    }
  }
  return true;
}

/**
 * Split one clause holding two or more targets joined by "and target" / "fights target"
 * into one clause per target. Graveyard, card, spell and bite ("to target") wordings stay whole.
 */
export function splitMultiTargetClause(clauseText: string): string[] | null {
  const text = String(clauseText || '').trim();
  const lower = text.toLowerCase();
  if (!/\btarget\b[^.]*?\b(?:and|fights?)\s+target\b/.test(lower)) return null;
  if (/\b(?:cards?|graveyards?|spells?|abilit(?:y|ies)|divided|each of|any number of)\b/.test(lower)) return null;
  const parts = text.split(/\s+(?:and|fights?)\s+(?=target\b)/i);
  if (parts.length < 2) return null;
  const segments = parts.map((part) => {
    const start = part.search(/\btarget\b/i);
    let seg = start >= 0 ? part.slice(start) : part;
    seg = seg.replace(/\s+(?:gets?|gains?|has|have|loses?|becomes?|can't|cannot|deals?|fights?|to|from|onto|into|until|then|each other|and)\b.*$/i, '');
    return seg.replace(/[,.;]\s*$/, '').trim();
  }).filter((seg) => /^target\b/i.test(seg));
  return segments.length >= 2 ? segments : null;
}
