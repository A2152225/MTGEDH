// server/src/state/modules/triggers/triggeredAbilitySuppression.ts
// Origin: shared gate for every trigger-detection path (attack, ETB, dies/LTB, cast, ...).
// Answers "does this permanent currently have / may it use its triggered abilities?"
//   - Layer 6 "loses all abilities" (Humility, Turn to Frog, Darksteel Mutation,
//     Kenrith's Transformation, Lignify, Dress Down ...) via rules-engine permanentLosesAllAbilities,
//     the same data the activation lock (ABILITY_LOST) reads.
//   - Event-kind suppressors (CR 603.2g style statics): "Creatures entering [the battlefield]
//     [or dying] don't cause abilities to trigger" (Torpor Orb, Hushbringer, Hushwing Gryff,
//     Doorkeeper Thrull "Artifacts and creatures entering ...").
// Dies / LTB use last-known information: the stamp written by syncTriggeredAbilityLossStamps
// during the previous derived-effects sync, so a creature that died alongside Humility stays
// ability-less for its own dies trigger.
// Public entry symbols: permanentHasTriggeredAbilities, TriggerEventKind,
//   syncTriggeredAbilityLossStamps, findTriggerEventSuppressor, dropTriggersFromAbilitylessSources.

import { permanentKeywordLossTimestamp } from '../../../../../rules-engine/src/permanentKeywordAbilities.js';
import { GRANT_LIST_FIELDS, readAbilityGrantTimestamp } from '../../../../../rules-engine/src/abilityEffectTimestamps.js';

const TRIGGER_TEXT_RE = /^\s*(?:when|whenever|at)\b/i;

/**
 * Layer 6 in timestamp order: true when every ability is removed, except triggered abilities granted after the
 * latest "loses all abilities" effect (CR 613.7), which the permanent keeps.
 */
function permanentLosesAllAbilities(perm: any, battlefield?: readonly any[]): boolean {
  const lossTs = permanentKeywordLossTimestamp(perm, 'all abilities', battlefield);
  if (lossTs === undefined) return false;
  if (!Number.isFinite(lossTs)) return true;
  return !GRANT_LIST_FIELDS.some((field) => (Array.isArray(perm?.[field]) ? perm[field] : []).some((entry: any) => {
    const text = typeof entry === 'string' ? entry : String(entry?.text ?? entry?.ability ?? entry?.name ?? '');
    return TRIGGER_TEXT_RE.test(text) && (readAbilityGrantTimestamp(perm, text) ?? 0) > lossTs;
  }));
}

export type TriggerEventKind =
  | 'etb' | 'dies' | 'ltb' | 'attack' | 'block' | 'cast' | 'counters' | 'sacrifice'
  | 'landfall' | 'step' | 'damage' | 'draw' | 'tap' | 'life' | 'zone' | 'other';

export interface TriggerSuppressionOptions {
  /** Kind of event being checked; enables event suppressors such as Torpor Orb. */
  event?: TriggerEventKind;
  /** Object whose event causes the trigger (entering / dying permanent). Required for event suppressors. */
  eventSubject?: any;
}

/** Derived flag refreshed each sync; read for dies / LTB last-known state. */
export const ABILITY_LOSS_STAMP = 'derivedLosesAllAbilities';

const SUPPRESSOR_RE = /\b((?:artifacts?|creatures?|permanents?)(?:(?:,| and| or) (?:artifacts?|creatures?|permanents?))*) entering(?: the battlefield)?( or dying)? (?:don't|doesn't|do not) cause abilities to trigger\b/i;

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

/**
 * Per-battlefield scan cache so detector gates stay O(1) on boards without any
 * ability-loss or trigger-suppression text (mass token / Crusade perf tests).
 * Keyed on the array; refreshed when its length or last id changes.
 */
type BoardScan = { signature: string; hasLossText: boolean; hasSuppressor: boolean };
const boardScans = new WeakMap<object, BoardScan>();

function scanBoard(battlefield: any[]): BoardScan {
  const last = battlefield[battlefield.length - 1];
  const signature = `${battlefield.length}|${String(last?.id || '')}`;
  const cached = boardScans.get(battlefield);
  if (cached && cached.signature === signature) return cached;
  let hasLossText = false;
  let hasSuppressor = false;
  for (const perm of battlefield) {
    const text = oracleOf(perm);
    if (!hasLossText && /\blos(?:e|es)\b/i.test(text)) hasLossText = true;
    if (!hasSuppressor && /cause abilities to trigger/i.test(text)) hasSuppressor = true;
    if (hasLossText && hasSuppressor) break;
  }
  const scan = { signature, hasLossText, hasSuppressor };
  boardScans.set(battlefield, scan);
  return scan;
}

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\([^)]*\)/g, ' ');
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function subjectMatches(typesText: string, subject: any): boolean {
  const typeLine = typeLineOf(subject);
  if (/permanents?/i.test(typesText)) return true;
  if (/creatures?/i.test(typesText) && typeLine.includes('creature')) return true;
  return /artifacts?/i.test(typesText) && typeLine.includes('artifact');
}

/** The battlefield permanent whose static stops `event` of `subject` from causing triggers, if any. */
export function findTriggerEventSuppressor(state: any, event: TriggerEventKind, subject: any): any | null {
  if (!subject || (event !== 'etb' && event !== 'dies')) return null;
  const battlefield = battlefieldOf(state);
  if (!scanBoard(battlefield).hasSuppressor) return null;
  for (const source of battlefield) {
    if (!source?.card || source.phasedOut) continue;
    const match = oracleOf(source).match(SUPPRESSOR_RE);
    if (!match) continue;
    if (event === 'dies' && !match[2]) continue;
    if (!subjectMatches(match[1], subject)) continue;
    if (permanentLosesAllAbilities(source, battlefield)) continue;
    return source;
  }
  return null;
}

function isLastKnownEvent(event?: TriggerEventKind): boolean {
  return event === 'dies' || event === 'ltb' || event === 'sacrifice';
}

/**
 * False when `permanent` has lost all abilities (layer 6) or an event suppressor applies.
 * Call once at the top of each trigger detector. Unknown / missing permanents return true.
 */
export function permanentHasTriggeredAbilities(
  permanent: any,
  gameState?: any,
  options: TriggerSuppressionOptions = {},
): boolean {
  if (!permanent || typeof permanent !== 'object') return true;
  const zone = String(permanent.zone || '').toLowerCase();
  if (zone && zone !== 'battlefield' && !isLastKnownEvent(options.event)) return true;
  const event = options.event;
  // Event suppressors need the real event object (entering / dying permanent), not the observer.
  if (event && options.eventSubject && findTriggerEventSuppressor(gameState, event, options.eventSubject)) return false;
  if (isLastKnownEvent(event) && permanent[ABILITY_LOSS_STAMP] === true) return false;
  const battlefield = battlefieldOf(gameState);
  // No loss text on the board: only the permanent's own flags / temporary effects can remove abilities.
  if (battlefield.length > 0 && !scanBoard(battlefield).hasLossText) return !permanentLosesAllAbilities(permanent, undefined);
  if (battlefield.length === 0) return permanent[ABILITY_LOSS_STAMP] !== true
    && !permanentLosesAllAbilities(permanent, undefined);
  return !permanentLosesAllAbilities(permanent, battlefield);
}

/**
 * Post-filter for emitters that parse oracle text directly (not through a detect* gate):
 * drops triggers whose source permanent (battlefield, else `lastKnown`) has no triggered abilities.
 * Entries before `keepFirst` (e.g. delayed triggers, which aren't the permanent's abilities) are kept.
 */
export function dropTriggersFromAbilitylessSources<T>(
  triggers: T[],
  state: any,
  sourceIdOf: (trigger: T) => string,
  options: TriggerSuppressionOptions & { lastKnown?: any[]; keepFirst?: number } = {},
): T[] {
  const pool = [...battlefieldOf(state), ...(options.lastKnown || [])];
  const keepFirst = Math.max(0, options.keepFirst || 0);
  return triggers.filter((trigger, index) => {
    if (index < keepFirst) return true;
    const id = String(sourceIdOf(trigger) || '');
    const source = id ? pool.find((perm) => String(perm?.id || '') === id) : undefined;
    return !source || permanentHasTriggeredAbilities(source, state, { event: options.event });
  });
}

/** Refresh the layer-6 loss stamp on every battlefield permanent (called from derived-effects sync). */
export function syncTriggeredAbilityLossStamps(state: unknown): void {
  const battlefield = battlefieldOf(state);
  const board = scanBoard(battlefield).hasLossText ? battlefield : undefined;
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    if (permanentLosesAllAbilities(perm, board)) perm[ABILITY_LOSS_STAMP] = true;
    else if (ABILITY_LOSS_STAMP in perm) delete perm[ABILITY_LOSS_STAMP];
  }
}