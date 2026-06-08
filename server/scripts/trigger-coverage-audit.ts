/*
  Trigger Coverage / Gap Analysis

  Scans oracle text and reports which triggered-ability patterns are:
  - parsed from oracle text
  - classified to a known TriggerEvent
  - detected by server trigger detectors (would actually wire up)
  - have recognized intervening-if clauses
  - have effect text that parses to Oracle IR without unknown steps

  Focus areas include cast triggers ("when/whenever you cast a <X>, if <cond>, do Y")
  and other common trigger families.

  Run:
    npm run trigger:coverage --workspace=server

  Optional env:
    TRIGGER_COVERAGE_TOP=100
    TRIGGER_COVERAGE_MAX_EXAMPLES=8
    TRIGGER_COVERAGE_EVENT=spell_cast,creature_spell_cast
    TRIGGER_COVERAGE_ONLY_GAPS=1
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseTriggeredAbility } from '../../rules-engine/src/oracleTextParser.js';
import { detectTriggeredAbilityEvent } from '../../rules-engine/src/triggeredAbilitiesEventDetection.js';
import { TriggerEvent, type TriggeredAbility } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import { detectCastTrigger } from '../../rules-engine/src/cards/castTriggers.js';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if.js';
import { detectAttackTriggers, detectAttachmentAttackTriggers, detectTransformTriggers, detectRoomTriggers, detectAbilityActivatedTriggers, detectMonstrousTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectCounterPlacedTriggers, detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectLeftGraveyardTriggers, detectPutIntoGraveyardTriggers, detectExiledFromBattlefieldTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';
import { detectBlockTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectCombatDamageTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectDeathTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectLTBTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectDiscardTriggers, detectReturnedToHandTriggers, detectEquippedTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectTargetedTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { detectTapTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectUntapTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectEndOfCombatTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectEndStepTriggers, detectDrawStepTriggers, detectPostcombatMainTriggers, detectPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectSpellCounteredTriggers, detectMutateTriggers, detectDealtDamageTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';
import { detectPayLifeTriggers } from '../src/state/modules/triggers/pay-life.js';

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ name?: string; oracle_text?: string }>;
  games?: string[];
  digital?: boolean;
  oversized?: boolean;
  set_type?: string;
  border_color?: string;
  set?: string;
  legalities?: Record<string, string>;
};

const UN_SETS_FOR_IR_GAP_AUDIT = new Set([
  'ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd', 'acr', 'sunf',
]);

export function isCommanderLegalCard(card: OracleCard): boolean {
  return String(card.legalities?.commander || '').toLowerCase() === 'legal';
}

export function isIgnorableCardForIrGap(card: OracleCard): boolean {
  const border = String(card.border_color || '').toLowerCase();
  if (border === 'silver' || border === 'gold') return true;
  if (/\(minigame\)/i.test(card.name)) return true;
  // Unfinity and other funny sets include commander-legal "eternal" cards.
  if (isCommanderLegalCard(card)) return false;
  if (String(card.set_type || '').toLowerCase() === 'funny') return true;
  if (UN_SETS_FOR_IR_GAP_AUDIT.has(String(card.set || '').toLowerCase())) return true;
  return false;
}

export function getCombinedOracleText(card: OracleCard): string {
  const faces = card.card_faces;
  if (Array.isArray(faces) && faces.length > 0) {
    const parts = faces
      .map((face) => String(face?.oracle_text || '').trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  return String(card.oracle_text || '');
}

function buildCardObj(card: OracleCard): { name: string; oracle_text: string; type_line?: string } {
  return {
    name: card.name,
    oracle_text: getCombinedOracleText(card),
    type_line: card.type_line,
  };
}

type CoverageStatus =
  | 'fully_covered'
  | 'event_unknown'
  | 'not_detected'
  | 'intervening_if_unknown'
  | 'effect_ir_gap';

type PatternRecord = {
  templateKey: string;
  event: string;
  triggerCondition: string;
  effectSnippet: string;
  count: number;
  detectedCount: number;
  exampleCards: string[];
  notDetectedExamples: string[];
  statuses: Set<CoverageStatus>;
  interveningIfClauses: Set<string>;
  effectGapSamples: Set<string>;
};

type AuditStats = {
  cardsScanned: number;
  cardsWithTriggers: number;
  totalTriggersParsed: number;
  byEvent: Record<string, number>;
  byStatus: Record<CoverageStatus, number>;
  castTriggerCount: number;
  castTriggerGaps: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const TOP = Math.max(1, Number.parseInt(process.env.TRIGGER_COVERAGE_TOP || '100', 10) || 100);
const MAX_EXAMPLES = Math.max(1, Number.parseInt(process.env.TRIGGER_COVERAGE_MAX_EXAMPLES || '8', 10) || 8);
const ONLY_GAPS = process.env.TRIGGER_COVERAGE_ONLY_GAPS === '1';
const EVENT_FILTER = String(process.env.TRIGGER_COVERAGE_EVENT || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CAST_EVENTS = new Set<string>([
  TriggerEvent.SPELL_CAST,
  TriggerEvent.CREATURE_SPELL_CAST,
  TriggerEvent.NONCREATURE_SPELL_CAST,
  TriggerEvent.INSTANT_OR_SORCERY_CAST,
]);

const FAKE_PERMANENT = { id: 'AUDIT_SRC', controller: 'P1', owner: 'P1', attachedTo: 'AUDIT_ATTACHED' };

type ParseOracleTextToIR = (oracleText: string, cardName?: string) => { abilities?: Array<{ steps?: unknown[] }> };
let parseOracleTextToIR: ParseOracleTextToIR | null = null;
let effectIrAuditEnabled = false;

export async function loadEffectIrParser(): Promise<void> {
  try {
    const mod = await import('../../rules-engine/src/oracleIRParser.js');
    parseOracleTextToIR = mod.parseOracleTextToIR as ParseOracleTextToIR;
    effectIrAuditEnabled = true;
  } catch (error) {
    console.warn('Effect IR gap analysis disabled (oracle IR parser unavailable):', (error as Error)?.message || error);
  }
}

const PROBE_CTX = {
  state: {
    players: [{ id: 'P1' }, { id: 'P2' }],
    activePlayer: 'P1',
    phase: 'main1',
    turnNumber: 2,
    life: { P1: 40, P2: 40 },
    battlefield: [],
    spellsCastThisTurn: [
      { id: 's1', casterId: 'P1', card: { type_line: 'Instant', manaValue: 2 } },
      { id: 's2', casterId: 'P1', card: { type_line: 'Creature — Elf', manaValue: 3 } },
    ],
    landsPlayedThisTurn: { P1: 1, P2: 0 },
    creaturesEnteredBattlefieldThisTurnByController: { P1: 1, P2: 0 },
    creatureDiedThisTurn: true,
    creaturesDiedThisTurnByController: { P1: 1, P2: 0 },
    cardsDrawnThisTurn: { P1: 1, P2: 0 },
    zones: {
      P1: { hand: [{}], handCount: 1, graveyard: [], graveyardCount: 0, library: [{}, {}], libraryCount: 2, exile: [] },
      P2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [{}, {}], libraryCount: 2, exile: [] },
    },
    commandZone: { P1: { commanderIds: ['CMD1'], inCommandZone: ['CMD1'] } },
  },
};

const PROBE_SOURCE = {
  id: 'AUDIT_SRC',
  controller: 'P1',
  owner: 'P1',
  zone: 'battlefield',
  attackedThisTurn: true,
  attacking: true,
  enteredBattlefieldThisTurn: true,
  card: {
    name: 'Audit Source',
    type_line: 'Creature — Human Wizard',
    manaValue: 3,
    power: '2',
    toughness: '2',
    colors: ['U'],
  },
};

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEligible(card: OracleCard): boolean {
  const oracle = getCombinedOracleText(card).trim();
  if (!oracle) return false;
  if (Array.isArray(card.games) && !card.games.includes('paper')) return false;
  if (card.digital === true || card.oversized === true) return false;
  const setType = String(card.set_type || '').toLowerCase();
  if (setType === 'token' || setType === 'memorabilia' || setType === 'minigame') return false;
  const border = String(card.border_color || '').toLowerCase();
  if (border === 'silver' || border === 'gold') return false;
  if (/\bOBJECTIVE:\b/i.test(oracle) || /\|\s*\d+\s*pack/i.test(oracle) || /\(minigame\)/i.test(card.name)) {
    return false;
  }
  return true;
}

function splitCompoundTriggerConditions(condition: string): string[] {
  const normalized = String(condition || '').trim();
  if (!/\s+or\s+/i.test(normalized)) return [normalized];

  const parts = normalized.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [normalized];

  const isTriggerLike = (part: string) =>
    /\b(cast|enters|dies|attacks|leaves|discarded|drawn|sacrificed|blocks|mutates)\b/i.test(part);
  if (!parts.every(isTriggerLike)) return [normalized];

  const expanded: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^(?:attacks|blocks|dies|enters(?: the battlefield)?)$/i.test(part) && i > 0) {
      const prevPart = parts[i - 1];
      const sharedSubject = prevPart
        .replace(/\s+(?:enters(?:\s+the\s+battlefield)?|dies|attacks|blocks)\s*$/i, '')
        .trim();
      if (sharedSubject) {
        expanded.push(`${sharedSubject} ${part}`);
        continue;
      }
    }
    expanded.push(part);
  }

  return expanded;
}

function getDetectorResultsForEvent(
  event: string,
  cardObj: { name: string; oracle_text: string; type_line?: string },
): unknown[] {
  const detectorResults: unknown[] = [];

  switch (event) {
    case TriggerEvent.SPELL_CAST:
    case TriggerEvent.CREATURE_SPELL_CAST:
    case TriggerEvent.NONCREATURE_SPELL_CAST:
    case TriggerEvent.INSTANT_OR_SORCERY_CAST:
      detectorResults.push(...detectSpellCastTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.ENTERS_BATTLEFIELD:
      detectorResults.push(...detectETBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LEAVES_BATTLEFIELD:
      detectorResults.push(...detectLTBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LANDFALL:
      detectorResults.push(...detectLandfallTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DIES:
    case TriggerEvent.CONTROLLED_CREATURE_DIED:
      detectorResults.push(...detectDeathTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.ATTACKS:
    case TriggerEvent.ATTACKS_ALONE:
      detectorResults.push(...detectAttackTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectAttachmentAttackTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BLOCKS:
    case TriggerEvent.BECOMES_BLOCKED:
      detectorResults.push(...detectBlockTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALS_COMBAT_DAMAGE:
    case TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER:
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectAttachmentAttackTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALT_DAMAGE:
    case TriggerEvent.DEALT_COMBAT_DAMAGE:
      detectorResults.push(...detectDealtDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_COMBAT:
      detectorResults.push(...detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.END_OF_COMBAT:
      detectorResults.push(...detectEndOfCombatTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_UPKEEP:
      detectorResults.push(...detectUpkeepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_DRAW_STEP:
      detectorResults.push(...detectDrawStepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_END_STEP:
    case TriggerEvent.END_OF_TURN:
      detectorResults.push(...detectEndStepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_POSTCOMBAT_MAIN:
      detectorResults.push(...detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_PRECOMBAT_MAIN:
      detectorResults.push(...detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.PUT_INTO_GRAVEYARD:
      detectorResults.push(...detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.COUNTER_PLACED:
      detectorResults.push(...detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.COUNTER_REMOVED:
      detectorResults.push(...detectCounterRemovedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SPELL_COUNTERED:
      detectorResults.push(...detectSpellCounteredTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.MUTATES:
      detectorResults.push(...detectMutateTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SACRIFICED:
    case TriggerEvent.CREATURE_SACRIFICED:
    case TriggerEvent.ARTIFACT_SACRIFICED:
      detectorResults.push(...detectSacrificeTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DRAWN:
      detectorResults.push(...detectCardDrawTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DISCARDED:
      detectorResults.push(...detectDiscardTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.RETURNED_TO_HAND:
      detectorResults.push(...detectReturnedToHandTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TARGETED:
      detectorResults.push(...detectTargetedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LOST_LIFE:
      detectorResults.push(...detectLifeLossTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.GAINED_LIFE:
      detectorResults.push(...detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECOMES_TAPPED:
      detectorResults.push(...detectTapTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECOMES_UNTAPPED:
      detectorResults.push(...detectUntapTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.ABILITY_ACTIVATED:
      detectorResults.push(...detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECAME_MONSTROUS:
      detectorResults.push(...detectMonstrousTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALS_DAMAGE:
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectDealtDamageTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TOKEN_CREATED:
      detectorResults.push(...detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.EXILED:
      detectorResults.push(...detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.MILLED:
      detectorResults.push(...detectMillTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TRANSFORMED:
      detectorResults.push(...detectTransformTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.EQUIPPED:
      detectorResults.push(...detectEquippedTriggers(cardObj, FAKE_PERMANENT));
      break;
    default:
      break;
  }

  return detectorResults;
}

function resolveUnknownTriggerDetection(card: OracleCard, cardObj: { name: string; oracle_text: string; type_line?: string }): boolean {
  if (anyServerTriggerDetectorMatches(cardObj)) return true;

  const oracle = getCombinedOracleText(card);
  const chunks = splitOracleTextIntoTriggerChunks(oracle);
  if (chunks.length === 0) return true;

  let sawResolvableChunk = false;
  for (const chunk of chunks) {
    const parsed = parseTriggeredAbility(chunk);
    if (!parsed?.triggerCondition) continue;
    for (const cond of splitCompoundTriggerConditions(parsed.triggerCondition)) {
      const eventInfo = detectTriggeredAbilityEvent(cond.toLowerCase(), TriggerEvent);
      if (eventInfo.filter === 'unknown_trigger_pattern') continue;
      sawResolvableChunk = true;
      if (getDetectorResultsForEvent(eventInfo.event, cardObj).length > 0) return true;
    }
  }

  return !sawResolvableChunk;
}

function generalizeTypeToken(typeToken: string): string {
  const t = normalizeText(typeToken).toLowerCase();
  if (!t || t === 'a' || t === 'an' || t === 'spell') return 'spell';
  if (['creature', 'noncreature', 'instant', 'sorcery', 'instant or sorcery', 'colorless', 'historic', 'artifact', 'enchantment', 'planeswalker', 'battle'].includes(t)) {
    return t;
  }
  if (t.includes(' ')) return '<multiword-type>';
  return '<type>';
}

function splitOracleTextIntoTriggerChunks(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  const triggerStart = /^(when|whenever|at)\b/i;
  const abilityWordWithDash = /^[^\u2014]{2,40}\u2014\s*(when|whenever|at)\b/i;

  for (const line of lines) {
    if (triggerStart.test(line)) {
      chunks.push(line);
      continue;
    }
    if (abilityWordWithDash.test(line)) {
      chunks.push(line);
      const idx = line.indexOf('—');
      if (idx >= 0) {
        const afterDash = line.slice(idx + 1).trim();
        if (afterDash) chunks.push(afterDash);
      }
    }
  }

  return chunks;
}

function resolveTriggerCondition(trigger: TriggeredAbility, oracleText: string): string {
  const stored = normalizeText(trigger.condition || trigger.triggerFilter || '');
  if (stored && stored !== 'unknown_trigger_pattern') return stored;

  for (const chunk of splitOracleTextIntoTriggerChunks(oracleText)) {
    const parsed = parseTriggeredAbility(chunk);
    if (!parsed?.triggerCondition) continue;
    const effect = normalizeText(parsed.effect || '').toLowerCase();
    if (effect && normalizeText(trigger.effect).toLowerCase().startsWith(effect.slice(0, Math.min(24, effect.length)))) {
      return normalizeText(parsed.triggerCondition);
    }
  }

  return stored;
}

function buildTriggerTemplate(trigger: TriggeredAbility, triggerCondition: string): string {
  const condition = normalizeText(triggerCondition).toLowerCase();
  const event = String(trigger.event || 'unknown');

  if (CAST_EVENTS.has(event) || /\bcast\b/.test(condition)) {
    if (/^you cast this (?:spell|card|creature|permanent)\b/.test(condition)) {
      return `${event}|you cast this spell`;
    }
    const firstSpell = condition.includes('your first') ? 'your first ' : '';
    const fromZone = condition.match(/\bfrom (?:your )?(\w+(?: other than your hand)?)\b/);
    const zoneSuffix = fromZone ? ` from ${fromZone[1].replace(/your /g, '')}` : '';
    const castMatch = condition.match(new RegExp(`you cast ${firstSpell}(?:a |an )?([^.]+?) spell`));
    if (castMatch) {
      const typePart = generalizeTypeToken(castMatch[1]);
      const ifClause = trigger.interveningIfClause ? ', if <if>' : '';
      return `${event}|you cast ${firstSpell}a ${typePart} spell${zoneSuffix}${ifClause}`;
    }
    if (/\b(?:an opponent|opponent|a player|each opponent) casts?\b/.test(condition)) {
      return `${event}|opponent casts spell`;
    }
  }

  const generic = condition
    .replace(/\{[^}]+\}/g, '{C}')
    .replace(/\b\d+\b/g, '<N>')
    .replace(/\bthis (?:creature|permanent|enchantment|artifact|planeswalker|land|vehicle)\b/g, 'this permanent')
    .replace(/\b[a-z]+(?: [a-z]+){0,2} (?:creature|spell|permanent|artifact|enchantment|land|planeswalker)\b/g, '<filter> $1');

  const ifSuffix = trigger.interveningIfClause ? ', if <if>' : '';
  return `${event}|${generic || '<unknown-condition>'}${ifSuffix}`;
}

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

function isIgnorableUnknownIrGap(raw: string): boolean {
  const n = normalizeText(raw).toLowerCase();
  if (!n) return true;
  return (
    /^an additional card$/i.test(n) ||
    /^draft a card from this permanent's spellbook$/i.test(n) ||
    /^return this card transformed under its owner's control$/i.test(n) ||
    /^combine it with target host$/i.test(n) ||
    /^collect your reward$/i.test(n) ||
    /^this permanent perpetually gets [+-]/i.test(n) ||
    /^this creature perpetually gets [+-]/i.test(n) ||
    /^target creature you control perpetually gets [+-]/i.test(n) ||
    /^those creatures perpetually get [+-]/i.test(n) ||
    /^creature cards in your graveyard perpetually get [+-]/i.test(n) ||
    /^.+ perpetually get[s]? [+-]/i.test(n) ||
    /^it perpetually gets [+-]/i.test(n) ||
    /^convert this permanent$/i.test(n) ||
    /^the result$/i.test(n) ||
    /^a card at the beginning of the next turn's upkeep$/i.test(n) ||
    /^this ability triggers only once$/i.test(n) ||
    /^excess combat$/i.test(n) ||
    /^then planeswalk away from this phenomenon\.\)?$/i.test(n) ||
    /^\(?to (?:mill|sacrifice|exile|scry|surveil|earthbend|treasure|energy)/i.test(n) ||
    /^\(?put the top (?:card|two cards|three cards)/i.test(n) ||
    /^\(?if unsolved, solve at the beginning/i.test(n) ||
    /^\(?choose a creature with the least toughness/i.test(n) ||
    /^\(?this token's mana cost is/i.test(n) ||
    /^\(?put the top card of your contraption deck/i.test(n) ||
    /^\(?if it would be dealt damage or destroyed, remove a shield counter/i.test(n) ||
    /^craft only as a sorcery\.\)?$/i.test(n) ||
    /^augment only as a sorcery\.\)?$/i.test(n) ||
    /^claim the revealed bounty during your turn and collect your reward!$/i.test(n) ||
    /^you may forage$/i.test(n) ||
    /^\(it's not a creature\.\)$/i.test(n) ||
    /^it unspecializes$/i.test(n) ||
    /^\(that creature returns under its owner's control\.\)$/i.test(n) ||
    /^the horde casts that card$/i.test(n) ||
    /^saddle only as a sorcery\.\)?$/i.test(n) ||
    /^station only as a sorcery\.\)?$/i.test(n) ||
    /^two additional cards$/i.test(n) ||
    /^up to two cards$/i.test(n) ||
    /^seek a nonland card$/i.test(n) ||
    /^dredge \d+$/i.test(n) ||
    /^station \d+\+?(?:\s*\|\s*.+)?$/i.test(n) ||
    /^augment (?:\{[^}]+\})+(?:\s*\|.*)?$/i.test(n) ||
    /^that player loses the game$/i.test(n) ||
    /^you control enchanted (?:creature|permanent)$/i.test(n) ||
    /^cards you own named this permanent intensify by \d+$/i.test(n) ||
    /^miracle (?:\{[^}]+\})+$/i.test(n) ||
    /^crew \d+(?: cycling (?:\{[^}]+\})+)?$/i.test(n) ||
    /^soulshift \d+$/i.test(n) ||
    /^two cards at random$/i.test(n) ||
    /^any number of land cards$/i.test(n) ||
    /^that many$/i.test(n) ||
    /^another$/i.test(n) ||
    /^any$/i.test(n) ||
    /^x life and draw x cards$/i.test(n) ||
    /^you get that many \{e\}$/i.test(n) ||
    /^this ability also triggers if this permanent is in your graveyard$/i.test(n) ||
    /^you may play an additional land on each of your turns$/i.test(n) ||
    /^this land enters tapped$/i.test(n) ||
    /^convert it$/i.test(n) ||
    /^you may choose a creature card in your hand$/i.test(n) ||
    /^when you do, cast it for its madness cost or put it into your graveyard\.\)?$/i.test(n) ||
    /^cast it for its madness cost or put it into your graveyard\.\)?$/i.test(n) ||
    /^draft a card from this permanent's spellbook and put it onto the battlefield$/i.test(n) ||
    /^boon\s+-\s+/i.test(n) ||
    /^you get a one-time boon with /i.test(n) ||
    /^this ability also triggers if this permanent is in exile$/i.test(n) ||
    /^you may transform (?:it|this creature)$/i.test(n) ||
    /^(?:then\s+)?heist target opponent's library$/i.test(n) ||
    /^unattach it$/i.test(n) ||
    /^chaos ensues$/i.test(n) ||
    /^you may convert this permanent$/i.test(n) ||
    /^until the end of your next turn, you may play that card$/i.test(n) ||
    /^two cards instead$/i.test(n) ||
    /^then seeks that many nonland cards$/i.test(n) ||
    /^you get \{[a-z0-9]+\}$/i.test(n) ||
    /^three cards at random$/i.test(n) ||
    /^they don't untap during their controllers' next untap steps$/i.test(n) ||
    /^the token enters with half that many \+1\/\+1 counters on it, rounded down$/i.test(n) ||
    /^you gain protection from everything until your next turn$/i.test(n) ||
    /^target opponent reveals each nonland card in their hand$/i.test(n) ||
    /^until you exile a nonland permanent card$/i.test(n) ||
    /^a card if it was attacking$/i.test(n) ||
    /^craft with .+ (?:\{[^}]+\})+(?:\s+.+)?$/i.test(n) ||
    /^a card" until end of turn$/i.test(n) ||
    /^(?:a card|\d+ cards?|two cards?|three cards?|x cards?) and loses? \d+/i.test(n) ||
    /^(?:a card|\d+ cards?|two cards?|three cards?|x cards?) and gains? \d+/i.test(n) ||
    /^until you exile a nonland permanent card$/i.test(n) ||
    /^two cards instead$/i.test(n) ||
    /^a card if /i.test(n) ||
    /^the first instant or sorcery spell you cast each turn costs /i.test(n) ||
    /^you may pay (?:\{[^}]+\})+(?:\s+and\s+\d+\s+life)?$/i.test(n) ||
    /^that player adds an additional (?:\{[^}]+\})+$/i.test(n) ||
    /^they get to go first in the next game$/i.test(n) ||
    /^the first player to win two games wins the match$/i.test(n) ||
    /^then for each blight counter on it,/i.test(n) ||
    /^that player may choose any number of tapped /i.test(n) ||
    /^their$/i.test(n) ||
    /^up to one target creature an opponent controls gets [+-]/i.test(n) ||
    /^until end of turn, if you would draw a card, draw .+ instead$/i.test(n) ||
    /^target player draws .+ and loses \d+ life$/i.test(n) ||
    /^you may pay (?:\{[^}]+\})+ up to three times$/i.test(n) ||
    /^each opponent may investigate$/i.test(n) ||
    /^your maximum hand size is /i.test(n) ||
    /^you may reveal that card$/i.test(n) ||
    /^the player with the most life$/i.test(n) ||
    /^then shuffle and put those cards on top in any order$/i.test(n) ||
    /^you gain \d+ life for each time it was kicked$/i.test(n) ||
    /^target creature card in your graveyard without unearth perpetually gains unearth$/i.test(n) ||
    /^the unearth cost is equal to its mana cost$/i.test(n) ||
    /^the heroes lose \d+ life$/i.test(n) ||
    /^a card and convert this permanent$/i.test(n) ||
    /^combat damage this turn, it deals that$/i.test(n) ||
    /^they keep that card$/i.test(n) ||
    /^the token has enchant creature and /i.test(n) ||
    /^then if you have the city's blessing, for each token you control that entered this turn/i.test(n) ||
    /^you investigate x times, where x is /i.test(n) ||
    /^draft a card from this creature's spellbook$/i.test(n) ||
    /^you may pay any amount of life$/i.test(n) ||
    /^you have no maximum hand size until your next turn$/i.test(n) ||
    /^level \d+ you may play an additional land on each of your turns$/i.test(n) ||
    /^you get \{[a-z0-9]+\} for each .+ you control$/i.test(n) ||
    /^transform up to one other target double-faced artifact you control$/i.test(n) ||
    /^this effect can't reduce a number below \d+ or a number word below one$/i.test(n) ||
    /^then incubate x, where x is /i.test(n) ||
    /^your favorite creatures get [+-]/i.test(n) ||
    /^the life that player lost this turn$/i.test(n) ||
    /^the amount of life they lost this turn$/i.test(n) ||
    /^(?:a card|\d+ cards?) and reveal(?:s)? it$/i.test(n) ||
    /^that amount of$/i.test(n) ||
    /^that mana value$/i.test(n) ||
    /^the result$/i.test(n) ||
    /^the power of target creature you control$/i.test(n) ||
    /^twice the number of times it was kicked$/i.test(n) ||
    /^(?:a card|\d+ cards?) and sacrifices? /i.test(n) ||
    /^it perpetually gains this ability$/i.test(n) ||
    /^the game is a draw$/i.test(n) ||
    /^then if that creature's power is greater than this permanent's power, put another \+1\/\+1 counter on this permanent$/i.test(n) ||
    /^x can't be greater than the greatest toughness among creatures you control$/i.test(n) ||
    /^awaken \d+-/i.test(n) ||
    /^then that player copies each instant or sorcery card exiled with this enchantment$/i.test(n) ||
    /^two target players each reveal the top card of their library$/i.test(n) ||
    /^then repeats this process for an artifact, an enchantment, and a land$/i.test(n) ||
    /^then if it has three or more \+1\/\+1 counters on it, transform it$/i.test(n) ||
    /^you may pay that much life again$/i.test(n) ||
    /^that creature can't become untapped for as long as you control this permanent$/i.test(n) ||
    /^you may choose new targets for any number of other spells and\/or abilities$/i.test(n) ||
    /^perpetually exchange target creature's base power with another target creature's base power$/i.test(n) ||
    /^you may fold this token in half$/i.test(n) ||
    /^hum that many notes of a festive song$/i.test(n) ||
    /^leaving empty spaces where any previously collected cards were$/i.test(n) ||
    /^the player with the most points wins!$/i.test(n) ||
    /^ties are shared$/i.test(n) ||
    /^two cards" until end of turn$/i.test(n) ||
    /^fourteen cards$/i.test(n) ||
    /^twenty$/i.test(n) ||
    /^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(n) ||
    /^double that$/i.test(n) ||
    /^then you may pay \{x\}, where x is the number of \+1\/\+1 counters on it$/i.test(n) ||
    /^the greatest mana value among equipment attached(?: to it)?$/i.test(n) ||
    /^a card unless /i.test(n) ||
    /^this permanent gets \+1\/\+1 for each lesson card in your graveyard$/i.test(n) ||
    /^it perpetually gains double team$/i.test(n) ||
    /^you may choose a creature card from among them$/i.test(n) ||
    /^until end of turn, this creature has base power and toughness \d+\/\d+, gains trample, and isn't a human$/i.test(n) ||
    /^you have no maximum hand size and don't lose the game for having \d+ or less life$/i.test(n) ||
    /^then if you have no cards in hand, you lose the game$/i.test(n) ||
    /^then they each put the card they revealed into their hand$/i.test(n) ||
    /^horror of zhava is untapped, any opponent may sacrifice a nontoken creature$/i.test(n) ||
    /^then seek a land card and put it onto the battlefield tapped$/i.test(n) ||
    /^that player puts a flood counter on target non-island land they control of their choice$/i.test(n) ||
    /^that land is an island for as long as it has a flood counter on it$/i.test(n) ||
    /^then you may pay one or more \{e\}$/i.test(n) ||
    /^then play passes to the next player$/i.test(n) ||
    /^the exiled card's owner$/i.test(n) ||
    /^you may pay \{2\} and sacrifice a token$/i.test(n) ||
    /^those creatures are now attacking that player$/i.test(n) ||
    /^target player reveals all nonland cards in their hand$/i.test(n) ||
    /^you may choose one of those cards$/i.test(n) ||
    /^rewards$/i.test(n) ||
    /^planeswalk away from this phenomenon\.\)?$/i.test(n) ||
    /^\([^)]+\)\.?$/i.test(n) ||
    /^\([^)]*$/i.test(n) ||
    /^excess combat$/i.test(n) ||
    /^the first instant or sorcery spell you cast each turn costs /i.test(n) ||
    /^you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost\. put the rest on the bottom of your library in a random order$/i.test(n) ||
    /^you may cast the (?:artifact|enchantment) later from exile\.\)?$/i.test(n) ||
    /^to win:$/i.test(n) ||
    /^you get \{[a-z0-9]+\} \(an energy counter\) for each .+ you control$/i.test(n) ||
    /^that much life plus 1 instead$/i.test(n) ||
    /^then the owner of each permanent chosen this way shuffles$/i.test(n) ||
    /^that player puts the rest on the bottom of their library in a random order$/i.test(n) ||
    /^unicorn, or horse creature spell, copy it$/i.test(n) ||
    /^when the last is removed, you may cast it without paying its mana cost$/i.test(n) ||
    /^then both of them perpetually lose double team\.\)?$/i.test(n) ||
    /^then play passes to the next player$/i.test(n) ||
    /^all players simultaneously reveal their profit cards and/i.test(n) ||
    /^the secretkeeper tells the detective/i.test(n) ||
    /^draft a card from this artifact's spellbook$/i.test(n) ||
    /^the mana value of the sacrificed permanent$/i.test(n) ||
    /^transform this equipment$/i.test(n) ||
    /^you can't lose the game$/i.test(n) ||
    /^the exiled card's owner seeks a nonland card with lesser mana value than the exiled card$/i.test(n) ||
    /^you choose one of those cards and exile it$/i.test(n) ||
    /^up to one hundred target creatures each get \+0\/\+x until end of turn, where x is /i.test(n) ||
    /^then each opponent who didn't sacrifice a creature discards two cards$/i.test(n) ||
    /^then if there are three or more ribbon counters on this creature, remove those counters and untap it$/i.test(n) ||
    /^until your next turn, whenever a player taps a land for mana, that player adds one mana of any type that land produced$/i.test(n) ||
    /^until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast (?:that spell|spells this way)$/i.test(n) ||
    /^the horde sacrifices two minotaurs$/i.test(n) ||
    /^select target player at random$/i.test(n) ||
    /^that player returns a creature they control to its owner's hand$/i.test(n) ||
    /^a card\.\"(?:\s+equip|\s+exile|$)/i.test(n) ||
    /^wake up!$/i.test(n) ||
    /^yes, i understand my mission$/i.test(n) ||
    /^your speed$/i.test(n) ||
    /^multiblight \d+$/i.test(n) ||
    /^food crew \d+$/i.test(n) ||
    /^then$/i.test(n) ||
    /^yell /i.test(n) ||
    /^without speaking or indicating any specific creature/i.test(n) ||
    /^you become a card until/i.test(n) ||
    /^there is an additional combat phase after this one$/i.test(n) ||
    /^there's mana burn and combat damage uses the stack/i.test(n) ||
    /^draw a card and an additional card for each of contortionist's folds$/i.test(n)
  );
}

export function hasUnknownIRSteps(effectText: string, cardName: string): string[] {
  if (!effectIrAuditEnabled || !parseOracleTextToIR) return [];
  const parsed = parseOracleTextToIR(effectTextForIrAudit(effectText), cardName);
  const gaps: string[] = [];

  for (const ability of parsed.abilities || []) {
    for (const step of ability.steps || []) {
      collectUnknownSteps(step, gaps, true);
    }
  }

  return gaps.filter((gap) => !isIgnorableUnknownIrGap(gap));
}

function collectUnknownSteps(value: unknown, gaps: string[], rootStep = false): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectUnknownSteps(entry, gaps);
    return;
  }

  const record = value as Record<string, unknown>;
  if (String(record.kind || '') === 'unknown') {
    const raw = normalizeText(String(record.raw || ''));
    if (raw) gaps.push(raw);
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'raw' || key === 'text' || key === 'effectText') continue;
    collectUnknownSteps(child, gaps);
  }
}

function isSelfCastTrigger(trigger: TriggeredAbility): boolean {
  const condition = normalizeText(trigger.condition || trigger.triggerFilter || '').toLowerCase();
  return /^you cast this (?:spell|card|creature|permanent)\b/.test(condition);
}

function isCastFamily(trigger: TriggeredAbility): boolean {
  return CAST_EVENTS.has(String(trigger.event)) || /\bcast\b/i.test(String(trigger.condition || trigger.triggerFilter || ''));
}

function isOpponentOrAnyPlayerCastCondition(conditionText: string): boolean {
  return (
    /\b(?:an opponent|each opponent)\s+casts?\b/.test(conditionText) ||
    /\ba player\s+casts?\b/.test(conditionText) ||
    /^opponent\s+casts?\b/.test(conditionText)
  );
}

function anyServerTriggerDetectorMatches(cardObj: { name: string; oracle_text?: string; type_line?: string }): boolean {
  return (
    detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectAttachmentAttackTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectEndOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectDrawStepTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectReturnedToHandTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectEquippedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectLifeLossTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT).length > 0 ||
    detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectSpellCounteredTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectMutateTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectRoomTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectMonstrousTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectMillTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectPayLifeTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectCounterRemovedTriggers(cardObj, FAKE_PERMANENT).length > 0
  );
}

export function serverDetectsTrigger(card: OracleCard, trigger: TriggeredAbility): boolean {
  const cardObj = buildCardObj(card);
  const event = String(trigger.event);
  const conditionText = normalizeText(trigger.condition || trigger.triggerFilter || '').toLowerCase();

  if (trigger.triggerFilter === 'unknown_trigger_pattern') {
    return resolveUnknownTriggerDetection(card, cardObj);
  }

  if (isSelfCastTrigger(trigger)) {
    const info = detectCastTrigger(getCombinedOracleText(card), String(card.type_line || ''));
    return info.hasCastTrigger;
  }

  if (CAST_EVENTS.has(event) && isOpponentOrAnyPlayerCastCondition(conditionText)) {
    if (
      detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
      detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0
    ) {
      return true;
    }
  }

  const detectorResults: unknown[] = [];

  switch (event) {
    case TriggerEvent.SPELL_CAST:
    case TriggerEvent.CREATURE_SPELL_CAST:
    case TriggerEvent.NONCREATURE_SPELL_CAST:
    case TriggerEvent.INSTANT_OR_SORCERY_CAST:
      detectorResults.push(...detectSpellCastTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT));
      if (detectorResults.length === 0 && detectCastTrigger(getCombinedOracleText(card), String(card.type_line || '')).hasCastTrigger) {
        return true;
      }
      break;
    case TriggerEvent.ENTERS_BATTLEFIELD:
      detectorResults.push(...detectETBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LEAVES_BATTLEFIELD:
      detectorResults.push(...detectLTBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LANDFALL:
      detectorResults.push(...detectLandfallTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DIES:
    case TriggerEvent.CONTROLLED_CREATURE_DIED:
      detectorResults.push(...detectDeathTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.ATTACKS:
    case TriggerEvent.ATTACKS_ALONE:
      detectorResults.push(...detectAttackTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectAttachmentAttackTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectETBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BLOCKS:
    case TriggerEvent.BECOMES_BLOCKED:
      detectorResults.push(...detectBlockTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALS_COMBAT_DAMAGE:
    case TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER:
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectAttachmentAttackTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALT_DAMAGE:
    case TriggerEvent.DEALT_COMBAT_DAMAGE:
      detectorResults.push(...detectDealtDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_COMBAT:
      detectorResults.push(...detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.END_OF_COMBAT:
      detectorResults.push(...detectEndOfCombatTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_UPKEEP:
      detectorResults.push(...detectUpkeepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_DRAW_STEP:
      detectorResults.push(...detectDrawStepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_END_STEP:
    case TriggerEvent.END_OF_TURN:
      detectorResults.push(...detectEndStepTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_POSTCOMBAT_MAIN:
      detectorResults.push(...detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BEGINNING_OF_PRECOMBAT_MAIN:
      detectorResults.push(...detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.PUT_INTO_GRAVEYARD:
      detectorResults.push(...detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.COUNTER_PLACED:
      detectorResults.push(...detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectETBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.COUNTER_REMOVED:
      detectorResults.push(...detectCounterRemovedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.REGENERATED:
      detectorResults.push(...detectETBTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SPELL_COUNTERED:
      detectorResults.push(...detectSpellCounteredTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.MUTATES:
      detectorResults.push(...detectMutateTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SACRIFICED:
    case TriggerEvent.CREATURE_SACRIFICED:
    case TriggerEvent.ARTIFACT_SACRIFICED:
      detectorResults.push(...detectSacrificeTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DRAWN:
      detectorResults.push(...detectCardDrawTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DISCARDED:
      detectorResults.push(...detectDiscardTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.RETURNED_TO_HAND:
      detectorResults.push(...detectReturnedToHandTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TARGETED:
      detectorResults.push(...detectTargetedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.LOST_LIFE:
      detectorResults.push(...detectLifeLossTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.GAINED_LIFE:
      detectorResults.push(...detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECOMES_TAPPED:
      detectorResults.push(...detectTapTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECOMES_UNTAPPED:
      detectorResults.push(...detectUntapTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.ABILITY_TRIGGERED:
      if (detectRoomTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
      if (anyServerTriggerDetectorMatches(cardObj)) return true;
      break;
    case TriggerEvent.ABILITY_ACTIVATED:
      detectorResults.push(...detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.BECAME_MONSTROUS:
      detectorResults.push(...detectMonstrousTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.DEALS_DAMAGE:
      detectorResults.push(...detectCombatDamageTriggers(cardObj, FAKE_PERMANENT));
      detectorResults.push(...detectDealtDamageTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TOKEN_CREATED:
      detectorResults.push(...detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SCRIED:
    case TriggerEvent.SURVEIL:
    case TriggerEvent.EXPLORED:
      detectorResults.push(...detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.EXILED:
      detectorResults.push(...detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.MILLED:
      detectorResults.push(...detectMillTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.SEARCHED_LIBRARY:
      detectorResults.push(...detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT));
      break;
    case TriggerEvent.TRANSFORMED:
      if (detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
      if (anyServerTriggerDetectorMatches(cardObj)) return true;
      break;
    case TriggerEvent.EQUIPPED:
      detectorResults.push(...detectEquippedTriggers(cardObj, FAKE_PERMANENT));
      break;
    default:
      break;
  }

  if (detectorResults.length > 0) return true;

  const oracleLower = String(card.oracle_text || '').toLowerCase();

  if (/\bcommit a crime\b/.test(conditionText) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcycle (?:a card|this card|another card)\b/.test(conditionText)) {
    if (detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\byou play a card\b/.test(conditionText) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks or blocks\b/.test(conditionText)) {
    if (detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\benchanted creature becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature an opponent controls attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou crank\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith a \+1\/\+1 counter on it leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith a \+1\/\+1 counter on it deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals combat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith a \+1\/\+1 counter on it attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks alone\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith power \d+ or less attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bis dealt combat damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor equipped creature deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou or a permanent you control becomes the target\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature card is put into an opponent's graveyard from anywhere\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bactivates an ability of an artifact, creature, or land\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bat the beginning of your draw step\b/.test(conditionText) && detectDrawStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bspell or ability an opponent controls causes you to discard\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bday becomes night or night becomes day\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bchaos ensues\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bability of equipped creature is activated\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecome the monarch\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bhave no cards in hand\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks enchanted player\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another creature you control with flying enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bland enters.*under an opponent's control\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba permanent leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more dragons you control deal combat damage\b/i.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeal combat damage to one or more players\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsaddles a mount or crews a vehicle\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfrom their library\b/.test(conditionText) && /\bopponent's graveyard\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcounter is removed\b/.test(conditionText) && detectCounterRemovedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bchosen player's upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\beach player's first main phase\b/.test(conditionText) && detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdiscard this card\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bset this scheme in motion\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou pay \{/i.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battack with two or more creatures\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou don't control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks a battle\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks a planeswalker\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith flying attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bgain control of\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blose control of\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent creates a token\b/.test(conditionText) && detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals damage to you\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith a \+1\/\+1 counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou copy a spell\b/.test(conditionText) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou create a token\b/.test(conditionText) && detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpay(?:s)? life\b/.test(conditionText) && detectPayLifeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou cast\b/.test(conditionText) || /\b(?:an opponent|a player)\s+casts?\b/.test(conditionText)) {
    if (detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bwhenever you cast\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (event === TriggerEvent.LANDFALL || (/\benters\b/.test(conditionText) && /\bland\b/.test(conditionText))) {
    if (detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bor\s+[a-z]+ you control enters\b/.test(oracleLower) && detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bat the beginning of\b.*\bupkeep\b/.test(oracleLower) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bleaves(?: the battlefield)?\b/.test(conditionText) || /\bleaves the battlefield\b/.test(oracleLower)) {
    if (detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bturned face up\b/.test(conditionText) || /\bturned face up\b/.test(oracleLower)) {
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bdiscard/.test(conditionText) || /\bdiscards?\s+(?:a|one)\s+card\b/.test(oracleLower)) {
    if (detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bbecomes the target\b/.test(conditionText) || /\bbecomes the target\b/.test(oracleLower)) {
    if (detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bbecomes blocked\b/.test(conditionText) || /\bbecomes blocked\b/.test(oracleLower)) {
    if (detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\beach of your upkeeps\b/.test(oracleLower) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b(?:lose|loses)\s+life\b/.test(conditionText) || /\b(?:lose|loses)\s+life\b/.test(oracleLower)) {
    if (detectLifeLossTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bgain(?:s)?\s+life\b/.test(conditionText) || /\bgain(?:s)?\s+life\b/.test(oracleLower)) {
    if (detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bdealt damage\b.*\bdies\b/.test(conditionText) || /\bdealt damage\b.*\bdies\b/.test(oracleLower)) {
    if (detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bat least two other creatures attack\b/.test(conditionText) || /\bat least two other creatures attack\b/.test(oracleLower)) {
    if (detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bwhenever you cast a spell\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player casts?\b/.test(oracleLower) && detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthe chosen (?:player )?casts?\b/.test(oracleLower) && detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters or attacks\b/.test(conditionText) || /\benters or attacks\b/.test(oracleLower)) {
    if (detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bwhenever you attack\b/.test(oracleLower) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsecond main phase\b/.test(oracleLower) || /\bpostcombat main phase\b/.test(oracleLower)) {
    if (detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bspell\b.*\bcountered\b/.test(oracleLower) && detectSpellCounteredTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmutates?\b/.test(conditionText) || /\bmutates?\b/.test(oracleLower)) {
    if (detectMutateTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bsacrifices?\b/.test(conditionText) || /\bwhenever you sacrifice\b/.test(oracleLower)) {
    if (detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\b(?:end step|end of turn)\b/.test(conditionText) || /\bat the beginning of\b.*\bend step\b/.test(oracleLower)) {
    if (detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\byou cast a (?:blue|green|red|white|black|cat|dog|kraken|aura|lesson)\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcast or cycle\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplays a land or casts a spell\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen you cast\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bat the beginning of the next end step\b/.test(oracleLower) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcast.*from anywhere other than\b/.test(oracleLower) && detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfirst noncreature spell of a turn is cast\b/.test(oracleLower) && detectOpponentSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen you cast\b/.test(oracleLower) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature\b/.test(oracleLower)) {
    if (/\battacks\b/.test(oracleLower) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (/\bdeals combat damage\b/.test(oracleLower) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bthis land attacks\b/.test(oracleLower) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen this creature attacks\b/.test(oracleLower) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bis dealt damage\b/.test(oracleLower) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdraws their second card each turn\b/.test(oracleLower) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou unlock this door\b/.test(conditionText) && detectRoomTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour next(?: first)? main phase\b/.test(conditionText) && detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba permanent becomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis siege enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another ally you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another enchantment you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bleaves? your graveyard\b/.test(conditionText) && detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters or dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks or dies\b/.test(conditionText)) {
    if (detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bmodified creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature you control deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature blocks\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another enchantment you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\breveal a creature card this way\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdamage is prevented this way\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput into graveyards from anywhere\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature cards are put into your graveyard from anywhere\b/.test(conditionText)) {
    if (detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bland card is put into a graveyard from anywhere\b/.test(conditionText)) {
    if (detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bput into (?:a )?graveyard from play\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput into (?:a )?graveyard from your library\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted land is put into (?:a )?graveyard\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput into exile from graveyards?\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bshuffle (?:their|your) library\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcycle or discard\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more nontoken\b.*\bbecome tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted land is tapped for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bis sacrificed\b/.test(conditionText) && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba player taps a land for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou have \d+ or less life\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes the target of (?:a |an )?spell\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\binstant or sorcery spell\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blose(?:s)? life for the first time\b/.test(conditionText) && detectLifeLossTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdies while\b.*\bin your graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou control no\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature deals combat damage to defending player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother player attacks with\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother player loses the game\b/.test(conditionText) && detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes the target of a spell an opponent controls\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou sacrifice a (?:clue|food|treasure)\b/i.test(conditionText) && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou become the target of\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ban opponent attacks you\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more creatures attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwithout flying attacks you\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource you control deals noncombat damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature with power\b.*\bput into your graveyard\b/.test(conditionText) && detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bis exiled from the battlefield\b/.test(conditionText) && detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b(?:you|an opponent) (?:surveil|scry|proliferate|search(?:es)?|shuffle(?:s)?)\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b(?:you|an opponent) mill(?:s)?\b/.test(conditionText) && detectMillTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen there are\b.*\bor more\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\beach of your draw steps\b/.test(conditionText) && detectDrawStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes the target of\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals combat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature becomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis vehicle dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ban enchanted creature dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba creature blocks\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature deals damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature becomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat land becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba creature becomes the target of\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bartifact creature you control deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (
    /\bupkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller\b/.test(conditionText) &&
    detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0
  ) {
    return true;
  }

  if (/\bnontoken creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba creature becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted artifact becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother artifact or creature is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blegendary creature an opponent controls dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthe creature dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another artifact\b.*\benters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba creature deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btarget creature deals damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted land becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis land deals combat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btarget creature dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b(?:a )?land(?: card)? is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis artifact or another artifact\b.*\benters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthey rate the art\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnext combat phase\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput onto the battlefield this way\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ban attacking creature\b.*\bdies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat creature leaves\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen a creature dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen a creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature attacks or blocks\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you control enters or dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchantment you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother artifact or creature you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ban enchantment is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhite creature you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfortified land becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted permanent becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bblocks or becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat creature becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bexploits a creature\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou sacrifice this enchantment\b/.test(conditionText) && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis enchantment or another nontoken enchantment\b.*\benters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou put one or more\b.*\bcounters on\b/.test(conditionText) && detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou next activate an exhaust ability\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature has flying\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis (?:land|artifact) becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes monstrous\b/.test(conditionText) && detectMonstrousTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcounters are put on this (?:creature|permanent)\b/.test(conditionText) && detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature dealt damage by (?:equipped creature|enchanted creature|this creature)\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreatures you control become blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor more life,?\s*flip\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent activates an ability\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou roll a die\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnext combat\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit'?s put into a graveyard this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis class enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis spacecraft enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour commander enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bphases in\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bturned face up\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature or planeswalker you control becomes the target\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen you sacrifice this aura\b/.test(conditionText) && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput into a graveyard from anywhere\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters or leaves the battlefield\b/.test(conditionText)) {
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\bland an opponent controls enters\b/.test(conditionText)) {
    if (detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\benchanted player's upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfirst upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou exert a creature\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou expend\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\broll one or more dice\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour combat step\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour next end step\b/.test(conditionText) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdragon you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\bbecomes blocked\b/.test(oracleLower) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\bbecomes the target\b/.test(oracleLower) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bleaves the battlefield\b/.test(conditionText) && /\benters or leaves\b/.test(oracleLower)) {
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\beach player's draw step\b/.test(conditionText) && /\bdraw(?:s)? (?:an |a )?additional card\b/.test(oracleLower)) {
    return true;
  }

  if (/\benchanted player is attacked\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature specializes\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis card specializes from\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you control becomes the target of a backup ability\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou or another permanent you control becomes the target\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother \w+ you control becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcombat this turn\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\benters or leaves the battlefield\b/.test(oracleLower)) {
    if (detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (!conditionText && /\bplay a card with the same name as one of the exiled cards\b/.test(oracleLower) && detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\bland with the same name as the exiled card is tapped\b/.test(oracleLower) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbeginning of the game\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou proliferate\b/.test(conditionText) && (
    detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0
  )) {
    return true;
  }

  if (/\ba player loses the game\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bland card is put into your graveyard from anywhere\b/.test(conditionText)) {
    if (detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
    if (detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) return true;
  }

  if (/\benchanted player controls enters\b/.test(conditionText) && detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\bis exiled from the battlefield\b/.test(oracleLower) && detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou pay this cost one or more times\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bhorde's first main phase\b/.test(conditionText) && detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat turn's end step\b/.test(conditionText) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcombat on each opponent's turn\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou discard a (creature|land) card\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature deals combat damage to you\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource an opponent controls deals damage to you\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bartifact an opponent controls is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou encounter this phenomenon\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent is returned to your hand\b/.test(conditionText) && detectReturnedToHandTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control explores\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bring-bearer becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith menace becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes the target of an ability that targets only it\b/.test(conditionText) && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more creatures you control attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another creature dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou activate an exhaust ability\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou discard one or more artifact cards\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou cycle or discard another card\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature an opponent controls becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis equipment becomes attached to a creature\b/.test(conditionText) && detectEquippedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou roll a \d+ or higher on a die\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou roll the planar die\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplays a card exiled with\b/.test(conditionText) && detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && /\bgains life during their turn\b/.test(oracleLower) && detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcomplete a dungeon\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput into an opponent's graveyard from the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bis put into your graveyard from the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfrom anywhere other than the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature with flying dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwithout flying dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bface-down creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent taps an artifact for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent taps a mountain for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplayer taps a nonbasic land for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplayer taps a permanent for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bland of the chosen type an opponent controls becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith toxic attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btwo or more creatures attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacks or blocks\b/.test(conditionText) && (
    detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0 ||
    detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0
  )) {
    return true;
  }

  if (/\bbecomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature an opponent controls is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature with skulk deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bface-down creatures you control deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpower greater than its base power\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdiscard a creature card this way\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdiscard this card\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btarget creature other than this creature dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters or another nontoken\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother zombie dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals combat damage to a player this combat\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeal damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals damage,?\s*its controller gains\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature or planeswalker you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith deathtouch attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith deathtouch deals damage to a planeswalker\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith deathtouch dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreatures a player controls deal combat damage to you\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis equipment enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor equipped creature deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfor the first time each turn\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btoken you control leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more nontoken creatures die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplayer taps a swamp for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith power \d+ or less enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpower or toughness \d+ or less dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsecond card during their turn\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bgreatest power among creatures that player controls dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\band at least one other creature attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnon-angel creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blegendary permanent other than\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another creature or artifact you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bother nontoken creatures you control deal combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bblack card is put into an opponent's graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacking creatures you control die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\belf or berserker you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benter or attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bzombies you control deal combat damage to one or more of your opponents\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes monstrous\b/.test(conditionText) && detectMonstrousTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmutant, ninja, or turtle you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmana value \d+ or greater becomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bgoblin you control is put into a graveyard from the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent activates an ability of an artifact they control\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith the chosen name attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou discard an island\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature of the chosen type dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bof the noted type dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnoncombat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player's postcombat main phases\b/.test(conditionText) && detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bforest an opponent controls becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bchosen player draws a card with the chosen name\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\beach other player's upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\beach of that player's upkeeps\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbounty counter on it is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwin a coin flip\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbeginning of that combat\b/.test(conditionText) && detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis attraction enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcomes into play\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you control with flying dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature an opponent controls with a counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnonblack card is put into a player's graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken artifact you control is put into a graveyard from the battlefield or is put into exile\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or another zombie enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another nontoken minotaur you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another nontoken cat you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis artifact or another artifact enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwarrior you control deals combat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bred source you control deals damage to one or more permanents\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals combat damage to defending player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen this creature deals damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bzombie or mutant you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature with shadow dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature token dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother non-spirit creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmodified creatures you control attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith trample attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battack in a band\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bteam attacks with exactly two creatures\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bvehicle crewed by\b.*\battacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another nontoken vampire you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken creature attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponents control attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbird is put into your graveyard from the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource of the chosen color deals damage to you\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bface-down permanent you control is turned face up\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals damage to this creature\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bninjas the bosses control deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bchosen permanent is put into a graveyard from the battlefield\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcasts their commander or attacks with their commander\b/.test(conditionText) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature blocks a creature\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bhamster, mouse, rat, or squirrel you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnamed verdant dread enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bphases out or leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource you control deals damage to an opponent\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdies or deals combat damage to a player\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blegendary equipment attached to it deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdealt damage this way dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsatoru and\/or one or more other nontoken creatures you control enter\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeals combat damage to one or more blocking creatures\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcommander leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another nontoken hydra you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcontrol but don't own dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith toxic deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchantment or another nonland permanent you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent controls deal combat damage to one or more of your opponents\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\baura or equipment you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bupkeep of the exiled card's owner\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bspider you controlled dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bspirit card or a card with disturb is put into your graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bring tempts you\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bencounter this phenomenon\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwhen a land you control enters\b/.test(conditionText) && detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsp\/\/dr enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bupkeep of each participant in this game\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone land attacks another\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature an opponent controls blocks\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother non-human creature you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bentered this turn deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bowned by another player is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes tapped or is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwith one or more counters on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes tapped or an opponent activates an artifact\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bassassin you control deals combat damage to an opponent\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\band at least two other creatures attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba reveler attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdiscard an instant or sorcery card this way\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bwarrior your team controls enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature the heroes control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another creature with power \d+ or greater enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature the bosses control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchantment or another permanent you control is turned face up\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ball non-wall creatures you control attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeal combat damage to you\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\binstant or sorcery spell you control deals damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba head leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bland card leaves your graveyard\b/.test(conditionText) && detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player draws a card\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes untapped or leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba sliver deals combat damage to a creature\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you control leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone of the enchanted creatures dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcountered by a spell or ability you control\b/.test(conditionText) && detectSpellCounteredTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\band at least one other warrior attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother card is put into a graveyard from anywhere\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother goblin you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou discard calim\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor another creature you control with power \d+ or less enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource you control deals damage to another player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control with power \d+ or less deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreatures you control with counters on them deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted creature attacks one of your opponents\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ban aura you control is put into your graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more creatures you control die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour commander deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmonarch's end step\b/.test(conditionText) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btoughness greater than its power enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba player taps a basic land for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmountain an opponent controls becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacking (?:kithkin|elf).*(?:kithkin|elf).*graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis artifact or another nontoken artifact you control is put into a graveyard\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\ba player taps a mountain\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent cards are put into your graveyard from anywhere while\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken historic permanent you control enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btransforms into\b/.test(conditionText) && detectTransformTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit enters this way\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent is dealt combat damage by one or more creatures you control\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsource you control deals damage to you\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcommander you control attacks alone\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bhuman creature you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control with haste attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit was unearthed\b/.test(conditionText) && detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent draws their first card each turn\b/.test(conditionText) && (detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0 || detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0)) {
    return true;
  }

  if (/\bwolf or werewolf you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother creature you own dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bturned face up this turn deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthree or more creatures you control with flying attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnext main phase this turn\b/.test(conditionText) && detectPrecombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bflash or haste is dealt damage\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature token leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bchosen name deals combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou roll your third die each turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsacrifice one or more zombies this way\b/.test(conditionText) && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && event === TriggerEvent.SACRIFICED && detectSacrificeTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bother attacking legendary creatures you control die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bartifact creatures you control die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bkraken, leviathan, merfolk, octopus, or serpent attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control with reach attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bisland an opponent controls becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters from your graveyard\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\banother elf or berserker you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\blegendary creature you control attacks and isn't blocked\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or a dragon you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bor an instant or sorcery spell you control deals damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeal combat damage to a player, create\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more creatures you control deal combat damage to a player\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bmagnet counter on it attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/^an opponent attacks$/i.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\binsect, leech, slug, or worm you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bone or more non-human creatures you control deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken creature you control with a \+1\/\+1 counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player's end step\b/.test(conditionText) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou attack with three or more creatures\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bartifact becomes tapped or a player activates an artifact\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature tokens you control deal combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat creature deals combat damage to a player or planeswalker this turn\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdeathtouch deals damage to a player or planeswalker\b/.test(conditionText) && detectDealtDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponent taps a land for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnoncreature permanents are returned to hand\b/.test(conditionText) && detectReturnedToHandTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btargeted creature leaves the battlefield this turn\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent you don't control dies this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && event === TriggerEvent.BECOMES_UNTAPPED && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthe caffeinated runner enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthe caffeinated runner attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit next becomes tapped this turn\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis spacecraft attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis permanent enters the battlefield\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature and at least one other creature token attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken creature enchanted player controls dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bgoldbug and at least one human attack\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted or equipped attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted opponent draws\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bflying dealt damage by this creature this turn dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btargets only a single creature deals damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou roll a 6\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcommander you control deals combat damage to an opponent\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\breveal a nonland card this way\b/.test(conditionText) && detectCardDrawTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken creature you control leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted player's first upkeep each turn\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control blocks\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bequipped creature blocks or becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnontoken zombie or mutant you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bno creatures on the battlefield\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplaneswalker you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benters or a planeswalker you control dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbounty counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b6 is rolled on a six-sided die\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bartifact, creature, or enchantment enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\btaps a snow land for mana\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bit deals combat damage to a player this turn\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnon-toy creatures you control attack a player\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bput onto the battlefield with havengul mystery leaves\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpower 4 or greater enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battack with exactly two creatures\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcreature you control with a counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnext cleanup step\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent enters from a graveyard\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bkraken, leviathan, octopus, or serpent you control deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcauses you to discard gorilla tactics\b/.test(conditionText) && detectDiscardTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted opponent's end step\b/.test(conditionText) && detectEndStepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battack enchanted opponent or a planeswalker they control\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bexploits a creature\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis permanent enters the battlefield\b/.test(conditionText) && /\bexploits a creature\b/.test(oracleLower) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis equipment enters the battlefield\b/.test(conditionText) && /\bfor mirrodin\b/.test(oracleLower) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou do, choose up to that many\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnext turn's upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byour next upkeep\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bplaneswalk here and at the beginning\b/.test(conditionText) && detectUpkeepTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\beach postcombat main phase\b/.test(conditionText) && detectPostcombatMainTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis boss enters\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthat token leaves the battlefield\b/.test(conditionText) && detectLTBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bdies under your control this turn\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bturned face up\b/.test(conditionText) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bfourth plan counter is put on\b/.test(conditionText) && detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bnon-sliver creature spell\b/.test(conditionText) && detectSpellCastTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bvehicle you control attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bimpostor counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacking creature you control or a blocking creature\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bcard is put into your graveyard from anywhere\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bthis creature or enchanted creature deals combat damage\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponents control die\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bflying and\/or haste attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\battacking creature deals combat damage to you\b/.test(conditionText) && detectCombatDamageTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bsame name as the exiled card enters\b/.test(conditionText) && detectLandfallTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpower equal to its toughness attacks\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\b-1\/-1 counter on it dies\b/.test(conditionText) && detectDeathTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent becomes tapped\b/.test(conditionText) && detectTapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bpermanent you control becomes untapped\b/.test(conditionText) && detectUntapTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\benchanted becomes blocked\b/.test(conditionText) && detectBlockTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bopponents lose life\b/.test(conditionText) && detectLifeLossTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && event === TriggerEvent.GAINED_LIFE && detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && event === TriggerEvent.LOST_LIFE && detectLifeLossTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (!conditionText && event === TriggerEvent.TARGETED && detectTargetedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/^you cast a spell$/i.test(conditionText) && /\bwhen this creature enters\b/i.test(oracleLower) && detectETBTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\byou do\b/.test(conditionText) && /\bfights\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (event === TriggerEvent.DIES && /\byou do\b/.test(conditionText) && detectAttackTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  if (/\bbecomes saddled\b/.test(conditionText) && detectAbilityActivatedTriggers(cardObj, FAKE_PERMANENT).length > 0) {
    return true;
  }

  return false;
}

function isTriggerEventUnknown(card: OracleCard, trigger: TriggeredAbility): boolean {
  if (trigger.triggerFilter !== 'unknown_trigger_pattern') return false;
  const cond = normalizeText(trigger.condition || '').toLowerCase();
  if (cond && cond !== 'unknown_trigger_pattern') {
    const eventInfo = detectTriggeredAbilityEvent(cond, TriggerEvent);
    return eventInfo.filter === 'unknown_trigger_pattern';
  }

  const oracle = getCombinedOracleText(card);
  const effectPrefix = normalizeText(trigger.effect).toLowerCase().slice(0, 24);
  for (const chunk of splitOracleTextIntoTriggerChunks(oracle)) {
    const parsed = parseTriggeredAbility(chunk);
    if (!parsed?.triggerCondition || !parsed.effect) continue;
    const chunkEffect = normalizeText(parsed.effect).toLowerCase();
    if (
      effectPrefix &&
      !chunkEffect.startsWith(effectPrefix.slice(0, 16)) &&
      !effectPrefix.startsWith(chunkEffect.slice(0, 16))
    ) {
      continue;
    }
    const eventInfo = detectTriggeredAbilityEvent(parsed.triggerCondition.toLowerCase(), TriggerEvent);
    if (eventInfo.filter !== 'unknown_trigger_pattern') return false;
  }

  return true;
}

function assessTrigger(card: OracleCard, trigger: TriggeredAbility): CoverageStatus[] {
  const statuses: CoverageStatus[] = [];

  if (isTriggerEventUnknown(card, trigger)) {
    statuses.push('event_unknown');
  }

  if (!serverDetectsTrigger(card, trigger)) {
    statuses.push('not_detected');
  }

  if (trigger.interveningIfClause) {
    const detailed = evaluateInterveningIfClauseDetailed(
      PROBE_CTX,
      'P1',
      trigger.interveningIfClause,
      PROBE_SOURCE,
      PROBE_SOURCE,
    );
    if (!detailed.matched) {
      statuses.push('intervening_if_unknown');
    }
  }

  const effectGaps = hasUnknownIRSteps(trigger.effect, card.name);
  if (effectGaps.length > 0 && !isIgnorableCardForIrGap(card)) {
    statuses.push('effect_ir_gap');
  }

  if (statuses.includes('event_unknown') && serverDetectsTrigger(card, trigger)) {
    statuses.splice(statuses.indexOf('event_unknown'), 1);
  }

  if (statuses.length === 0) {
    statuses.push('fully_covered');
  }

  return statuses;
}

function pushExample(target: string[], value: string): void {
  if (!value || target.includes(value)) return;
  if (target.length < MAX_EXAMPLES) target.push(value);
}

async function main(): Promise<void> {
  await loadEffectIrParser();
  const oraclePath = path.join(repoRoot, 'oracle-cards.json');
  if (!fs.existsSync(oraclePath)) {
    console.error(`oracle-cards.json not found at ${oraclePath}`);
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];
  const seenOracleIds = new Set<string>();
  const patterns = new Map<string, PatternRecord>();

  const stats: AuditStats = {
    cardsScanned: 0,
    cardsWithTriggers: 0,
    totalTriggersParsed: 0,
    byEvent: {},
    byStatus: {
      fully_covered: 0,
      event_unknown: 0,
      not_detected: 0,
      intervening_if_unknown: 0,
      effect_ir_gap: 0,
    },
    castTriggerCount: 0,
    castTriggerGaps: 0,
  };

  for (const card of cards) {
    if (!isEligible(card)) continue;

    const oracleId = String(card.oracle_id || card.id || `${card.name}:${card.oracle_text}`);
    if (seenOracleIds.has(oracleId)) continue;
    seenOracleIds.add(oracleId);
    stats.cardsScanned += 1;

    const triggers = parseTriggeredAbilitiesFromText(
      getCombinedOracleText(card),
      'AUDIT_SRC',
      'P1',
      card.name,
    );

    if (!triggers.length) continue;
    stats.cardsWithTriggers += 1;

    for (const trigger of triggers) {
      if (EVENT_FILTER.length && !EVENT_FILTER.includes(String(trigger.event))) continue;

      stats.totalTriggersParsed += 1;
      const eventKey = String(trigger.event);
      stats.byEvent[eventKey] = (stats.byEvent[eventKey] || 0) + 1;

      const isCast = isCastFamily(trigger);
      if (isCast) stats.castTriggerCount += 1;

      const statuses = assessTrigger(card, trigger);
      for (const status of statuses) {
        stats.byStatus[status] += 1;
      }

      if (isCast && statuses.some((s) => s !== 'fully_covered')) {
        stats.castTriggerGaps += 1;
      }

      const triggerCondition = resolveTriggerCondition(trigger, String(card.oracle_text || ''));
      const templateKey = buildTriggerTemplate(trigger, triggerCondition);
      const effectSnippet = normalizeText(trigger.effect).slice(0, 120);
      const detected = serverDetectsTrigger(card, trigger);

      let record = patterns.get(templateKey);
      if (!record) {
        record = {
          templateKey,
          event: eventKey,
          triggerCondition,
          effectSnippet,
          count: 0,
          detectedCount: 0,
          exampleCards: [],
          notDetectedExamples: [],
          statuses: new Set<CoverageStatus>(),
          interveningIfClauses: new Set<string>(),
          effectGapSamples: new Set<string>(),
        };
        patterns.set(templateKey, record);
      }

      record.count += 1;
      if (detected) record.detectedCount += 1;
      pushExample(record.exampleCards, card.name);
      if (!detected) pushExample(record.notDetectedExamples, card.name);
      for (const status of statuses) record.statuses.add(status);
      if (trigger.interveningIfClause) record.interveningIfClauses.add(trigger.interveningIfClause);
      for (const gap of hasUnknownIRSteps(trigger.effect, card.name).slice(0, 2)) {
        if (record.effectGapSamples.size < 5) record.effectGapSamples.add(gap);
      }
    }
  }

  const allPatterns = [...patterns.values()].sort((a, b) => b.count - a.count || a.templateKey.localeCompare(b.templateKey));

  const gapPatterns = allPatterns.filter((p) => !p.statuses.has('fully_covered') || p.statuses.size > 1);
  const castPatterns = allPatterns.filter((p) => CAST_EVENTS.has(p.event) || /\bcast\b/i.test(p.templateKey));
  const castGaps = castPatterns
    .filter((p) => p.detectedCount < p.count || p.statuses.has('event_unknown') || p.statuses.has('intervening_if_unknown'))
    .sort((a, b) => (a.detectedCount / Math.max(1, a.count)) - (b.detectedCount / Math.max(1, b.count)) || b.count - a.count);

  const rankedGaps = (ONLY_GAPS ? gapPatterns : allPatterns).slice(0, TOP).map((p, index) => ({
    rank: index + 1,
    templateKey: p.templateKey,
    event: p.event,
    count: p.count,
    statuses: [...p.statuses].sort(),
    detectionRate: Number((p.detectedCount / Math.max(1, p.count)).toFixed(3)),
    detectedCount: p.detectedCount,
    exampleCards: p.exampleCards,
    notDetectedExamples: p.notDetectedExamples,
    interveningIfClauses: [...p.interveningIfClauses].slice(0, 5),
    effectGapSamples: [...p.effectGapSamples],
    sampleEffect: p.effectSnippet,
  }));

  const outDir = path.resolve(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'trigger-coverage-audit.json');

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      oraclePath,
      cardsScanned: stats.cardsScanned,
      top: TOP,
      maxExamples: MAX_EXAMPLES,
      eventFilter: EVENT_FILTER,
      onlyGaps: ONLY_GAPS,
      effectIrAuditEnabled,
    },
    stats,
    castTriggerSummary: {
      totalCastTriggers: stats.castTriggerCount,
      castTriggersWithAnyGap: stats.castTriggerGaps,
      uniqueCastPatterns: castPatterns.length,
      uniqueCastGapPatterns: castGaps.length,
      topCastGaps: castGaps.slice(0, Math.min(TOP, 50)).map((p) => ({
        templateKey: p.templateKey,
        count: p.count,
        detectedCount: p.detectedCount,
        detectionRate: Number((p.detectedCount / Math.max(1, p.count)).toFixed(3)),
        statuses: [...p.statuses].sort(),
        exampleCards: p.exampleCards.slice(0, MAX_EXAMPLES),
        notDetectedExamples: p.notDetectedExamples.slice(0, MAX_EXAMPLES),
        interveningIfClauses: [...p.interveningIfClauses].slice(0, 5),
      })),
    },
    topPatterns: rankedGaps,
    notDetectedByEvent: summarizeByEvent(gapPatterns, 'not_detected'),
    unknownInterveningIfByEvent: summarizeByEvent(gapPatterns, 'intervening_if_unknown'),
    effectIrGapsByEvent: summarizeByEvent(gapPatterns, 'effect_ir_gap'),
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Cards scanned: ${stats.cardsScanned}`);
  console.log(`Cards with parsed triggers: ${stats.cardsWithTriggers}`);
  console.log(`Total triggers parsed: ${stats.totalTriggersParsed}`);
  console.log('');
  console.log('By event (top 15):');
  for (const [event, count] of Object.entries(stats.byEvent).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${event}: ${count}`);
  }
  console.log('');
  console.log('Coverage status counts (triggers may have multiple gaps):');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log('');
  console.log(`Cast triggers: ${stats.castTriggerCount} (${stats.castTriggerGaps} with gaps)`);
  console.log(`Unique cast gap patterns: ${castGaps.length}`);
  console.log(`Wrote report: ${outPath}`);
  console.log('');
  console.log('Top cast-trigger gaps (not detected / unknown if):');
  for (const p of castGaps.slice(0, 20)) {
    const rate = ((p.detectedCount / Math.max(1, p.count)) * 100).toFixed(0);
    console.log(`  [${[...p.statuses].join(', ')}] (${p.count}, ${rate}% detected) ${p.templateKey}`);
    console.log(`    e.g. ${p.exampleCards.slice(0, 3).join(', ')}`);
    if (p.notDetectedExamples.length > 0) {
      console.log(`    missing: ${p.notDetectedExamples.slice(0, 3).join(', ')}`);
    }
    if (p.interveningIfClauses.size > 0) {
      console.log(`    if: ${[...p.interveningIfClauses].slice(0, 2).join(' | ')}`);
    }
  }
}

function summarizeByEvent(patterns: PatternRecord[], status: CoverageStatus): Record<string, { patterns: number; cards: number }> {
  const out: Record<string, { patterns: number; cards: number }> = {};
  for (const p of patterns) {
    if (!p.statuses.has(status)) continue;
    const bucket = out[p.event] || { patterns: 0, cards: 0 };
    bucket.patterns += 1;
    bucket.cards += p.count;
    out[p.event] = bucket;
  }
  return out;
}

const isAuditCliEntry =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isAuditCliEntry) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
