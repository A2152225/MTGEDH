/**
 * Spell-cast qualifiers the enum projection drops: "of the chosen type", "that has an Adventure",
 * "an Adventure [instant or sorcery] spell", "an Adventure or Dragon spell".
 * Removes legacy triggers whose printed qualifier fails and adds the trigger when no detector emitted it.
 * Origin parent: spell-cast-get-triggers.ts getSpellCastTriggers.
 * Public: refineSpellCastQualifierTriggers.
 */

import { cardHasCreatureType } from "../../creatureTypeNow.js";
import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";

const LINE_RE = /^whenever you cast ([^,]*?)\bspell( that has an adventure| of the chosen type)?,\s*(.+)$/i;

function castFaceTypeLine(spell: any): string {
  const full = String(spell?.type_line || '').toLowerCase();
  if (!full.includes('//')) return full;
  const [main, adv] = full.split('//').map((s) => s.trim());
  return spell?.castAsAdventure === true ? adv : main;
}

function isAdventureCard(spell: any): boolean {
  if (String(spell?.layout || '').toLowerCase() === 'adventure') return true;
  const faces = Array.isArray(spell?.card_faces) ? spell.card_faces : [];
  return faces.some((f: any) => /\badventure\b/i.test(String(f?.type_line || '')))
    || /\/\/.*\badventure\b/i.test(String(spell?.type_line || ''));
}

function isAdventureCast(spell: any): boolean {
  return spell?.castAsAdventure === true || /\badventure\b/.test(castFaceTypeLine(spell));
}

function spellHasType(spell: any, type: string): boolean {
  const t = type.toLowerCase();
  return cardHasCreatureType(spell, t) || new RegExp('\\b' + t + '\\b').test(castFaceTypeLine(spell));
}

/** Adventure cards on the stack have the characteristics of the face being cast (CR 715.3b). */
export function castFaceSpellView(spell: any): any {
  const full = String(spell?.type_line || '');
  if (!full.includes('//') || !isAdventureCard(spell)) return spell;
  const [main, adv] = full.split('//').map((s) => s.trim());
  return { ...spell, type_line: spell?.castAsAdventure === true ? adv : main };
}

function norm(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** null when the line has none of the handled qualifiers. */
export function spellCastQualifierMatches(line: string, spell: any, source: any): boolean | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) return null;
  const words = m[1].toLowerCase().replace(/\b(?:a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const hasAdv = /adventure/i.test(m[2] || '');
  const chosen = /chosen type/i.test(m[2] || '') || /\bof the chosen type\b/i.test(m[1]);
  const advSpell = /\badventure\b/.test(words);
  if (!hasAdv && !chosen && !advSpell) return null;
  const typeLine = castFaceTypeLine(spell);
  if (hasAdv && !isAdventureCard(spell)) return false;
  if (/\bcreature\b/.test(words) && !/\bcreature\b/.test(typeLine)) return false;
  if (advSpell) {
    const orType = /\badventure or (\w+)\b/.exec(words)?.[1];
    const advOk = isAdventureCast(spell) && (!/instant or sorcery/.test(words) || /\b(?:instant|sorcery)\b/.test(typeLine));
    if (!advOk && !(orType && spellHasType(spell, orType))) return false;
  }
  if (chosen) {
    const type = String(source?.chosenCreatureType || source?.card?.chosenCreatureType || '').trim();
    if (!type || !spellHasType(spell, type)) return false;
  }
  return true;
}

export function refineSpellCastQualifierTriggers(
  battlefield: readonly any[],
  casterId: string,
  spellCard: any,
  triggers: SpellCastTrigger[],
): SpellCastTrigger[] {
  let out = triggers;
  for (const permanent of battlefield) {
    if (!permanent?.card || String(permanent.controller || '') !== casterId) continue;
    const lines = String(permanent.card.oracle_text || '').split('\n');
    for (const raw of lines) {
      const line = raw.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      const verdict = spellCastQualifierMatches(line, spellCard, permanent);
      if (verdict === null) continue;
      const effect = LINE_RE.exec(line)![3].trim();
      const key = norm(effect).slice(0, 24);
      const mine = (t: SpellCastTrigger) => String(t.permanentId) === String(permanent.id)
        && (norm(t.effect).startsWith(key) || norm(t.description).startsWith(key) || key.startsWith(norm(t.effect).slice(0, 24)));
      if (!verdict) { out = out.filter((t) => !mine(t)); continue; }
      if (out.some(mine)) continue;
      out = [...out, {
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || casterId),
        description: effect,
        effect,
        spellCondition: 'any',
        mandatory: !/\byou may\b/i.test(effect.replace(/\byou may choose new targets for (?:the|that|each|any of the) cop(?:y|ies)\b/gi, '')),
        ...(/\bcopy (?:it|that spell)\b/i.test(effect) ? { copiesSpell: true } : {}),
      } as SpellCastTrigger];
    }
  }
  return out;
}
