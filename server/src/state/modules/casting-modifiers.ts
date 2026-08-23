import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { parseManaCost } from './mana-check.js';
import { cardHasCreatureType } from '../creatureTypeNow.js';
import { parseNextChosenTypeSpellFlashGrant } from './chosen-creature-type.js';
import { getActiveNextSpellCostReduction } from './nextSpellCostReduction.js';

export type ConvokeGrantScope =
  | 'next_spell_this_turn'
  | 'all_spells'
  | 'creature_spells'
  | 'artifact_spells'
  | 'noncreature_spells_from_exile'
  | 'first_historic_this_turn';

export interface ConvokeGrant {
  id: string;
  controllerId: PlayerID;
  scope: ConvokeGrantScope;
  sourceName?: string;
  turnApplied: number;
  used?: boolean;
}

export interface MiracleGrant {
  controllerId: PlayerID;
  sourceName: string;
  typeLineIncludes: string;
  genericReduction: number;
}

export interface ChosenTypeFlashGrant {
  controllerId: PlayerID;
  chosenType: string;
  sourceName?: string;
  turnApplied: number;
  used?: boolean;
}

const GRANTS_CONVOKE_ON_OTHER_SPELLS_PATTERNS = [
  /the next spell you cast[^.]*has convoke/i,
  /spells you cast[^.]*have convoke/i,
  /creature spells you cast[^.]*have convoke/i,
  /noncreature spells you cast from exile have convoke/i,
  /whenever[^.]*cast[^.]*convoke/i,
  /nontoken creatures you control[^.]*have[^.]*convoke/i,
  /the first historic spell you cast each turn has convoke/i,
];

const NATIVE_CONVOKE_KEYWORD_PATTERN = /(?:^|\.|\n)\s*convoke(?:\s*\(|$|\s)/i;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function getCardTypeLine(card: any): string {
  return normalizeText(card?.type_line || card?.typeLine).toLowerCase();
}

function isHistoricCard(card: any): boolean {
  const typeLine = getCardTypeLine(card);
  return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
}

function isSpellCard(card: any): boolean {
  const typeLine = getCardTypeLine(card);
  if (typeLine.includes('land')) return false;
  if (
    typeLine.includes('instant')
    || typeLine.includes('sorcery')
    || typeLine.includes('creature')
    || typeLine.includes('artifact')
    || typeLine.includes('enchantment')
    || typeLine.includes('planeswalker')
    || typeLine.includes('battle')
  ) {
    return true;
  }
  return Boolean(normalizeText(card?.mana_cost || card?.manaCost));
}

export function cardGrantsConvokeToOtherSpells(card: any): boolean {
  const oracleText = normalizeText(card?.oracle_text || card?.oracleText);
  if (!oracleText.toLowerCase().includes('convoke')) return false;
  return GRANTS_CONVOKE_ON_OTHER_SPELLS_PATTERNS.some((pattern) => pattern.test(oracleText));
}

export function cardHasNativeConvokeKeyword(card: any): boolean {
  const oracleText = normalizeText(card?.oracle_text || card?.oracleText);
  if (!oracleText.toLowerCase().includes('convoke')) return false;
  if (cardGrantsConvokeToOtherSpells(card)) return false;
  return NATIVE_CONVOKE_KEYWORD_PATTERN.test(oracleText);
}

function getConvokeGrants(state: any): ConvokeGrant[] {
  return Array.isArray(state?.convokeGrants) ? state.convokeGrants : [];
}

function setConvokeGrants(state: any, grants: ConvokeGrant[]): void {
  state.convokeGrants = grants;
}

export function grantNextSpellConvoke(
  state: any,
  controllerId: PlayerID,
  sourceName?: string,
): void {
  const turnApplied = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const grants = getConvokeGrants(state);
  grants.push({
    id: `convoke:${String(controllerId)}:${turnApplied}:${grants.length}`,
    controllerId,
    scope: 'next_spell_this_turn',
    sourceName,
    turnApplied,
    used: false,
  });
  setConvokeGrants(state, grants);
}

export type DelayedAffinitySpellFilter = 'any' | 'noncreature';

export function grantNextSpellAffinityForArtifacts(
  state: any,
  controllerId: PlayerID,
  sourceName?: string,
  options?: { spellFilter?: DelayedAffinitySpellFilter },
): void {
  const turnApplied = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  state.delayedAffinityForArtifactsNextCast = Array.isArray(state.delayedAffinityForArtifactsNextCast)
    ? state.delayedAffinityForArtifactsNextCast
    : [];
  state.delayedAffinityForArtifactsNextCast.push({
    kind: 'affinity_for_artifacts',
    controllerId,
    turnApplied,
    sourceName,
    used: false,
    spellFilter: options?.spellFilter || 'any',
  });
}

function historicSpellsCastThisTurn(state: any, playerId: PlayerID): number {
  const spells = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
  return spells.filter((entry: any) => {
    if (String(entry?.casterId || '') !== String(playerId || '')) return false;
    const card = entry?.card || entry;
    return isHistoricCard(card);
  }).length;
}

function matchesConvokeGrantScope(
  scope: ConvokeGrantScope,
  card: any,
  castSourceZone?: string,
  state?: any,
  playerId?: PlayerID,
): boolean {
  const typeLine = getCardTypeLine(card);
  switch (scope) {
    case 'next_spell_this_turn':
    case 'all_spells':
      return true;
    case 'creature_spells':
      return typeLine.includes('creature');
    case 'artifact_spells':
      return typeLine.includes('artifact');
    case 'noncreature_spells_from_exile':
      return castSourceZone === 'exile' && !typeLine.includes('creature');
    case 'first_historic_this_turn':
      return isHistoricCard(card) && historicSpellsCastThisTurn(state, playerId as PlayerID) === 0;
    default:
      return false;
  }
}

function getStaticConvokeGrantScopesFromBattlefield(
  state: any,
  playerId: PlayerID,
  card: any,
  castSourceZone?: string,
): Array<{ scope: ConvokeGrantScope; sourceName: string }> {
  const scopes: Array<{ scope: ConvokeGrantScope; sourceName: string }> = [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(playerId || '')) continue;
    const oracleText = normalizeText(perm?.card?.oracle_text || perm?.card?.oracleText);
    const sourceName = normalizeText(perm?.card?.name || 'Permanent') || 'Permanent';
    if (!oracleText.toLowerCase().includes('convoke')) continue;

    if (/spells you cast have convoke/i.test(oracleText) && !/creature spells you cast/i.test(oracleText) && !/artifact spells you cast/i.test(oracleText)) {
      scopes.push({ scope: 'all_spells', sourceName });
    }
    if (/creature spells you cast have convoke/i.test(oracleText)) {
      scopes.push({ scope: 'creature_spells', sourceName });
    }
    if (/artifact spells you cast have convoke/i.test(oracleText)) {
      scopes.push({ scope: 'artifact_spells', sourceName });
    }
    if (/noncreature spells you cast from exile have convoke/i.test(oracleText)) {
      scopes.push({ scope: 'noncreature_spells_from_exile', sourceName });
    }
    if (/the first historic spell you cast each turn has convoke/i.test(oracleText)) {
      scopes.push({ scope: 'first_historic_this_turn', sourceName });
    }
  }

  return scopes.filter((entry) => matchesConvokeGrantScope(entry.scope, card, castSourceZone, state, playerId));
}

export function getActiveConvokeGrantSources(
  state: any,
  playerId: PlayerID,
  card: any,
  castSourceZone?: string,
): string[] {
  if (!card || !isSpellCard(card)) return [];

  const sources = new Set<string>();
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;

  if (cardHasNativeConvokeKeyword(card)) {
    sources.add(String(card?.name || 'This spell'));
  }

  for (const grant of getConvokeGrants(state)) {
    if (String(grant.controllerId || '') !== String(playerId || '')) continue;
    if (grant.used === true) continue;
    if (grant.scope === 'next_spell_this_turn' && grant.turnApplied !== currentTurn) continue;
    if (!matchesConvokeGrantScope(grant.scope, card, castSourceZone, state, playerId)) continue;
    sources.add(String(grant.sourceName || 'Granted convoke'));
  }

  for (const entry of getStaticConvokeGrantScopesFromBattlefield(state, playerId, card, castSourceZone)) {
    sources.add(entry.sourceName);
  }

  return [...sources];
}

export function spellHasConvokeForCast(
  state: any,
  playerId: PlayerID,
  card: any,
  castSourceZone?: string,
): boolean {
  return getActiveConvokeGrantSources(state, playerId, card, castSourceZone).length > 0;
}

export function consumeConvokeGrantsAfterCast(
  state: any,
  playerId: PlayerID,
  card: any,
  castSourceZone?: string,
): void {
  if (!spellHasConvokeForCast(state, playerId, card, castSourceZone)) return;

  const grants = getConvokeGrants(state).map((grant) => {
    if (String(grant.controllerId || '') !== String(playerId || '')) return grant;
    if (grant.scope !== 'next_spell_this_turn' || grant.used === true) return grant;
    if (!matchesConvokeGrantScope(grant.scope, card, castSourceZone, state, playerId)) return grant;
    return { ...grant, used: true };
  });
  setConvokeGrants(state, grants);
}

export function getMiracleGrantsFromBattlefield(state: any, playerId: PlayerID): MiracleGrant[] {
  const grants: MiracleGrant[] = [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(playerId || '')) continue;
    const oracleText = normalizeText(perm?.card?.oracle_text || perm?.card?.oracleText);
    const sourceName = normalizeText(perm?.card?.name || 'Permanent') || 'Permanent';
    if (!oracleText.toLowerCase().includes('miracle')) continue;

    const eachTypeMatch = oracleText.match(/each\s+([a-z]+)\s+card(?:s)?\s+in\s+your\s+hand\s+has\s+miracle/i);
    if (!eachTypeMatch) continue;

    const reductionMatch = oracleText.match(/miracle cost is equal to its mana cost reduced by \{(\d+)\}/i)
      || oracleText.match(/miracle cost is equal to its mana cost reduced by (\d+)/i);
    const genericReduction = reductionMatch ? Math.max(0, Number(reductionMatch[1] || 0)) : 0;

    grants.push({
      controllerId: playerId,
      sourceName,
      typeLineIncludes: String(eachTypeMatch[1] || '').trim().toLowerCase(),
      genericReduction,
    });
  }

  return grants;
}

function buildReducedMiracleCost(manaCost: string, genericReduction: number): string | null {
  const parsed = parseManaCost(manaCost);
  if (!parsed) return null;

  let remaining = Math.max(0, parsed.generic - genericReduction);
  const parts: string[] = [];
  if (remaining > 0) parts.push(`{${remaining}}`);
  for (const [symbol, count] of Object.entries(parsed.colors || {})) {
    const amount = Number(count || 0);
    for (let i = 0; i < amount; i++) parts.push(`{${symbol}}`);
  }
  for (const hybrid of parsed.hybrid || []) {
    if (Array.isArray(hybrid) && hybrid.length > 0) {
      parts.push(`{${hybrid.join('/')}}`);
    }
  }
  if (parsed.hasX) parts.unshift('{X}');
  return parts.length > 0 ? parts.join('') : '{0}';
}

export function getMiracleCastInfo(
  state: any,
  playerId: PlayerID,
  card: any,
): { hasMiracle: boolean; miracleCost: string | null; source: 'native' | 'granted' | null; sourceName?: string } {
  if (!card) return { hasMiracle: false, miracleCost: null, source: null };

  const oracleText = normalizeText(card?.oracle_text || card?.oracleText);
  if (oracleText.toLowerCase().includes('miracle')) {
    const miracleMatch = oracleText.match(/miracle[—–\s]*(\{[^}]+\}(?:\{[^}]+\})*)/i)
      || oracleText.match(/miracle\s+(\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\}(?:\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\})*)/i);
    if (miracleMatch?.[1]) {
      return { hasMiracle: true, miracleCost: miracleMatch[1], source: 'native', sourceName: String(card?.name || '') };
    }
    if (/\bmiracle\b/i.test(oracleText)) {
      return { hasMiracle: true, miracleCost: null, source: 'native', sourceName: String(card?.name || '') };
    }
  }

  const manaCost = normalizeText(card?.mana_cost || card?.manaCost);
  for (const grant of getMiracleGrantsFromBattlefield(state, playerId)) {
    const typeLine = getCardTypeLine(card);
    if (!typeLine.includes(grant.typeLineIncludes)) continue;
    if (!manaCost) continue;
    const miracleCost = buildReducedMiracleCost(manaCost, grant.genericReduction);
    if (!miracleCost) continue;
    return {
      hasMiracle: true,
      miracleCost,
      source: 'granted',
      sourceName: grant.sourceName,
    };
  }

  return { hasMiracle: false, miracleCost: null, source: null };
}

export function getDynamicBattlefieldCostReduction(
  state: any,
  playerId: PlayerID,
  card: any,
): { generic: number; colors: Record<string, number>; messages: string[] } {
  const reduction = {
    generic: 0,
    colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } as Record<string, number>,
    messages: [] as string[],
  };

  if (!card) return reduction;

  const deferredNextSpell = getActiveNextSpellCostReduction(state, playerId);
  if (deferredNextSpell > 0) {
    reduction.generic += deferredNextSpell;
    reduction.messages.push(`Next-spell cost reduction: -{${deferredNextSpell}}`);
  }

  const cardTypeLineValue = getCardTypeLine(card);
  const isCreature = cardTypeLineValue.includes('creature');
  const isInstant = cardTypeLineValue.includes('instant');
  const isSorcery = cardTypeLineValue.includes('sorcery');
  const isArtifact = cardTypeLineValue.includes('artifact');
  const isEnchantment = cardTypeLineValue.includes('enchantment');
  const isPlaneswalker = cardTypeLineValue.includes('planeswalker');
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const lifeGained = Math.max(0, Number(state?.lifeGainedThisTurn?.[playerId] || 0));

  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(playerId || '')) continue;
    const permOracle = normalizeText(perm?.card?.oracle_text || perm?.card?.oracleText).toLowerCase();
    const permName = normalizeText(perm?.card?.name || 'Permanent');

    const lifeGainedReductionMatch = permOracle.match(
      /(creature|instant|sorcery|artifact|enchantment|planeswalker|historic|\w+) spells you cast cost \{x\} less to cast, where x is the amount of life you gained this turn/i,
    );
    if (lifeGainedReductionMatch && lifeGained > 0) {
      const scope = String(lifeGainedReductionMatch[1] || '').trim().toLowerCase();
      const matchesScope =
        scope === 'creature' ? isCreature
        : scope === 'instant' ? isInstant
        : scope === 'sorcery' ? isSorcery
        : scope === 'artifact' ? isArtifact
        : scope === 'enchantment' ? isEnchantment
        : scope === 'planeswalker' ? isPlaneswalker
        : scope === 'historic' ? isHistoricCard(card)
        : true;
      if (matchesScope) {
        reduction.generic += lifeGained;
        reduction.messages.push(`${permName}: -{${lifeGained}} (life gained this turn)`);
      }
    }
  }

  const delayedAffinity = Array.isArray(state?.delayedAffinityForArtifactsNextCast)
    ? state.delayedAffinityForArtifactsNextCast
    : [];
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  for (const entry of delayedAffinity) {
    if (String(entry?.controllerId || '') !== String(playerId || '')) continue;
    if (entry?.used === true) continue;
    if (Number(entry?.turnApplied || 0) !== currentTurn) continue;
    const spellFilter = String(entry?.spellFilter || 'any').trim().toLowerCase();
    if (spellFilter === 'noncreature' && isCreature) continue;

    const artifactCount = battlefield.filter((p: any) =>
      p && String(p.controller || '') === String(playerId || '')
      && getCardTypeLine(p?.card).includes('artifact'),
    ).length;
    if (artifactCount > 0) {
      reduction.generic += artifactCount;
      reduction.messages.push(`${String(entry?.sourceName || 'Granted affinity')}: -{${artifactCount}} (affinity for artifacts)`);
      entry.used = true;
    }
  }

  return reduction;
}

function getChosenTypeFlashGrants(state: any): ChosenTypeFlashGrant[] {
  return Array.isArray(state?.chosenTypeFlashGrants) ? state.chosenTypeFlashGrants : [];
}

function setChosenTypeFlashGrants(state: any, grants: ChosenTypeFlashGrant[]): void {
  state.chosenTypeFlashGrants = grants;
}

export function grantNextChosenTypeSpellFlash(
  state: any,
  controllerId: PlayerID,
  chosenType: string,
  sourceName?: string,
): void {
  const normalizedType = String(chosenType || '').trim().toLowerCase();
  if (!normalizedType) return;
  const turnApplied = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const grants = getChosenTypeFlashGrants(state);
  grants.push({
    controllerId,
    chosenType: normalizedType,
    sourceName,
    turnApplied,
    used: false,
  });
  setChosenTypeFlashGrants(state, grants);
}

export function spellHasChosenTypeFlashGrant(
  state: any,
  playerId: PlayerID,
  card: any,
): boolean {
  const grants = getChosenTypeFlashGrants(state).filter((grant) => {
    if (String(grant.controllerId || '') !== String(playerId || '')) return false;
    if (grant.used === true) return false;
    if (!grant.chosenType) return false;
    return cardHasCreatureType(card, grant.chosenType);
  });
  return grants.length > 0;
}

export function consumeChosenTypeFlashGrantsAfterCast(
  state: any,
  playerId: PlayerID,
  card: any,
): void {
  if (!spellHasChosenTypeFlashGrant(state, playerId, card)) return;
  const grants = getChosenTypeFlashGrants(state).map((grant) => {
    if (String(grant.controllerId || '') !== String(playerId || '')) return grant;
    if (grant.used === true) return grant;
    if (!grant.chosenType || !cardHasCreatureType(card, grant.chosenType)) return grant;
    return { ...grant, used: true };
  });
  setChosenTypeFlashGrants(state, grants);
}

function rebuildCastingModifierTextFromGrantStep(step: OracleEffectStep): string {
  const raw = normalizeText(step.raw);
  if (raw) return raw;

  if (step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability') {
    return '';
  }

  const targetText = 'text' in step.target
    ? normalizeText(step.target.text)
    : '';
  const abilities = 'abilities' in step && Array.isArray(step.abilities)
    ? step.abilities.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const effectText = 'effectText' in step && Array.isArray(step.effectText)
    ? step.effectText.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const clauses = [...abilities, ...effectText];
  if (!targetText || clauses.length === 0) return '';

  if (/^the next\b/i.test(targetText) && clauses.some((clause) => /convoke/i.test(clause))) {
    return `${targetText} has convoke`;
  }
  if (/^the next\b/i.test(targetText) && clauses.some((clause) => /affinity for artifacts/i.test(clause))) {
    return `${targetText} has affinity for artifacts`;
  }
  if (/^the next\b/i.test(targetText) && clauses.some((clause) => /cast as though it had flash/i.test(clause))) {
    return `${targetText} can be cast as though it had flash`;
  }

  return '';
}

export function collectCastingModifierGrantTexts(
  appliedSteps: readonly OracleEffectStep[] | undefined,
  state: any,
): string[] {
  const texts = new Set<string>();

  for (const step of appliedSteps || []) {
    const raw = normalizeText(step.raw);
    if (raw) texts.add(raw);
    const rebuilt = rebuildCastingModifierTextFromGrantStep(step);
    if (rebuilt) texts.add(rebuilt);
  }

  for (const effect of Array.isArray(state?.staticAbilityGrantEffects) ? state.staticAbilityGrantEffects : []) {
    const raw = normalizeText(effect?.raw);
    if (raw) texts.add(raw);
    const rebuilt = rebuildCastingModifierTextFromGrantStep({
      kind: 'grant_static_ability',
      raw,
      target: effect?.target,
      abilities: effect?.abilities,
      effectText: effect?.effectText,
    } as OracleEffectStep);
    if (rebuilt) texts.add(rebuilt);
  }

  return [...texts];
}

export function syncCastingModifierGrantsFromOracleIRResult(
  state: any,
  controllerId: PlayerID,
  sourceName: string | undefined,
  result: { appliedSteps?: readonly OracleEffectStep[] },
  triggerItem?: any,
): number {
  let applied = 0;
  for (const text of collectCastingModifierGrantTexts(result.appliedSteps, state)) {
    if (tryApplyCastingModifierGrantsFromText(state, controllerId, text, sourceName, triggerItem)) {
      applied += 1;
    }
  }
  return applied;
}

export function tryApplyCastingModifierGrantsFromText(
  state: any,
  controllerId: PlayerID,
  text: string,
  sourceName?: string,
  triggerItem?: any,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  if (/the next spell you cast this turn has convoke/i.test(normalized)) {
    grantNextSpellConvoke(state, controllerId, sourceName);
    return true;
  }

  if (/the next noncreature spell you cast this turn has affinity for artifacts/i.test(normalized)) {
    grantNextSpellAffinityForArtifacts(state, controllerId, sourceName, { spellFilter: 'noncreature' });
    return true;
  }

  if (/the next spell you cast this turn has affinity for artifacts/i.test(normalized)) {
    grantNextSpellAffinityForArtifacts(state, controllerId, sourceName);
    return true;
  }

  if (parseNextChosenTypeSpellFlashGrant(normalized)) {
    const sourcePermanentId = String(triggerItem?.source || triggerItem?.permanentId || '').trim();
    const sourcePermanent = (state?.battlefield || []).find(
      (perm: any) => perm && String(perm.id || '') === sourcePermanentId,
    );
    const chosenType = String(
      sourcePermanent?.chosenCreatureType || triggerItem?.chosenCreatureType || '',
    ).trim();
    if (!chosenType) return false;
    grantNextChosenTypeSpellFlash(state, controllerId, chosenType, sourceName);
    return true;
  }

  return false;
}

export function resetConvokeGrantsForNewTurn(state: any, currentTurn: number): void {
  const grants = getConvokeGrants(state).filter((grant) => {
    if (grant.scope !== 'next_spell_this_turn') return true;
    return Number(grant.turnApplied || 0) >= currentTurn;
  });
  setConvokeGrants(state, grants);

  if (Array.isArray(state?.delayedAffinityForArtifactsNextCast)) {
    state.delayedAffinityForArtifactsNextCast = state.delayedAffinityForArtifactsNextCast.filter(
      (entry: any) => Number(entry?.turnApplied || 0) >= currentTurn,
    );
  }

  const flashGrants = getChosenTypeFlashGrants(state).filter(
    (grant) => Number(grant.turnApplied || 0) >= currentTurn,
  );
  setChosenTypeFlashGrants(state, flashGrants);
}
