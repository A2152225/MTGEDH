// server/src/state/modules/staticCastingRestrictionsOracleExtras.ts
// Battlefield casting limits not covered by rules-engine canCastSpell:
// Dromoka / Kutzil "your opponents can't cast spells during your turn",
// Marisi "during combat", Moderation / Arcane Laboratory / Fires of Invention
// per-turn caps (each player / your opponents / you, optional "noncreature").
// Public entry symbols: findOracleCastingLimitViolation.

import { selfCastProhibitionReason } from './playerActionProhibitions.js'; // B34
import { firstTurnsCastViolation } from './firstTurnsCastRestriction.js';
import { castOnlyIfCastAnotherViolation } from './castOnlyIfCastAnotherRestriction.js';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCount(raw: string): number {
  const text = String(raw || '').trim().toLowerCase();
  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  return NUMBER_WORDS[text] || 0;
}

function oracleOf(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function isCreatureTypeLine(typeLine: unknown): boolean {
  return /\bcreature\b/i.test(String(typeLine || ''));
}

function spellsCastBy(state: any, playerId: string, noncreatureOnly: boolean): number {
  const list = state?.spellsCastThisTurn;
  if (!Array.isArray(list)) {
    if (noncreatureOnly) return Number(state?.noncreatureSpellsCastThisTurn?.[playerId] || 0);
    return Number(list?.[playerId] || 0) || 0;
  }
  return list.filter((entry: any) => {
    const caster = String(entry?.casterId ?? entry?.playerId ?? entry?.controllerId ?? '');
    if (caster !== playerId) return false;
    if (!noncreatureOnly) return true;
    return !isCreatureTypeLine(entry?.card?.type_line ?? entry?.type_line);
  }).length;
}

function isCombatPhase(state: any): boolean {
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toLowerCase();
  return phase === 'combat' || /^(?:begin_?combat|declare_?attackers|declare_?blockers|(?:first_?strike_?)?combat_?damage|end_?combat|begincombat|declareattackers|declareblockers|combatdamage|endcombat)$/.test(step);
}

const CAP_RE = /\b(each player|your opponents|each opponent|you) can't cast more than (\w+) (noncreature )?spells? each turn/g;
const CAP_NO_MORE_RE = /\byou can cast no more than (\w+) (noncreature )?spells? each turn/g;

export function findOracleCastingLimitViolation(
  state: any,
  playerId: string,
  spell: any,
): { prohibited: boolean; reason?: string } {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const pid = String(playerId || '');
  if (!pid) return { prohibited: false };
  const firstTurns = firstTurnsCastViolation(state, pid, spell);
  if (firstTurns) return { prohibited: true, reason: firstTurns };
  const castAnother = castOnlyIfCastAnotherViolation(state, pid, spell);
  if (castAnother) return { prohibited: true, reason: castAnother };
  const b34SelfCast = selfCastProhibitionReason(battlefield, pid, spell); // B34
  if (b34SelfCast) return { prohibited: true, reason: b34SelfCast };
  const spellTypeLine = spell?.type_line ?? spell?.card?.type_line ?? spell?.typeLine;
  const spellIsCreature = isCreatureTypeLine(spellTypeLine);
  const turnPlayer = String(state?.turnPlayer ?? state?.activePlayer ?? '');

  for (const perm of battlefield) {
    const controller = String(perm?.controller || '');
    if (!controller) continue;
    const oracle = oracleOf(perm);
    if (!oracle.includes("cast")) continue;
    const name = perm?.card?.name || 'A permanent';
    const isOpponent = controller !== pid;

    if (isOpponent && turnPlayer === controller && /\byour opponents can't cast spells during your turn\b/.test(oracle)) {
      return { prohibited: true, reason: `${name} prevents casting spells during its controller's turn.` };
    }
    if (isOpponent && isCombatPhase(state) && /\byour opponents can't cast spells during combat\b/.test(oracle)) {
      return { prohibited: true, reason: `${name} prevents casting spells during combat.` };
    }

    const caps: Array<{ who: string; n: number; noncreature: boolean }> = [];
    for (const m of oracle.matchAll(CAP_RE)) caps.push({ who: m[1], n: parseCount(m[2]), noncreature: !!m[3] });
    for (const m of oracle.matchAll(CAP_NO_MORE_RE)) caps.push({ who: 'you', n: parseCount(m[1]), noncreature: !!m[2] });
    for (const cap of caps) {
      if (!cap.n) continue;
      const applies = cap.who === 'each player' || (cap.who === 'you' ? !isOpponent : isOpponent);
      if (!applies) continue;
      if (cap.noncreature && spellIsCreature) continue;
      if (spellsCastBy(state, pid, cap.noncreature) >= cap.n) {
        return {
          prohibited: true,
          reason: `${name} limits casting to ${cap.n} ${cap.noncreature ? 'noncreature ' : ''}spell${cap.n === 1 ? '' : 's'} each turn.`,
        };
      }
    }
  }
  return { prohibited: false };
}
