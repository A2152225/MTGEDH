/**
 * Origin: new generic cluster (executor coverage gap closure for mass selectors).
 * Cluster: parse "each / all / other ... you control with ..." battlefield selectors into predicates.
 * Public entry: resolveMassBattlefieldSelector.
 *
 * Returns null when the selector text is not fully understood (caller keeps its gap), and an array
 * (possibly empty) when it is. An empty array is a legitimate "no matching permanents" result.
 */

import type { BattlefieldPermanent, GameState } from '../../shared/src';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes.js';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type Pred = (perm: any) => boolean;

const COLOR_LETTERS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function permanentId(perm: any): string {
  return String(perm?.id || '').trim();
}

function permanentColors(perm: any): string[] {
  const raw = Array.isArray(perm?.colors) ? perm.colors : Array.isArray(perm?.card?.colors) ? perm.card.colors : [];
  const letters = raw.map((c: unknown) => String(c || '').trim().toUpperCase().slice(0, 1)).filter(Boolean);
  if (letters.length > 0) return letters;
  const cost = String(perm?.card?.mana_cost || perm?.mana_cost || '');
  return ['W', 'U', 'B', 'R', 'G'].filter((letter) => cost.includes(`{${letter}`) || cost.includes(`/${letter}`));
}

function permanentKeywordLike(perm: any, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  const lists = [perm?.keywords, perm?.card?.keywords, perm?.grantedAbilities, perm?.abilities];
  for (const list of lists) {
    if (Array.isArray(list) && list.some((entry: unknown) => String(entry || '').toLowerCase().includes(needle))) return true;
  }
  const text = `${perm?.oracle_text || ''} ${perm?.card?.oracle_text || ''}`.toLowerCase();
  return text.includes(needle);
}

function anyCounter(perm: any): boolean {
  const counters = perm?.counters;
  if (!counters) return false;
  if (Array.isArray(counters)) return counters.length > 0;
  return Object.values(counters as Record<string, number>).some((count) => Number(count) > 0);
}

function hasNamedCounter(perm: any, name: string): boolean {
  return (getCounterCountOnObject(perm, name) ?? 0) > 0;
}

function readNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isCreature(perm: any): boolean {
  return /\bcreature\b/.test(getExecutorTypeLineLower(perm));
}

function isModified(perm: any): boolean {
  return (
    anyCounter(perm) ||
    (Array.isArray(perm?.attachedEquipment) && perm.attachedEquipment.length > 0) ||
    (Array.isArray(perm?.equipment) && perm.equipment.length > 0) ||
    (Array.isArray(perm?.auras) && perm.auras.length > 0) ||
    (Array.isArray(perm?.attachments) && perm.attachments.length > 0)
  );
}

function cleanSelectorText(raw: string): string {
  let text = String(raw || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '')
    .trim();
  text = text.replace(/^until end of (?:turn|combat),\s*/, '');
  // Parser artifacts: "whenever a land you control enters, creatures you control" / "pathbreaker owlbear, other ..."
  const lastComma = text.lastIndexOf(', ');
  if (lastComma > 0) {
    // A condition clause ("whenever a land you control enters, ...") belongs to a different ability: not ours to apply.
    if (/^(?:whenever|when|at the beginning of|if|as long as)\b/.test(text)) return '';
    text = text.slice(lastComma + 2).trim();
  }
  // "...and those creatures gain deathtouch", "... equal to that creature's toughness"
  text = text
    .replace(/\s+and those creatures\b.*$/, '')
    .replace(/\s+equal to\b.*$/, '')
    .trim();
  return text;
}

/**
 * @returns permanents matching the selector, or null when the selector is not recognized.
 */
export function resolveMassBattlefieldSelector(
  state: GameState,
  targetText: string,
  ctx: OracleIRExecutionContext,
  runtime?: { readonly lastExiledCards?: readonly any[]; readonly lastMovedCards?: readonly any[] }
): BattlefieldPermanent[] | null {
  let text = cleanSelectorText(targetText);
  if (!text || /\btarget\b/.test(text)) return null;
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).filter(Boolean);
  const controllerId = String(ctx.controllerId || '').trim();
  const sourceId = String(ctx.sourceId || '').trim();
  const sourcePerm = battlefield.find((perm) => permanentId(perm) === sourceId) as any;

  const preds: Pred[] = [];
  let requireCreature = false;
  let conditionMet = true;

  // "each creature you control if you control a creature with power 5 or greater"
  const ifControl = text.match(/\s+if you control an? creature with power (\d+) or greater$/);
  if (ifControl) {
    const minPower = Number(ifControl[1]);
    conditionMet = battlefield.some(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        isCreature(perm) &&
        readNumber(perm?.effectivePower, perm?.power, perm?.card?.power) >= minPower
    );
    text = text.slice(0, ifControl.index).trim();
  }

  // "... that didn't attack or enter this turn" / "... that attacked this turn"
  const notAttackedOrEntered = / that didn't attack or enter this turn$/.test(text);
  if (notAttackedOrEntered) {
    preds.push((perm) => !perm?.attackedThisTurn && !perm?.attacking && !perm?.enteredThisTurn && !perm?.summoningSickness);
    text = text.replace(/ that didn't attack or enter this turn$/, '');
  }
  if (/ that attacked this turn$/.test(text)) {
    preds.push((perm) => Boolean(perm?.attackedThisTurn || perm?.attacking || perm?.isAttacking));
    text = text.replace(/ that attacked this turn$/, '');
  }

  // "... that shares a creature type with the exiled card / it / that creature"
  const sharesType = text.match(/ (?:that )?shares? a creature type with (.+)$/);
  if (sharesType) {
    const refText = String(sharesType[1] || '').trim();
    const refCard =
      (/exiled card/.test(refText) ? (runtime?.lastExiledCards || [])[0] : undefined) ||
      (runtime?.lastMovedCards || [])[0] ||
      battlefield.find((perm) => permanentId(perm) === String(ctx.targetCreatureId || ctx.lastReferencedPermanentId || '').trim()) ||
      sourcePerm;
    const refTypes = new Set(
      String((refCard as any)?.type_line || (refCard as any)?.card?.type_line || '')
        .split(/[—-]/)
        .slice(1)
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    );
    preds.push((perm) => {
      const types = String(perm?.type_line || perm?.card?.type_line || '')
        .split(/[—-]/)
        .slice(1)
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      return types.some((type) => refTypes.has(type));
    });
    text = text.slice(0, sharesType.index).trim();
  }

  // "... named this permanent" / "... named gruff triplets"
  const named = text.match(/ named (.+)$/);
  if (named) {
    const nameText = String(named[1] || '').trim();
    const wanted = /^(?:this (?:permanent|creature)|~)$/.test(nameText)
      ? String(sourcePerm?.name || sourcePerm?.card?.name || ctx.sourceName || '').trim().toLowerCase()
      : nameText;
    if (!wanted) return null;
    preds.push((perm) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === wanted);
    text = text.slice(0, named.index).trim();
  }

  // "... created with this enchantment/creature"
  const createdWith = text.match(/ created with (?:this (?:enchantment|creature|permanent|artifact)|~)$/);
  if (createdWith) {
    preds.push((perm) => String(perm?.createdBySourceId || '').trim() === sourceId && Boolean(sourceId));
    text = text.slice(0, createdWith.index).trim();
  }

  // "... with the same name as that creature" (reference may have left the battlefield: use its recorded name)
  const sameName = text.match(/ with the same name as (?:that creature|that permanent|it)$/);
  if (sameName) {
    const refId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.lastReferencedPermanentId || ''
    ).trim();
    const refPerm = battlefield.find((perm) => permanentId(perm) === refId) as any;
    const refName = String(
      refPerm?.name || refPerm?.card?.name || ctx.selectorContext?.referencedObjectName || ''
    ).trim().toLowerCase();
    if (!refName) return [];
    preds.push((perm) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === refName);
    text = text.slice(0, sameName.index).trim();
  }

  // "... with a +1/+1 counter on it", "... with modular", "... with power 3 or greater"
  const withQualifier = text.match(/ with (.+)$/);
  if (withQualifier) {
    const qualifier = String(withQualifier[1] || '').trim();
    const counterMatch = qualifier.match(/^an? ([a-z0-9+/\- ]+?) counters? on it$/);
    if (counterMatch) {
      const counterName = String(counterMatch[1] || '').trim();
      preds.push((perm) => hasNamedCounter(perm, counterName));
    } else if (/^an? counters? on it$/.test(qualifier)) {
      preds.push(anyCounter);
    } else if (/^[a-z][a-z ]*$/.test(qualifier)) {
      preds.push((perm) => permanentKeywordLike(perm, qualifier));
    } else {
      return null;
    }
    text = text.slice(0, withQualifier.index).trim();
  } else if (/ with an? counters? on it$/.test(text)) {
    return null;
  }

  // Trailing "other than this creature"
  let excludeSource = false;
  const otherThan = text.match(/ other than (?:this (?:creature|permanent)|~)$/);
  if (otherThan) {
    excludeSource = true;
    text = text.slice(0, otherThan.index).trim();
  }

  // Controller phrase
  let controllerPred: Pred | null = null;
  const defendingIds = [
    ctx.selectorContext?.targetOpponentId,
    ctx.targetOpponentId,
    (ctx as any).defendingPlayerId,
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const attackingOpponents = text.match(/^creatures attacking (?:your opponents|an opponent)(?: and\/or planeswalkers they control)?$/);
  if (attackingOpponents) {
    preds.push((perm) => Boolean(perm?.attacking || perm?.isAttacking || perm?.defendingPlayerId));
    controllerPred = (perm) => String(perm?.controller || '').trim() === controllerId;
    text = 'creatures';
  }
  const controllerMatch = text.match(
    / (you control|your team controls|your opponents control|an opponent controls|you don't control|defending player controls)$/
  );
  if (controllerMatch) {
    const phrase = String(controllerMatch[1]);
    if (phrase === 'you control' || phrase === 'your team controls') {
      controllerPred = (perm) => String(perm?.controller || '').trim() === controllerId;
    } else if (phrase === 'defending player controls') {
      controllerPred = (perm) => {
        const controller = String(perm?.controller || '').trim();
        return defendingIds.length > 0 ? defendingIds.includes(controller) : controller !== controllerId;
      };
    } else {
      controllerPred = (perm) => String(perm?.controller || '').trim() !== controllerId;
    }
    text = text.slice(0, controllerMatch.index).trim();
  }

  // Quantifier + other
  let otherWord = false;
  text = text.replace(/^(?:each|all|every)\s+/, '');
  const otherPrefix = text.match(/^(other|another)\s+/);
  if (otherPrefix) {
    otherWord = true;
    text = text.slice(otherPrefix[0].length);
  }

  // "each of those creatures (you don't control)": antecedent set from a preceding step
  if (/^(?:of )?those (?:creatures|permanents)$/.test(text)) {
    const antecedent = new Set(
      [
        ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
        ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
          ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
          : []),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    return battlefield.filter((perm: any) => antecedent.has(permanentId(perm)) && (!controllerPred || controllerPred(perm)));
  }

  // "creatures that convoked it"
  if (/^creatures? that convoked (?:it|this spell)$/.test(text)) {
    const ids = new Set(
      [...(ctx.selectorContext?.convokedCreatureIds || []), ...((ctx as any).convokedCreatureIds || [])]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    return battlefield.filter((perm) => ids.has(permanentId(perm)));
  }

  // Descriptor words: adjectives, creature types (and/or lists), noun.
  const tokens = text.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const subtypeUnion: string[] = [];
  let sawNoun = false;
  const typeRequirements: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === 'creature' || token === 'creatures') {
      sawNoun = true;
      requireCreature = true;
    } else if (token === 'token' || token === 'tokens') {
      sawNoun = true;
      preds.push((perm) => Boolean(perm?.isToken));
    } else if (token === 'permanent' || token === 'permanents') {
      sawNoun = true;
    } else if (token === 'planeswalker' || token === 'planeswalkers') {
      sawNoun = true;
      typeRequirements.push('planeswalker');
    } else if (token === 'equipment') {
      sawNoun = true;
      typeRequirements.push('artifact', 'equipment');
    } else if (token === 'artifact' || token === 'artifacts') {
      typeRequirements.push('artifact');
      if (i === tokens.length - 1) sawNoun = true;
    } else if (token === 'enchantment' || token === 'enchantments') {
      typeRequirements.push('enchantment');
      if (i === tokens.length - 1) sawNoun = true;
    } else if (token === 'land') {
      typeRequirements.push('land');
    } else if (token === 'legendary') {
      typeRequirements.push('legendary');
    } else if (token === 'attacking') {
      preds.push((perm) => Boolean(perm?.attacking || perm?.isAttacking || perm?.attackingPlayerId || perm?.defendingPlayerId));
    } else if (token === 'blocking') {
      preds.push((perm) => Boolean(perm?.blocking || perm?.isBlocking));
    } else if (token === 'tapped') {
      preds.push((perm) => Boolean(perm?.tapped));
    } else if (token === 'untapped') {
      preds.push((perm) => !perm?.tapped);
    } else if (token === 'modified') {
      preds.push(isModified);
    } else if (token === 'face-down') {
      preds.push((perm) => Boolean(perm?.faceDown || perm?.isFaceDown || perm?.face_down));
    } else if (token === 'nontoken') {
      preds.push((perm) => !perm?.isToken);
    } else if (token in COLOR_LETTERS) {
      const letter = COLOR_LETTERS[token];
      preds.push((perm) => permanentColors(perm).includes(letter));
    } else if (/^non-(?:white|blue|black|red|green)$/.test(token)) {
      const letter = COLOR_LETTERS[token.slice(4)];
      preds.push((perm) => !permanentColors(perm).includes(letter));
    } else if (token === 'and' || token === 'or' || token === 'and/or') {
      if (subtypeUnion.length === 0 || i === tokens.length - 1) return null;
    } else {
      const type = normalizeCreatureTypeWord(token);
      if (!type) return null;
      subtypeUnion.push(type);
    }
  }
  if (!sawNoun && subtypeUnion.length === 0) return null;
  if (subtypeUnion.length > 0) requireCreature = true;
  if (!sawNoun && subtypeUnion.length > 0 && !controllerPred && !/creatures?$/.test(text)) return null;

  if (!conditionMet) return [];

  return battlefield.filter((perm: any) => {
    const typeLine = getExecutorTypeLineLower(perm);
    if (requireCreature && !isCreature(perm)) return false;
    for (const required of typeRequirements) {
      if (required === 'legendary') {
        if (!/\blegendary\b/.test(typeLine)) return false;
      } else if (!new RegExp(`\\b${required}\\b`).test(typeLine)) {
        return false;
      }
    }
    if (controllerPred && !controllerPred(perm)) return false;
    if ((otherWord || excludeSource) && sourceId && permanentId(perm) === sourceId) return false;
    if (subtypeUnion.length > 0 && !subtypeUnion.some((type) => new RegExp(`(^|[^a-z])${type}($|[^a-z])`).test(typeLine) || permanentKeywordLike(perm, 'changeling'))) {
      return false;
    }
    return preds.every((pred) => pred(perm));
  });
}
