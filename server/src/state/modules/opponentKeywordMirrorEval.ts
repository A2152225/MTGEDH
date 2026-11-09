// server/src/state/modules/opponentKeywordMirrorEval.ts
// B61: evaluate opponent_controls_creature_with_keyword_excluding_name (Escaped Shapeshifter).
// Public entry symbols: opponentControlsCreatureWithKeywordExcludingName.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { permanentHasKeywordAbility } from '../../../../rules-engine/src/permanentKeywordAbilities.js';

function normName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function creatureHasProtectionFromAnyColor(permanent: any): boolean {
  const lists = [permanent?.keywords, permanent?.card?.keywords, permanent?.grantedAbilities];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    if (list.some((entry: unknown) => /protection from any colou?r/i.test(String(entry || '')))) return true;
  }
  const oracle = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  return /\bprotection from any colou?r\b/i.test(oracle);
}

export function opponentControlsCreatureWithKeywordExcludingName(
  condition: { keyword?: string; excludedName?: string; option?: string },
  sourceController: string,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  const controller = String(sourceController || '').trim();
  if (!controller) return false;
  const keyword = String(condition.keyword || '').trim().toLowerCase();
  const excluded = normName(condition.excludedName);
  const wantAnyColorProt = /protection from any colou?r/i.test(String(condition.option || ''));
  if (!keyword) return false;

  return (Array.isArray(battlefield) ? battlefield : []).some((perm: any) => {
    if (!perm || perm.phasedOut) return false;
    if (String(perm.controller || '') === controller) return false;
    const tl = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
    if (!/\bcreature\b/.test(tl)) return false;
    if (excluded && normName(perm.card?.name || perm.name) === excluded) return false;
    if (wantAnyColorProt) return creatureHasProtectionFromAnyColor(perm);
    return permanentHasKeywordAbility(perm, keyword);
  });
}
