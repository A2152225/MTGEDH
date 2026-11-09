/*
  Uncovered-trigger inventory (Round 45).
  A clause is COVERED if:
    - parseTriggerClause returns IR without legacyRuntimeOnly AND the event has an IR emitter, OR
    - any major detect* returns a non-empty list for a permanent whose oracle is only that sentence.
  Quoted "Whenever/When/At ..." grants are included as source=granted_quote.
  Writes D:/tmp/mtgpatch/uncovered_triggers.txt
*/
import fs from 'node:fs';
import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { stripReminderParentheticals } from '../../rules-engine/src/oracleReminderText.js';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { INCLUDE_UPCOMING, includeCardInCensus, type CensusSelectableCard } from './census-card-filter.js';
import { triggerFamilyKey } from './trigger-ir-census.js';
import { detectDeathTriggers } from '../src/state/modules/triggers/death-detection.js';
import { detectETBTriggers } from '../src/state/modules/triggers/etb-detection.js';
import { detectAttackTriggers } from '../src/state/modules/triggers/attack-detection.js';
import { detectCombatDamageTriggers } from '../src/state/modules/triggers/combat-damage-detection.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-detection.js';
import { detectLTBTriggers } from '../src/state/modules/triggers/ltb-detection.js';
import { detectDealtDamageTriggers } from '../src/state/modules/triggers/dealt-damage-detection.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';
import { detectDiscardTriggers } from '../src/state/modules/triggers/discard.js';
import { detectBlockTriggers } from '../src/state/modules/triggers/block-detection.js';
import { detectTapTriggers } from '../src/state/modules/triggers/tap-detection.js';
import { detectUntapTriggers } from '../src/state/modules/triggers/tap-untap.js';
import { detectCounterPlacedTriggers, detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { detectAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated-detection.js';
import { detectMonstrousTriggers, detectTransformTriggers } from '../src/state/modules/triggers/status-keyword-detection.js';
import { extractSelfCastEffectClauses } from '../../rules-engine/src/cards/castTriggers.js';
import { detectRoomUnlockDoorTriggers } from '../src/state/modules/triggers/room.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { detectPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';

const IR_EMITTED = new Set([
  'dies','enters','attacks','blocks','spell_cast','spell_copied','attacks_unblocked','becomes_blocked',
  'becomes_target','deals_damage','commits_crime','beginning_of_upkeep','beginning_of_draw_step',
  'beginning_of_combat','beginning_of_end_step','beginning_of_precombat_main','beginning_of_postcombat_main',
  'end_of_combat','gains_life','loses_life','sacrifices','draws_card','discards','mills',
  'deals_combat_damage_to_player','deals_combat_damage_to_creature','deals_combat_damage','counter_placed','counter_removed',
  'dealt_damage','plays_land','searches_library','shuffles_library','pays_life','creates_token',
  'put_on_stack','cycles','mutates','performs','leaves_battlefield','left_graveyard','put_into_graveyard',
  'becomes_tapped','becomes_untapped','becomes_monstrous','transforms','class_level','room_fully_unlocked',
  'becomes_attached','becomes_unattached','becomes_crewed','becomes_saddled','turned_face_up',
  'exiled','returned_to_hand','gains_control','loses_control','spell_countered','counters_spell',
  'unlocks_door','tapped_for_mana','controls_none','last_counter_removed','attacks_alone','attacks_in_group',
  'each_of_your_main_phases','put_into_library','phases_in','reflexive_do',
]);

type Face = { name?: string; oracle_text?: string; type_line?: string };
type Card = Face & CensusSelectableCard & { card_faces?: Face[]; set?: string };

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

function splitSentences(oracle: string): string[] {
  const text = stripReminderParentheticals(String(oracle || ''))
    .replace(/\u2019/g, "'");
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((s) => s.replace(ABILITY_WORD, '').trim())
    .filter((s) => /^(?:when|whenever|at)\b/i.test(s));
}

function extractQuotedTriggers(oracle: string): string[] {
  const text = stripReminderParentheticals(String(oracle || '')).replace(/\u2019/g, "'");
  const out: string[] = [];
  const re = /["\u201c]([^"\u201d\n]+)["\u201d]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = m[1].trim();
    // Ability word prefix inside quotes is rare; take whenever/when/at clauses.
    for (const part of inner.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i)) {
      const s = part.replace(ABILITY_WORD, '').trim();
      // Strionic-style reminder quotes ("when,", "whenever,", "at.") are not real triggers.
      const TRIGGER_WORD_STUB = /^(?:when|whenever|at)[,.]?\s*$/i;
      if (/^(?:when|whenever|at)\b/i.test(s) && !TRIGGER_WORD_STUB.test(s)) out.push(s);
    }
  }
  return out;
}

function fakePermanent(oracle: string, typeLine: string, name: string) {
  const lower = String(oracle || '').toLowerCase();
  return {
    id: 'inv',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    counters: {},
    ...( /chosen type/.test(lower) ? { chosenCreatureType: 'Elf' } : {} ),
    ...( /chosen colou?r/.test(lower) ? { chosenColor: 'red' } : {} ),
    card: {
      id: 'inv_c', name, type_line: typeLine || 'Creature', oracle_text: oracle,
      ...( /chosen type/.test(lower) ? { chosenCreatureType: 'Elf' } : {} ),
      ...( /chosen colou?r/.test(lower) ? { chosenColor: 'red' } : {} ),
    },
  };
}

function legacyHits(sentence: string, typeLine: string, name: string): string[] {
  const perm = fakePermanent(sentence, typeLine, name);
  const card = perm.card;
  const hits: string[] = [];
  const tryDetect = (label: string, fn: () => any[]) => {
    try {
      const list = fn() || [];
      if (Array.isArray(list) && list.length > 0) hits.push(`${label}:${list.length}`);
    } catch { /* detector may need more state */ }
  };
  tryDetect('death', () => detectDeathTriggers(card, perm));
  tryDetect('etb', () => detectETBTriggers(card, perm));
  tryDetect('attack', () => detectAttackTriggers(card, perm));
  tryDetect('combatDamage', () => detectCombatDamageTriggers(card, perm));
  tryDetect('spellCast', () => detectSpellCastTriggers(card, perm));
  tryDetect('ltb', () => detectLTBTriggers(card, perm));
  tryDetect('dealtDamage', () => detectDealtDamageTriggers(card, perm));
  tryDetect('cardDraw', () => detectCardDrawTriggers(card, perm));
  tryDetect('lifegain', () => detectLifegainTriggers(card, perm));
  tryDetect('discard', () => detectDiscardTriggers(card, perm));
  tryDetect('block', () => detectBlockTriggers(card, perm));
  tryDetect('tap', () => detectTapTriggers(card, perm));
  tryDetect('untap', () => detectUntapTriggers(card, perm));
  tryDetect('counterPlaced', () => detectCounterPlacedTriggers(card, perm));
  tryDetect('counterRemoved', () => detectCounterRemovedTriggers(card, perm));
  tryDetect('lifeLoss', () => detectLifeLossTriggers(card, perm));
  tryDetect('landfall', () => detectLandfallTriggers(card, perm));
  tryDetect('abilityActivated', () => detectAbilityActivatedTriggers(card, perm));
  tryDetect('monstrous', () => detectMonstrousTriggers(card, perm));
  tryDetect('transform', () => detectTransformTriggers(card, perm));
  tryDetect('roomUnlock', () => detectRoomUnlockDoorTriggers(card, perm) as any);
  tryDetect('beginCombat', () => detectBeginningOfCombatTriggers(card, perm) as any);
  tryDetect('precombatMain', () => detectPrecombatMainTriggers(card, perm) as any);
  tryDetect('mill', () => detectMillTriggers(card, perm) as any);
  return hits;
}

type Row = {
  card: string;
  set: string;
  source: 'printed' | 'granted_quote';
  family: string;
  clause: string;
  reason: string;
  event?: string;
};

async function main() {
  void resolveOracleCardsPath;
  const uncovered: Row[] = [];
  const coveredLegacy: Row[] = [];
  const coveredIr: Row[] = [];
  const parsedNoEmit: Row[] = [];
  let printedClauses = 0;
  let quotedClauses = 0;

  for await (const card of iterateOracleCards(resolveOracleCardsPath()) as AsyncGenerator<Card>) {
    if (!includeCardInCensus(card, true)) continue;
    const faces: Face[] = Array.isArray(card.card_faces) && card.card_faces.length
      ? card.card_faces
      : [card];
    for (const face of faces) {
      const name = String(face.name || card.name || '');
      const typeLine = String(face.type_line || card.type_line || '');
      const oracle = String(face.oracle_text || '');
      if (!oracle) continue;

      const printed = splitSentences(oracle);
      const quoted = extractQuotedTriggers(oracle);
      // Drop quoted that are already identical to a printed sentence on the same face.
      const printedLower = new Set(printed.map((s) => s.toLowerCase()));
      const quotedOnly = quoted.filter((s) => !printedLower.has(s.toLowerCase()));

      const consider = (sentence: string, source: 'printed' | 'granted_quote') => {
    // TRIGGER_WORD_STUB_CONSIDER: reminder fragments naming trigger words, not clauses.
    if (/^(?:when|whenever|at)[,.]?\s*$/i.test(sentence.trim())) return;
        if (source === 'printed') printedClauses += 1; else quotedClauses += 1;
        const family = triggerFamilyKey(sentence, name);
        const parsed = parseTriggerClause(sentence, name);
        const condition: any = parsed?.condition;
        const event = condition?.event as string | undefined;
        const legacyOnly = Boolean(condition?.legacyRuntimeOnly);
        // Delayed / next-cast / reflexive riders: IR owns the parse; permanent match suppresses them.
        if (condition && (condition.delayedNextTurn || condition.thatSpell || condition.nextSpellThisTurn || condition.delayedRider || condition.reflexiveActor || event === 'reflexive_do')) {
          if (!legacyOnly && event && IR_EMITTED.has(event)) {
            coveredIr.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'ir_delayed_rider', event });
            return;
          }
          coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'delayed_rider', event });
          return;
        }
        if (condition && !legacyOnly && event && IR_EMITTED.has(event)) {
          coveredIr.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'ir_emitted', event });
          return;
        }
        // On-cast self triggers fire from the spell on the stack, not permanent detectors.
        if (event === 'cast_self' || /^when you cast (?:this spell|this card)\b/i.test(sentence)) {
          try {
            if (extractSelfCastEffectClauses(sentence).length > 0 || extractSelfCastEffectClauses(oracle).length > 0) {
              coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'on_cast_self', event: event || 'cast_self' });
              return;
            }
          } catch { /* ignore */ }
        }
        // Discarded-card look-back, Trek dilemma, connive / discard-this-way / reveal-this-way, scry-bottom.
        if (/when (?:a spell or ability an opponent controls causes you to discard this card|you discard this card)\b/i.test(sentence)
          || /whenever you face a dilemma\b/i.test(sentence)
          || /\bconnives?\b/i.test(sentence)
          || /discard (?:a |an |one or more )?(?:nonland |land |creature )?cards? this way\b/i.test(sentence)
          || /reveal (?:a |an |one or more )?(?:instant or sorcery |creature |land |nonland )?cards? this way\b/i.test(sentence)
          || /put one or more cards on the bottom of your library while scrying/i.test(sentence)
          || /\bscry\b.+\bput (?:the rest|them|those cards) on the bottom\b/i.test(sentence)
          || /\bputs? the rest on the bottom\b/i.test(sentence)) {
          coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'special_runtime', event });
          return;
        }
        // Delayed "next ..." riders are created by parent effects, not permanent detectors.
        if (/\bat the beginning of (?:the|your) next (?:end step|upkeep)\b/i.test(sentence)
          || /\bat the beginning of that turn's end step\b/i.test(sentence)
          || /\bat this turn's next end of combat\b/i.test(sentence)
          || /\bat the beginning of that combat\b/i.test(sentence)
          || /\bat the beginning of the end step on your next turn\b/i.test(sentence)
          || /\bat the beginning of that player's next end step\b/i.test(sentence)
          || /\bwhen you cast that spell\b/i.test(sentence)
          || /\bwhen you next cast .+ this turn\b/i.test(sentence)
          || /\bwhen (?:the creature|that creature|it) (?:leaves the battlefield|dies|deals damage) this (?:turn|combat)\b/i.test(sentence)
          || /\bwhenever that creature deals (?:combat )?damage this (?:turn|combat)\b/i.test(sentence)
          || /\bwhenever either of those creatures deals combat damage\b/i.test(sentence)
          || /\bwhen excess damage is dealt .+ this way\b/i.test(sentence)
          || /\bfought this way\b/i.test(sentence)
          || /\bexiled this way\b/i.test(sentence)
          || /\bmilled this way\b/i.test(sentence)
          || /\bbecome attached to that creature this way\b/i.test(sentence)
          || /\bsearch your library this way\b/i.test(sentence)
          || /\bput .+ onto the battlefield this way\b/i.test(sentence)
          || /\bwhen jumblebones leaves\b/i.test(sentence)
          || /\bwhen you (?:sacrifice|remove a counter|discard|put a creature card)(?:\s+\S+)*? this way\b/i.test(sentence)
          || /^(?:when|whenever) you do\b/i.test(sentence)
          || /^(?:when|whenever) they do\b/i.test(sentence)) {
          coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'delayed_rider', event });
          return;
        }
        // Round 51: triggered mana abilities / hand-from-GY / commander-to-CZ.
        if (/\btapped for mana\b|\btaps? .+ for mana\b|\btaps? .+ for \{[wubrgc]\}/i.test(sentence)
          || /put into your hand from your graveyard/i.test(sentence)
          || /put into the command zone from anywhere/i.test(sentence)) {
          coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: 'special_runtime', event });
          return;
        }
        const hits = legacyHits(sentence, typeLine, name);
        if (hits.length > 0) {
          coveredLegacy.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: `legacy:${hits.join(',')}`, event });
          return;
        }
        if (condition && !legacyOnly && event && !IR_EMITTED.has(event)) {
          parsedNoEmit.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: `parsed_no_emitter:${event}`, event });
          uncovered.push({ card: name, set: String(card.set || ''), source, family, clause: sentence, reason: `parsed_no_emitter:${event}`, event });
          return;
        }
        uncovered.push({
          card: name,
          set: String(card.set || ''),
          source,
          family,
          clause: sentence,
          reason: condition ? (legacyOnly ? 'legacyRuntimeOnly_no_detector' : 'parsed_unclassified') : 'unparsed_no_detector',
          event,
        });
      };

      for (const s of printed) consider(s, 'printed');
      for (const s of quotedOnly) consider(s, 'granted_quote');
    }
  }

  // Group uncovered by family
  const byFamily = new Map<string, { cards: Set<string>; lines: number; sample: string; reason: string; source: string }>();
  for (const row of uncovered) {
    const e = byFamily.get(row.family) || { cards: new Set<string>(), lines: 0, sample: row.clause, reason: row.reason, source: row.source };
    e.cards.add(row.card);
    e.lines += 1;
    byFamily.set(row.family, e);
  }
  const ranked = [...byFamily.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size || b[1].lines - a[1].lines);

  const uncoveredCards = new Set(uncovered.map((r) => r.card));
  const lines = [
    `# Uncovered triggers inventory (Round 45)`,
    `# Generated ${new Date().toISOString()}`,
    `# INCLUDE_UPCOMING=${INCLUDE_UPCOMING || true}`,
    `# printedClauses=${printedClauses} quotedClauses=${quotedClauses}`,
    `# coveredIr=${coveredIr.length} coveredLegacy=${coveredLegacy.length}`,
    `# uncoveredLines=${uncovered.length} uncoveredCards=${uncoveredCards.size}`,
    `# parsedNoEmit=${parsedNoEmit.length}`,
    `#`,
    `# Definition: fires 0 times today — no IR emitter path and no detect* hit on the sentence alone.`,
    `#`,
    `## Top uncovered families (by cards)`,
    ...ranked.slice(0, 80).map(([fam, v], i) => `${i + 1}. cards=${v.cards.size} lines=${v.lines} [${v.reason}] ${fam} | ex: ${[...v.cards].slice(0, 3).join('; ')}`),
    ``,
    `## All uncovered lines`,
    ...uncovered
      .sort((a, b) => a.family.localeCompare(b.family) || a.card.localeCompare(b.card))
      .map((r) => `${r.source}\t${r.reason}\t${r.card}\t${r.set}\t${r.family}\t${r.clause.replace(/\t/g, ' ')}`),
  ];
  const outPath = 'D:/tmp/mtgpatch/uncovered_triggers.txt';
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  fs.writeFileSync('D:/tmp/mtgpatch/uncovered_triggers.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    printedClauses,
    quotedClauses,
    coveredIr: coveredIr.length,
    coveredLegacy: coveredLegacy.length,
    uncoveredLines: uncovered.length,
    uncoveredCards: uncoveredCards.size,
    parsedNoEmit: parsedNoEmit.length,
    topFamilies: ranked.slice(0, 80).map(([fam, v]) => ({
      family: fam, cards: v.cards.size, lines: v.lines, reason: v.reason, examples: [...v.cards].slice(0, 5), sample: v.sample,
    })),
    uncovered,
  }, null, 2), 'utf8');
  // Legacy-path inventory (Round 59+): group coveredLegacy by reason / first detector hit.
  const legacyByReason = new Map<string, { cards: Set<string>; lines: number; sample: string; event?: string }>();
  for (const row of coveredLegacy) {
    const key = row.reason.startsWith('legacy:') ? row.reason.slice('legacy:'.length).split(',')[0].replace(/:\d+$/, '') : row.reason;
    const e = legacyByReason.get(key) || { cards: new Set<string>(), lines: 0, sample: row.clause, event: row.event };
    e.cards.add(row.card);
    e.lines += 1;
    legacyByReason.set(key, e);
  }
  const legacyRanked = [...legacyByReason.entries()].sort((a, b) => b[1].lines - a[1].lines || b[1].cards.size - a[1].cards.size);
  const legacyLines = [
    `# Covered-legacy triggers inventory`,
    `# Generated ${new Date().toISOString()}`,
    `# coveredLegacy=${coveredLegacy.length} coveredIr=${coveredIr.length}`,
    `#`,
    `## Top legacy families (by lines)`,
    ...legacyRanked.map(([fam, v], i) => `${i + 1}. lines=${v.lines} cards=${v.cards.size} event=${v.event || '?'} [${fam}] ex: ${[...v.cards].slice(0, 3).join('; ')} | ${v.sample.slice(0, 120)}`),
    ``,
    `## All coveredLegacy lines`,
    ...coveredLegacy
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.family.localeCompare(b.family) || a.card.localeCompare(b.card))
      .map((r) => `${r.source}\t${r.reason}\t${r.event || ''}\t${r.card}\t${r.set}\t${r.family}\t${r.clause.replace(/\t/g, ' ')}`),
  ];
  fs.writeFileSync('D:/tmp/mtgpatch/covered_legacy_triggers.txt', legacyLines.join('\n'), 'utf8');
  fs.writeFileSync('D:/tmp/mtgpatch/covered_legacy_triggers.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    coveredLegacy: coveredLegacy.length,
    coveredIr: coveredIr.length,
    byFamily: legacyRanked.map(([fam, v]) => ({
      family: fam, lines: v.lines, cards: v.cards.size, event: v.event, examples: [...v.cards].slice(0, 8), sample: v.sample,
    })),
    rows: coveredLegacy,
  }, null, 2), 'utf8');
  console.log(`uncoveredLines=${uncovered.length} uncoveredCards=${uncoveredCards.size} coveredIr=${coveredIr.length} coveredLegacy=${coveredLegacy.length} printed=${printedClauses} quoted=${quotedClauses}`);
  console.log('legacyTop=' + legacyRanked.slice(0, 12).map(([f, v]) => f + ':' + v.lines).join(','));
  for (const [fam, v] of ranked.slice(0, 25)) {
    console.log(`${v.cards.size}\t${v.lines}\t${v.reason}\t${fam}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });