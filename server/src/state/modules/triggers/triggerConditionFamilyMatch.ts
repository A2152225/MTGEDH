/**
 * Live-filter adapters for the shared trigger-condition matcher.
 * Public: enteringPermanentMatchesEtbPhrase, spellCastConditionMatches,
 *   tapPermanentMatchesPhrase, blockWatcherSubjectPhrase, isBlockWatcherTriggerType.
 */

import { hasChangeling } from '../../../../../rules-engine/src/tribalSupport.js';
import { oracleTextHasOwnKeyword } from '../../../../../rules-engine/src/oracleOwnKeywordText.js';
import { permanentHasKeywordAbility } from '../../../../../rules-engine/src/permanentKeywordAbilities.js';
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
import type { TriggerConditionEvent, TriggerConditionIR, TriggerMatchPermanent } from '../../../../../rules-engine/src/triggerCondition/index.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { permanentHasTriggeredAbilities, type TriggerEventKind } from './triggeredAbilitySuppression.js';
import { resolveEnchantedControllerId, resolveEnchantedPlayerId } from './phaseWhoseTurn.js';
import { getPermanentPowerMaybe, getPermanentToughnessMaybe } from './intervening-if-permanent-and-player.js';

/**
 * Keywords the object has right now. With a battlefield, continuous grants (lords, auras,
 * equipment, "creatures you control have flying") and removals are honoured as well.
 */
export function keywordsOnPermanent(permanent: any, battlefield?: readonly any[]): string[] {
  const oracleText = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  const listed: string[] = [];
  for (const list of [permanent?.keywords, permanent?.card?.keywords, permanent?.grantedAbilities]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) listed.push(String(entry || '').toLowerCase());
  }
  // One pass narrows the battlefield to the only sources keyword checks can use (grant/removal
  // statics need "have"/"lose", plus attachments); exact, and avoids a full scan per keyword.
  const relevant = Array.isArray(battlefield) ? keywordRelevantBattlefield(permanent, battlefield) : undefined;
  return TRIGGER_SUBJECT_KEYWORDS.filter((keyword) => {
    const stored = listed.some((entry) => entry === keyword || entry.includes(keyword))
      || oracleTextHasOwnKeyword(oracleText, keyword);
    if (!relevant) return stored;
    try {
      return stored || permanentHasKeywordAbility(permanent, keyword, relevant);
    } catch {
      return stored;
    }
  });
}

const GRANT_OR_REMOVAL_WORD = /\b(?:have|lose)\b/i;

function sourceTextMayGrantOrRemove(source: any): boolean {
  const card = source?.card;
  if (GRANT_OR_REMOVAL_WORD.test(String(card?.oracle_text || source?.oracle_text || ''))) return true;
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  return faces.some((face: any) => GRANT_OR_REMOVAL_WORD.test(String(face?.oracle_text || '')));
}

/** Superset of battlefield objects that can affect permanentHasKeywordAbility for any keyword. */
function keywordRelevantBattlefield(permanent: any, battlefield: readonly any[]): any[] {
  const attachedIds = new Set<string>();
  for (const list of [permanent?.attachedEquipment, permanent?.attachments]) {
    if (Array.isArray(list)) for (const x of list) attachedIds.add(String(x));
  }
  return battlefield.filter((source: any) => source === permanent
    || (source?.attachedTo !== undefined && source?.attachedTo !== null && String(source.attachedTo) !== '')
    || attachedIds.has(String(source?.id || ''))
    || sourceTextMayGrantOrRemove(source));
}

export function permanentToTriggerMatch(permanent: any, controllerId?: string, state?: any): TriggerMatchPermanent {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
  const oracleText = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  const statContext = state ? { state } as any : undefined;
  const match: TriggerMatchPermanent = {
    id: String(permanent?.id || '').trim(),
    typeLine,
    controllerId: String(controllerId || permanent?.controller || '').trim(),
    isToken: Boolean(permanent?.isToken || permanent?.token || permanent?.card?.isToken || permanent?.card?.token),
    hasAllCreatureTypes: hasChangeling(oracleText, typeLine),
    counters: permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : undefined,
    faceDown: Boolean(permanent?.faceDown || permanent?.isFaceDown || permanent?.card?.faceDown),
    goaded: permanent?.goaded === true,
    attackingOrBlocking: permanentIsAttackingOrBlocking(permanent),
    isCommander: Boolean(permanent?.isCommander || permanent?.commander || permanent?.card?.isCommander),
    ownerId: String(permanent?.owner || permanent?.card?.owner || '').trim() || undefined,
    colors: colorLetters(permanent?.card?.colors || permanent?.colors),
  } as TriggerMatchPermanent;
  // Keywords (battlefield-wide grant scan) and current P/T are O(board) each and most
  // conditions never read them ("counters are put on this creature"); compute on first
  // read only. Values are the same as eager evaluation at match time.
  defineLazy(match, 'manaValue', () => {
    const raw = permanent?.card?.cmc ?? permanent?.card?.mana_value ?? permanent?.card?.manaValue ?? permanent?.cmc ?? permanent?.mana_value;
    const value = Number(raw);
    return raw === undefined || raw === null || !Number.isFinite(value) ? undefined : value;
  });
  defineLazy(match, 'kicked', () => [permanent, permanent?.card].some((obj: any) => obj && (
    obj.wasKicked === true || Number(obj.kickerPaidCount || 0) > 0 || Number(obj.timesKicked || 0) > 0
  )));
  defineLazy(match, 'keywords', () => keywordsOnPermanent(permanent, Array.isArray(state?.battlefield) ? state.battlefield : undefined));
  defineLazy(match, 'power', () => currentStat(getPermanentPowerMaybe(permanent, statContext)));
  defineLazy(match, 'toughness', () => currentStat(getPermanentToughnessMaybe(permanent, statContext)));
  return match;
}

function defineLazy(target: object, key: string, compute: () => unknown): void {
  let computed = false;
  let value: unknown;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (!computed) {
        value = compute();
        computed = true;
      }
      return value;
    },
    set(next: unknown) {
      value = next;
      computed = true;
    },
  });
}

function currentStat(value: number | null): number | undefined {
  return value === null || !Number.isFinite(value) ? undefined : value;
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
  /** Effective spell colours (Painter's Servant etc.); overrides the printed colours. */
  effectiveSpellColors?: readonly string[];
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
  const spellMatch = permanentToTriggerMatch(options.spellCard, options.casterId);
  const effectiveColors = options.effectiveSpellColors ? colorLetters([...options.effectiveSpellColors]) : undefined;
  return triggerConditionMatches(
    condition,
    effectiveColors ? { ...spellMatch, colors: effectiveColors } : spellMatch,
    { id: '', controllerId: String(options.sourceControllerId || '').trim() },
    {
      castFromZone: options.castFromZone,
      targetControllerId: options.targetControllerId,
      spellOrdinal: options.spellOrdinal,
    },
  );
}

function normalizeEffectForDedupe(text: unknown): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

/**
 * True when a parsed sentence is the same trigger a legacy family detector already
 * recorded. Legacy detectors often keep only a fragment ("you may pay {2}") while the
 * parsed line holds the full sentence, so containment is checked both ways.
 */
export function parsedEffectDuplicates(
  existingText: unknown,
  parsedEffect: unknown,
): boolean {
  // Accept a parsed line too: "you may pay {1}. If you do, create ..." keeps the follow-up in
  // line.reflexive, and legacy detectors often record only that follow-up as the effect.
  // Legacy entries keep a short effect and a fuller description; either may match.
  if (Array.isArray(existingText)) {
    return existingText.some((text) => String(text || '').trim() !== '' && parsedEffectDuplicates(text, parsedEffect))
      || existingText.every((text) => String(text || '').trim() === '') && parsedEffectDuplicates('', parsedEffect);
  }
  if (parsedEffect && typeof parsedEffect === 'object') {
    const line = parsedEffect as { effect?: unknown; reflexive?: { effect?: unknown } };
    if (parsedEffectDuplicates(existingText, line.effect)) return true;
    return Boolean(line.reflexive?.effect) && parsedEffectDuplicates(existingText, line.reflexive?.effect);
  }
  const existing = normalizeEffectForDedupe(existingText);
  const parsed = normalizeEffectForDedupe(parsedEffect);
  if (!parsed) return false;
  // A legacy entry for the same source with no effect text (structured triggers such as
  // Emperor Mihail II's optional-payment token) already covers this event.
  if (!existing) return true;
  if (existing.includes(parsed.slice(0, 24))) return true;
  return existing.length >= 8 && parsed.includes(existing.slice(0, 24));
}

/** Legacy trigger entry belongs to this source (id match, or a structured entry keyed only by card name). */
export function sameTriggerSource(existing: any, permanent: any): boolean {
  const existingId = String(existing?.permanentId || existing?.sourceId || existing?.source || '').trim();
  const permanentId = String(permanent?.id || '').trim();
  if (existingId) return existingId === permanentId;
  const existingName = String(existing?.cardName || existing?.sourceName || '').trim().toLowerCase();
  return Boolean(existingName) && existingName === String(permanent?.card?.name || '').trim().toLowerCase();
}

type ParsedTriggerSentence = { sentence: string; parsed: ReturnType<typeof parseTriggerClause> };
// Parsing is a pure function of the oracle text. Every family scan parses every
// battlefield permanent, so cache by text (mass-token boards hit the same few texts).
const PARSED_TRIGGER_SENTENCE_CACHE = new Map<string, readonly ParsedTriggerSentence[]>();
const PARSED_TRIGGER_SENTENCE_CACHE_MAX = 4096;

function parsedTriggerSentencesFor(oracleText: string, cardName?: string): readonly ParsedTriggerSentence[] {
  const cacheKey = cardName ? `${cardName}\u0001${oracleText}` : oracleText;
  const cached = PARSED_TRIGGER_SENTENCE_CACHE.get(cacheKey);
  if (cached) return cached;
  // Quoted text is an ability granted to something else (Perigee Beckoner: gains "When this
  // creature dies, ..."), never a trigger of the source itself.
  const text = stripReminderParentheticals(oracleText)
    .replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, '""');
  // One ability per line; within a line only split where a new trigger sentence starts so
  // follow-ups ("If you do, ...", "You may choose new targets ...") stay with their trigger.
  const out = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((sentence) => ({ sentence, parsed: parseTriggerClause(sentence, cardName) }));
  if (PARSED_TRIGGER_SENTENCE_CACHE.size >= PARSED_TRIGGER_SENTENCE_CACHE_MAX) PARSED_TRIGGER_SENTENCE_CACHE.clear();
  PARSED_TRIGGER_SENTENCE_CACHE.set(cacheKey, out);
  return out;
}

/** Parse-only: printed trigger lines for these events (no matching). Used to retire duplicate legacy entries. */
export function parsedEventLinesFor(
  oracleText: string,
  events: readonly TriggerConditionEvent[],
  cardName?: string,
): Array<{ effect: string; condition: any }> {
  const out: Array<{ effect: string; condition: any }> = [];
  for (const { parsed } of parsedTriggerSentencesFor(String(oracleText || ''), cardName)) {
    if (!parsed || !parsed.effect) continue;
    const event = parsed.condition.event;
    const paired = (parsed.condition as any).pairedEvent;
    if (events.includes(event) || (paired && events.includes(paired))) out.push({ effect: parsed.effect, condition: parsed.condition });
  }
  return out;
}

function effectKey(effect: string): string {
  return String(effect || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function suppressionEventFor(event: TriggerConditionEvent): TriggerEventKind {
  if (event === 'dies' || event === 'put_into_graveyard') return 'dies';
  if (event === 'leaves_battlefield') return 'ltb';
  if (event === 'sacrifices') return 'sacrifice';
  return 'other';
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
  action?: string;
  damageKind?: string;
  /** Permanent ids the triggering spell targets (heroic "spell that targets ~"). */
  targetPermanentIds?: readonly string[];
  /** Player bound to "that player" in an intervening-if clause (defaults to the active player for phase events). */
  thatPlayerId?: string;
  /** The other creature in a block (blockPartner filters fail closed without it). */
  blockPartnerPermanent?: any;
  /** Extra match context fields (attackerCount, targeting*, damageRecipient*). */
  matchContext?: Record<string, unknown>;
}): Array<{ effect: string; interveningIf?: string; condition?: import('../../../../../rules-engine/src/triggerCondition/index.js').TriggerConditionIR; reflexive?: { actor: 'you' | 'they'; effect: string; delayed?: { timing: 'next_end_step' | 'your_next_end_step'; effect: string } }; delayed?: { timing: 'next_end_step' | 'your_next_end_step'; effect: string } }> {
  const effects = [];
  // Sources that lost all abilities (Humility, Dress Down, ...) have no triggers to match;
  // dies/leaves read the last-known stamp.
  if (options.sourcePermanent && !permanentHasTriggeredAbilities(options.sourcePermanent, options.ctx?.state, { event: suppressionEventFor(options.event) })) return [];
  const seen = new Set<string>();
  const sourceCardName = String(options.sourcePermanent?.card?.name || options.sourcePermanent?.name || '').trim() || undefined;
  for (const { sentence, parsed } of parsedTriggerSentencesFor(String(options.oracleText || ''), sourceCardName)) {
    if (!parsed || !parsed.effect) continue;
    const eventMatches = parsed.condition.event === options.event || parsed.condition.pairedEvent === options.event;
    const pairedFromZone = (parsed.condition as any).pairedFromZone;
    if (eventMatches && parsed.condition.event !== options.event && pairedFromZone && String((options as any).fromZone || '').toLowerCase() !== pairedFromZone) continue;
    if (!eventMatches) continue;
    if (options.action && parsed.condition.action !== options.action
      && !String(parsed.condition.action || '').split('|').includes(options.action)) continue;
    if (parsed.interveningIf && options.ctx) {
      // Evaluate the printed sentence so the clause keeps its own header, and bind
      // "that player" / "their turn" to the active player for beginning-of-phase events
      // (same refs the legacy upkeep/draw/end-step paths pass).
      const probe = /\bif\b/i.test(sentence)
        ? sentence
        : `Whenever a permanent ${options.event}, if ${parsed.interveningIf}, ${parsed.effect}`;
      const phaseEvent = String(options.event || '').startsWith('beginning_of_') || options.event === 'each_of_your_main_phases';
      // Otherwise "that player" is the player who performed the event / controls the subject.
      const refsPlayer = options.thatPlayerId
        || (phaseEvent ? options.activePlayerId : String(options.subjectControllerId || '').trim() || undefined);
      const refs = refsPlayer
        ? { thatPlayerId: refsPlayer, referencedPlayerId: refsPlayer, theirPlayerId: refsPlayer }
        : undefined;
      try {
        if (isInterveningIfSatisfied(
          options.ctx,
          String(options.sourcePermanent?.controller || ''),
          probe,
          options.subjectPermanent,
          refs as any,
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
      permanentToTriggerMatch(options.subjectPermanent, options.subjectControllerId, options.ctx?.state),
      {
        id: String(options.sourcePermanent?.id || '').trim(),
        controllerId: String(options.sourcePermanent?.controller || '').trim(),
        attachedToId: String(options.sourcePermanent?.attachedTo || '').trim(),
        chosenCreatureType: String(options.sourcePermanent?.chosenCreatureType || '').trim() || undefined,
        saddled: Boolean(options.sourcePermanent?.saddled),
        tapped: options.sourcePermanent?.tapped === true,
      },
      {
        activePlayerId: options.activePlayerId ?? (String(options.ctx?.state?.turnPlayer || '').trim() || undefined),
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
        damageKind: options.damageKind,
        targetPermanentIds: options.targetPermanentIds,
        ...(options.matchContext || {}),
        ...(options.blockPartnerPermanent
          ? { blockPartner: permanentToTriggerMatch(options.blockPartnerPermanent, String(options.blockPartnerPermanent?.controller || ''), options.ctx?.state) }
          : {}),
        enchantedControllerId: resolveEnchantedControllerId(options.sourcePermanent, options.ctx?.state),
        exiledCardOwnerId: String(
          options.sourcePermanent?.exiledCardOwner
          || options.sourcePermanent?.linkedExileOwner
          || options.sourcePermanent?.exiledOwner
          || '',
        ).trim(),
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
