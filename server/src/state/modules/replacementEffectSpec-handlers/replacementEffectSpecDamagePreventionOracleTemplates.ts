// Origin parent: replacementEffectSpecDamageOracleTemplates.ts
// Generic damage prevention replacements (CR 615): "prevent all [combat|noncombat] damage that would be dealt
// to ~ / to [other] creatures you control / to [and by] enchanted creature", "if damage would be dealt to ~,
// prevent that damage", "if a [COLOR] source [an opponent controls] would deal damage to you, prevent N of that damage".
// Full prevention is modelled as cap 0; "prevent N" as add_flat -N (floored at 0).
// Public entry symbols: collectOraclePatternDamagePreventionSpecsFromState, matchesDamagePreventionExtras.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';
import { parseBatch18PreventAllSentence, matchesBatch18PreventAll } from '../replacementBatch18PreventAll.js';
import { parseBatch19PreventAllSentence, matchesBatch19PreventAll } from '../replacementBatch19PreventAll.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COLOR_LETTERS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function readAmount(raw: string): number | null {
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return Number.isFinite(n) ? n : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
}

/** Lowercased sentences with the card's own name (and "this creature") replaced by "~". */
export function selfReferenceSentences(oracle: string, cardName: string): string[] {
  const lines = String(oracle || '').split(/\r?\n/);
  if (lines.length > 1) return lines.flatMap((line) => selfReferenceSentences(line, cardName));
  let text = normalizeOraclePatternText(oracle);
  const name = normalizeOraclePatternText(cardName);
  if (name) text = text.replace(new RegExp('\\b' + escapeRegExp(name) + '\\b', 'g'), () => '~');
  // Batch 15: legendary short names ("Prevent all damage that would be dealt to Sevinne.").
  const shortName = name.split(',')[0].trim();
  if (shortName && shortName !== name && shortName.length >= 3) {
    text = text.replace(new RegExp('\\b' + escapeRegExp(shortName) + '\\b', 'g'), () => '~');
  }
  text = text.replace(/\bthis (?:creature|permanent)\b/g, '~');
  return text.split(/(?<=\.)\s+/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
}

function prevent(id: string, match: SpecBody['match']): SpecBody {
  return { event: 'damage', match, instead: { modify: 'cap', value: 0 }, effectId: id, reason: id.replace(/-/g, '_') };
}

export function parseDamagePreventionSentence(sentence: string, next: string | undefined): SpecBody[] {
  const s = sentence;
  // Phantom-style "prevent that damage. Remove a counter" needs the follow-up; leave it to a dedicated reader.
  const followUpCost = !!next && /^(?:remove|put|sacrifice)\b/.test(next);

  if (/^(?:if damage would be dealt to ~, prevent that damage|prevent all damage that would be dealt to ~)$/.test(s)) {
    return followUpCost ? [] : [prevent('prevent-all-damage-to-self', { receivingPermanentIsSource: true })];
  }
  // Batch 15 prevention shapes.
  if (/^during your turn, prevent all damage that would be dealt to ~$/.test(s)) {
    return [prevent('prevent-damage-to-self-your-turn', { receivingPermanentIsSource: true, duringSourceControllerTurn: true })];
  }
  if (/^prevent all damage that would be dealt to ~ by creatures it's blocking$/.test(s)) {
    return [{ ...prevent('prevent-damage-to-self-by-blocked-creatures', { receivingPermanentIsSource: true, damageSourceIsCreature: true }), metadata: { damageSourceBlockedBySource: true } }];
  }
  if (/^prevent all damage that would be dealt to you$/.test(s)) {
    return [prevent('prevent-all-damage-to-you', { receivingIsPlayerOnly: true, receivingPlayerIsSourceController: true })];
  }
  if (/^prevent all combat damage that would be dealt to ~$/.test(s)) {
    return [prevent('prevent-combat-damage-to-self', { receivingPermanentIsSource: true, combatDamageOnly: true })];
  }
  if (/^prevent all damage that would be dealt to ~ by creatures$/.test(s)) {
    return [prevent('prevent-creature-damage-to-self', { receivingPermanentIsSource: true, damageSourceIsCreature: true })];
  }
  let m = s.match(/^prevent all (combat |noncombat )?damage that would be dealt to (other )?creatures you control$/);
  if (m) {
    return [prevent(`prevent-${(m[1] || 'all ').trim()}-damage-to-${m[2] ? 'other-' : ''}creatures-you-control`, {
      receivingPermanentControllerIsSourceController: true,
      receivingPermanentTypeIncludesAll: ['creature'],
      ...(m[2] ? { receivingPermanentIsNotSource: true } : {}),
      ...(m[1] === 'combat ' ? { combatDamageOnly: true } : {}),
      ...(m[1] === 'noncombat ' ? { noncombatDamageOnly: true } : {}),
    })];
  }
  m = s.match(/^prevent all (combat )?damage that would be dealt (to and dealt by|by|to) enchanted creature$/);
  if (m) {
    const combat = m[1] ? { combatDamageOnly: true } : {};
    const out: SpecBody[] = [];
    if (m[2] !== 'to') out.push(prevent(`prevent-${m[1] ? 'combat-' : ''}damage-by-enchanted`, { damageSourceIsEnchantedBySource: true, ...combat }));
    if (m[2] !== 'by') out.push(prevent(`prevent-${m[1] ? 'combat-' : ''}damage-to-enchanted`, { receivingPermanentIsEnchantedBySource: true, ...combat }));
    return out;
  }
  m = s.match(/^if an? (?:(white|blue|black|red|green) )?source (an opponent controls )?would deal damage to you, prevent (\d+|[a-z]+) of that damage$/);
  if (m) {
    const amount = readAmount(m[3]);
    if (amount == null || (!m[1] && !m[2])) return [];
    return [{
      event: 'damage',
      match: {
        receivingIsPlayerOnly: true,
        receivingPlayerIsSourceController: true,
        ...(m[1] ? { damageSourceColorIncludes: COLOR_LETTERS[m[1]] } : {}),
        ...(m[2] ? { damageSourceControllerIsOpponentOfSource: true } : {}),
      },
      instead: { modify: 'add_flat', value: -amount },
      effectId: `prevent-${amount}-damage-to-you${m[1] ? '-from-' + m[1] : ''}${m[2] ? '-from-opponent' : ''}`,
      reason: 'prevent_n_damage_to_you',
    }];
  }
  const b18 = parseBatch18PreventAllSentence(s);
  return b18.length > 0 ? b18 : parseBatch19PreventAllSentence(s);
}

export function collectOraclePatternDamagePreventionSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield as any[]) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId) continue;
    const oracle = readCardOracleText(perm.card);
    if (!oracle || !/prevent/i.test(oracle)) continue;
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    const sentences = selfReferenceSentences(oracle, sourceName);
    sentences.forEach((sentence, i) => {
      for (const body of parseDamagePreventionSentence(sentence, sentences[i + 1])) {
        specs.push({ ...body, id: `${sourcePermanentId}:${body.effectId}`, sourcePermanentId, sourceController: String(perm.controller || '').trim(), sourceName });
      }
    });
  }
  return specs;
}

function findPermanent(state: unknown, id: string): any {
  if (!id || !state) return undefined;
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield) ? (state as { battlefield: any[] }).battlefield : [];
  return battlefield.find((p) => p && String(p.id || '').trim() === id);
}

function readColors(perm: any): string[] {
  const colors = Array.isArray(perm?.colors) ? perm.colors : perm?.card?.colors;
  return Array.isArray(colors) ? colors.map((c: unknown) => String(c).toUpperCase()) : [];
}

/** Extra damage-match fields; returns true when none apply. */
export function matchesDamagePreventionExtras(
  spec: ReplacementEffectSpec,
  input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; isCombatDamage?: boolean; targetPermanentId?: string },
  state?: unknown,
): boolean {
  const match = spec.match || {};
  const targetId = String(input.targetPermanentId || '').trim();
  const sourceId = String(spec.sourcePermanentId || '').trim();
  const sourceController = String(spec.sourceController || '');
  if (match.receivingPermanentIsSource === true && (!targetId || targetId !== sourceId)) return false;
  if (match.receivingIsPlayerOnly === true && targetId) return false;
  if (match.noncombatDamageOnly === true && input.isCombatDamage) return false;
  if (match.receivingPermanentIsEnchantedBySource === true) {
    const aura = findPermanent(state, sourceId);
    if (!targetId || !aura || String(aura.attachedTo || '').trim() !== targetId) return false;
  }
  if (match.damageSourceControllerIsOpponentOfSource === true) {
    const dealer = String(input.damageDealer || '');
    if (!dealer || dealer === sourceController) return false;
  }
  if (match.duringSourceControllerTurn === true) {
    const st = state as { turnPlayer?: unknown; activePlayer?: unknown } | undefined;
    const turnPlayer = String(st?.turnPlayer ?? st?.activePlayer ?? '').trim();
    if (!turnPlayer || turnPlayer !== sourceController) return false;
  }
  if ((spec.metadata as any)?.damageSourceBlockedBySource === true) {
    const self = findPermanent(state, sourceId);
    const blocking = Array.isArray(self?.blocking) ? self.blocking.map(String) : [];
    if (!blocking.includes(String(input.damageSourcePermanentId || '').trim())) return false;
  }
  const needsSource = match.damageSourceIsCreature === true || !!match.damageSourceColorIncludes;
  if (needsSource) {
    const dmgSource = findPermanent(state, String(input.damageSourcePermanentId || '').trim());
    if (!dmgSource) return false;
    if (match.damageSourceIsCreature === true
      && !String(dmgSource.card?.type_line || dmgSource.type_line || '').toLowerCase().includes('creature')) return false;
    if (match.damageSourceColorIncludes && !readColors(dmgSource).includes(String(match.damageSourceColorIncludes).toUpperCase())) return false;
  }
  if (!matchesBatch18PreventAll(spec, input, state)) return false;
  if (!matchesBatch19PreventAll(spec, input, state)) return false;
  return true;
}
