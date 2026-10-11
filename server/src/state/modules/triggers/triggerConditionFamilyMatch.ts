/**
 * Live-filter adapters for the shared trigger-condition matcher.
 * Public: enteringPermanentMatchesEtbPhrase, spellCastConditionMatches,
 *   tapPermanentMatchesPhrase, blockWatcherSubjectPhrase, isBlockWatcherTriggerType.
 */

import { hasChangeling } from '../../../../../rules-engine/src/tribalSupport.js';
import { oracleTextHasOwnKeyword } from '../../../../../rules-engine/src/oracleOwnKeywordText.js';
import { stripReminderParentheticals } from '../../../../../rules-engine/src/oracleReminderText.js';
import {
  TRIGGER_SUBJECT_KEYWORDS,
  parseBecomesTappedSubjectClause,
  parseBecomesUntappedSubjectClause,
  parseBlocksSubjectClause,
  parseEntersSubjectClause,
  parseSpellCastClause,
  parseTriggerClause,
  triggerConditionMatches,
} from '../../../../../rules-engine/src/triggerCondition/index.js';
import type { TriggerConditionEvent } from '../../../../../rules-engine/src/triggerCondition/index.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { resolveEnchantedPlayerId } from './phaseWhoseTurn.js';

export function keywordsOnPermanent(permanent: any): string[] {
  const oracleText = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  const listed: string[] = [];
  for (const list of [permanent?.keywords, permanent?.card?.keywords, permanent?.grantedAbilities]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) listed.push(String(entry || '').toLowerCase());
  }
  return TRIGGER_SUBJECT_KEYWORDS.filter((keyword) => (
    listed.some((entry) => entry === keyword || entry.includes(keyword))
    || oracleTextHasOwnKeyword(oracleText, keyword)
  ));
}

export function permanentToTriggerMatch(permanent: any, controllerId?: string): TriggerMatchPermanent {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
  const oracleText = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  return {
    id: String(permanent?.id || '').trim(),
    typeLine,
    controllerId: String(controllerId || permanent?.controller || '').trim(),
    isToken: Boolean(permanent?.isToken || permanent?.token || permanent?.card?.isToken || permanent?.card?.token),
    hasAllCreatureTypes: hasChangeling(oracleText, typeLine),
    keywords: keywordsOnPermanent(permanent),
    counters: permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : undefined,
    power: finiteNumber(permanent?.power ?? permanent?.card?.power),
    toughness: finiteNumber(permanent?.toughness ?? permanent?.card?.toughness),
    faceDown: Boolean(permanent?.faceDown || permanent?.isFaceDown || permanent?.card?.faceDown),
    goaded: permanent?.goaded === true,
    attackingOrBlocking: permanentIsAttackingOrBlocking(permanent),
    isCommander: Boolean(permanent?.isCommander || permanent?.commander || permanent?.card?.isCommander),
    ownerId: String(permanent?.owner || permanent?.card?.owner || '').trim() || undefined,
    colors: colorLetters(permanent?.card?.colors || permanent?.colors),
  };
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function permanentIsAttackingOrBlocking(permanent: any): boolean {
  const attacking = permanent?.attacking === true
    || (typeof permanent?.attacking === 'string' && permanent.attacking.trim() !== '')
    || permanent?.isAttacking === true;
  const blocking = permanent?.blocking === true
    || (Array.isArray(permanent?.blocking) && permanent.blocking.length > 0)
    || (typeof permanent?.blocking === 'string' && permanent.blocking.trim() !== '');
  return Boolean(attacking || blocking);
}

const COLOR_LETTER: Readonly<Record<string, string>> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', w: 'w', u: 'u', b: 'b', r: 'r', g: 'g',
};

function colorLetters(colors: unknown): string[] | undefined {
  if (!Array.isArray(colors)) return undefined;
  const letters = colors
    .map((color) => COLOR_LETTER[String(color || '').trim().toLowerCase()])
    .filter(Boolean);
  return letters.length ? letters : undefined;
}

/** Type phrase only. Controller and source stay on the caller's existing filter. */
export function enteringTypePhraseMatches(typeLine: string, phrase: string, isToken: boolean): boolean | null {
  const raw = String(phrase || '').trim();
  if (!raw) return null;
  const clause = /^(?:a|an|one)\b/i.test(raw) ? raw : `a ${raw}`;
  const parsed = parseEntersSubjectClause(clause);
  if (!parsed) return null;
  if (parsed.alternatives.some((alternative) => {
    const subject = alternative.subject;
    return subject.keywordsWith.length > 0
      || subject.keywordsWithout.length > 0
      || (subject.stats && subject.stats.length > 0)
      || (subject.counters && subject.counters.length > 0)
      || subject.chosenType
      || subject.dealtDamageBy;
  })) {
    return null;
  }
  if (parsed.alternatives.some((alternative) => alternative.controller !== 'any' || alternative.source !== 'any')) {
    return null;
  }
  return triggerConditionMatches(
    parsed,
    { id: '', typeLine, controllerId: '', isToken },
    { id: '', controllerId: '' },
  );
}

export function enteringPermanentMatchesEtbPhrase(
  phrase: string,
  enteringPermanent: any,
  enteringController: string,
  sourcePermanent: any,
): boolean | null {
  const parsed = parseEntersSubjectClause(phrase);
  if (!parsed) return null;
  return triggerConditionMatches(
    parsed,
    permanentToTriggerMatch(enteringPermanent, enteringController),
    {
      id: String(sourcePermanent?.id || '').trim(),
      controllerId: String(sourcePermanent?.controller || '').trim(),
      attachedToId: String(sourcePermanent?.attachedTo || '').trim(),
    },
  );
}

const BLOCK_WATCHER_SUBJECT: Readonly<Record<string, string>> = {
  any_creature_blocks: 'a creature',
  opponent_creature_blocks: 'a creature an opponent controls',
  controlled_creature_blocks: 'a creature you control',
  enchanted_creature_blocks: 'enchanted creature',
  equipped_creature_blocks_creature: 'equipped creature',
};

export function isBlockWatcherTriggerType(triggerType: string | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(BLOCK_WATCHER_SUBJECT, String(triggerType || ''));
}

export function blockWatcherSubjectPhrase(triggerType: string | undefined): string | null {
  return BLOCK_WATCHER_SUBJECT[String(triggerType || '')] || null;
}

export function blockingCreatureMatchesWatcher(
  triggerType: string | undefined,
  blocker: any,
  sourcePermanent: any,
): boolean {
  const phrase = blockWatcherSubjectPhrase(triggerType);
  if (!phrase) return false;
  const parsed = parseBlocksSubjectClause(phrase);
  if (!parsed) return false;
  return triggerConditionMatches(
    parsed,
    permanentToTriggerMatch(blocker, blocker?.controller),
    {
      id: String(sourcePermanent?.id || '').trim(),
      controllerId: String(sourcePermanent?.controller || sourcePermanent?.controllerId || '').trim(),
      attachedToId: String(sourcePermanent?.attachedTo || '').trim(),
    },
  );
}

function spellPhrase(
  spellCondition: string,
  casterScope: 'you' | 'opponent' | 'any_player',
  detail?: string,
): string | null {
  const verb = casterScope === 'you'
    ? 'you cast'
    : casterScope === 'opponent'
      ? 'an opponent casts'
      : 'a player casts';
  const first = casterScope === 'you' ? 'your' : 'their';
  switch (spellCondition) {
    case 'any':
      return `${verb} a spell`;
    case 'creature':
      return `${verb} a creature spell`;
    case 'noncreature':
      return `${verb} a noncreature spell`;
    case 'instant_sorcery':
      return `${verb} an instant or sorcery spell`;
    case 'artifact_or_creature':
      return `${verb} an artifact or creature spell`;
    case 'historic':
      return `${verb} a historic spell`;
    case 'first_noncreature':
      return `${verb} ${first} first noncreature spell each turn`;
    case 'first_any':
      return `${verb} ${first} first spell each turn`;
    case 'tribal_type':
      return detail ? `${verb} a ${detail} spell` : null;
    case 'color':
    case 'chosen_color':
      return detail ? `${verb} a ${detail} spell` : null;
    default:
      return null;
  }
}

export function tapPermanentMatchesPhrase(
  phrase: string,
  tappedPermanent: any,
  sourcePermanent: any,
  event: 'becomes_tapped' | 'becomes_untapped' = 'becomes_tapped',
): boolean | null {
  const parsed = event === 'becomes_untapped'
    ? parseBecomesUntappedSubjectClause(phrase)
    : parseBecomesTappedSubjectClause(phrase);
  if (!parsed) return null;
  return triggerConditionMatches(
    parsed,
    permanentToTriggerMatch(tappedPermanent),
    {
      id: String(sourcePermanent?.id || '').trim(),
      controllerId: String(sourcePermanent?.controller || '').trim(),
      attachedToId: String(sourcePermanent?.attachedTo || '').trim(),
    },
  );
}

export function spellCastConditionMatches(options: {
  spellCondition: string;
  casterScope: 'you' | 'opponent' | 'any_player';
  spellCard: any;
  sourceControllerId: string;
  casterId: string;
  castFromZone?: string;
  sourceZoneRequirement?: string;
  targetControllerId?: string;
  tribalType?: string;
  spellOrdinal?: number;
}): boolean | null {
  if ((options.spellCondition === 'first_any' || options.spellCondition === 'tribal_type' || options.spellCondition === 'color' || options.spellCondition === 'chosen_color')
    && !options.tribalType
    && options.spellCondition !== 'first_any') {
    return null;
  }
  if (options.spellCondition === 'first_any' && options.spellOrdinal === undefined) return null;
  const detail = options.spellCondition === 'tribal_type' || options.spellCondition === 'color' || options.spellCondition === 'chosen_color'
    ? options.tribalType
    : undefined;
  const phrase = spellPhrase(options.spellCondition, options.casterScope, detail);
  if (!phrase) return null;
  const parsed = parseSpellCastClause(phrase);
  if (!parsed) return null;
  const zone = options.sourceZoneRequirement;
  const condition: TriggerConditionIR = zone === 'hand' || zone === 'library' || zone === 'exile' || zone === 'graveyard' || zone === 'not_hand'
    ? { ...parsed, castFromZone: zone }
    : parsed;
  return triggerConditionMatches(
    condition,
    permanentToTriggerMatch(options.spellCard, options.casterId),
    { id: '', controllerId: String(options.sourceControllerId || '').trim() },
    {
      castFromZone: options.castFromZone,
      targetControllerId: options.targetControllerId,
      spellOrdinal: options.spellOrdinal,
    },
  );
}

function effectKey(effect: string): string {
  return String(effect || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Sentences the family regex did not already queue. The caller skips effects
 * it has already recorded for this source.
 */
export function collectMatchingParsedEventLines(options: {
  ctx?: any;
  oracleText: string;
  event: TriggerConditionEvent;
  subjectPermanent: any;
  subjectControllerId: string;
  sourcePermanent: any;
  activePlayerId?: string;
  spellOrdinal?: number;
  castFromZone?: string;
  libraryOwnerId?: string;
  zoneOwnerId?: string;
  fromZone?: string;
}): Array<{ effect: string; interveningIf?: string; condition?: import('../../../../../rules-engine/src/triggerCondition/index.js').TriggerConditionIR; reflexive?: { actor: 'you' | 'they'; effect: string; delayed?: { timing: 'next_end_step' | 'your_next_end_step'; effect: string } }; delayed?: { timing: 'next_end_step' | 'your_next_end_step'; effect: string } }> {
  const text = stripReminderParentheticals(String(options.oracleText || ''));
  const sentences = text.split(/\n+|(?<=\.)\s+/);
  const effects = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const parsed = parseTriggerClause(sentence);
    if (!parsed || parsed.condition.event !== options.event || !parsed.effect) continue;
    if (parsed.interveningIf && options.ctx) {
      const probe = `Whenever a permanent ${options.event}, if ${parsed.interveningIf}, ${parsed.effect}`;
      try {
        if (isInterveningIfSatisfied(
          options.ctx,
          String(options.sourcePermanent?.controller || ''),
          probe,
          options.subjectPermanent,
        ) === false) {
          continue;
        }
      } catch {
        // Keep the line when the intervening-if check cannot run.
      }
    }
    const key = effectKey(parsed.effect);
    if (!key || seen.has(key)) continue;
    const matched = triggerConditionMatches(
      parsed.condition,
      permanentToTriggerMatch(options.subjectPermanent, options.subjectControllerId),
      {
        id: String(options.sourcePermanent?.id || '').trim(),
        controllerId: String(options.sourcePermanent?.controller || '').trim(),
        attachedToId: String(options.sourcePermanent?.attachedTo || '').trim(),
        chosenCreatureType: String(options.sourcePermanent?.chosenCreatureType || '').trim() || undefined,
      },
      {
        activePlayerId: options.activePlayerId,
        enchantedPlayerId: resolveEnchantedPlayerId(options.sourcePermanent, options.ctx?.state),
        monarchPlayerId: String(options.ctx?.state?.monarch || '').trim(),
        chosenPlayerId: String(
          options.sourcePermanent?.chosenPlayer
          || options.sourcePermanent?.chosenPlayerId
          || options.sourcePermanent?.card?.chosenPlayer
          || '',
        ).trim(),
        spellOrdinal: options.spellOrdinal,
        castFromZone: options.castFromZone,
        libraryOwnerId: options.libraryOwnerId,
        zoneOwnerId: options.zoneOwnerId,
        fromZone: options.fromZone,
      },
    );
    if (!matched) continue;
    seen.add(key);
    effects.push({
      effect: parsed.effect,
      condition: parsed.condition,
      ...(parsed.interveningIf ? { interveningIf: parsed.interveningIf } : {}),
      ...(parsed.reflexive ? { reflexive: parsed.reflexive } : {}),
      ...(parsed.delayed ? { delayed: parsed.delayed } : {}),
    });
  }
  return effects;
}
