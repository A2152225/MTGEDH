import { getEffectivePower, resolveActivatedAbilityLineById } from '../../socket/util.js';
import {
  parseManaCost,
  stringifyParsedManaCost,
} from './mana-check.js';

export type TeamworkAdditionalCost = {
  readonly type: 'teamwork';
  readonly amount: number;
  readonly teamworkMinPower: number;
  readonly teamworkIsOptional: true;
};

export function detectTeamworkAdditionalCost(oracleText: string): TeamworkAdditionalCost | null {
  const match = String(oracleText || '').match(
    /\bTeamwork\s+(\d+)\s*\(\s*As an additional cost to cast this spell,\s*you may tap any number of creatures you control with total power (\d+) or more\.?\s*\)/i
  );
  if (!match) return null;
  const minPower = Number.parseInt(String(match[1] || match[2] || '0'), 10);
  if (!Number.isFinite(minPower) || minPower <= 0) return null;
  return {
    type: 'teamwork',
    amount: minPower,
    teamworkMinPower: minPower,
    teamworkIsOptional: true,
  };
}

export function spellOracleUsesTeamworkChooseBoth(oracleText: string): boolean {
  return /\bif this spell was cast using teamwork,\s*choose both instead\b/i.test(String(oracleText || ''));
}

export function sumSelectedCreaturesPower(
  battlefield: readonly any[],
  creatureIds: readonly string[],
  gameState?: any,
): number {
  let total = 0;
  for (const id of creatureIds) {
    const permanent = battlefield.find((entry) => entry && String(entry.id || '') === String(id));
    if (!permanent) continue;
    total += getEffectivePower(permanent, gameState);
  }
  return total;
}

export type PowerUpAbilityInfo = {
  readonly isPowerUp: true;
  readonly manaCost: string;
  readonly effectText: string;
};

export function parsePowerUpActivatedAbility(text: string): PowerUpAbilityInfo | null {
  const normalized = String(text || '').trim();
  const match = normalized.match(/^Power-up\s*[—-]\s*((?:\{[^}]+\})+)\s*:\s*(.+)$/i);
  if (!match) return null;
  return {
    isPowerUp: true,
    manaCost: String(match[1] || '').replace(/\s+/g, '').trim(),
    effectText: String(match[2] || '').trim(),
  };
}

export function isPowerUpAbilityLine(text: string): boolean {
  return /^Power-up\s*[—-]/i.test(String(text || '').trim());
}

function applyColorReduction1187(costAmount: number, reductionAmount: number): [number, number] {
  const applied = Math.min(Math.max(0, costAmount), Math.max(0, reductionAmount));
  return [Math.max(0, costAmount - applied), Math.max(0, reductionAmount - applied)];
}

/** Rule 118.7 — colored reductions apply to colored symbols; excess becomes generic reduction. */
export function applyManaCostReductionByManaCost(manaCost: string, reductionManaCost: string): string {
  const original = parseManaCost(manaCost);
  const reduction = parseManaCost(reductionManaCost);
  const colors = { ...original.colors };
  let excess = 0;

  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
    const [nextValue, colorExcess] = applyColorReduction1187(colors[color] || 0, reduction.colors[color] || 0);
    colors[color] = nextValue;
    excess += colorExcess;
  }

  const generic = Math.max(0, (original.generic || 0) - excess - (reduction.generic || 0));
  const stringified = stringifyParsedManaCost({
    colors,
    generic,
    hasX: original.hasX,
    hybrid: original.hybrids,
    hybrids: original.hybrids,
  });
  return stringified === '{0}' ? '' : stringified;
}

export function applyPowerUpEnteredThisTurnDiscount(
  manaCost: string,
  permanent: any,
): string {
  if (!(permanent as any)?.enteredThisTurn) return manaCost;
  const card = (permanent as any)?.card || permanent;
  const reductionCost = String(card?.mana_cost || '').trim();
  if (!reductionCost) {
    const manaValue = Number.parseInt(String(card?.cmc ?? card?.mana_value ?? ''), 10);
    if (!Number.isFinite(manaValue) || manaValue <= 0) return manaCost;
    return applyManaCostReductionByManaCost(manaCost, `{${manaValue}}`);
  }
  return applyManaCostReductionByManaCost(manaCost, reductionCost);
}

const POWER_UP_OTHER_REDUCTION_RE =
  /\bpower-up abilities of other creatures you control cost\s+((?:\{[^}]+\})+)\s+less to activate\b/i;

export function parsePowerUpOtherCreaturesCostReduction(text: string): string | null {
  const match = String(text || '').match(POWER_UP_OTHER_REDUCTION_RE);
  if (!match) return null;
  return String(match[1] || '').replace(/\s+/g, '').trim() || null;
}

function collectGrantTextsFromPermanent(permanent: any): string[] {
  const texts: string[] = [];
  const oracleText = String(permanent?.card?.oracle_text || '');
  for (const line of oracleText.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (trimmed) texts.push(trimmed);
  }
  for (const effect of Array.isArray(permanent?.staticAbilityGrantEffects) ? permanent.staticAbilityGrantEffects : []) {
    const raw = String(effect?.raw || '').trim();
    if (raw) texts.push(raw);
    for (const entry of Array.isArray(effect?.effectText) ? effect.effectText : []) {
      const trimmed = String(entry || '').trim();
      if (trimmed) texts.push(trimmed);
    }
    for (const entry of Array.isArray(effect?.abilities) ? effect.abilities : []) {
      const trimmed = String(entry || '').trim();
      if (trimmed) texts.push(trimmed);
    }
  }
  return texts;
}

export function collectPowerUpStaticCostReductions(
  state: any,
  controllerId: string,
  activatingPermanentId: string,
): string[] {
  const reductions: string[] = [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (String(permanent?.controller || '') !== String(controllerId || '')) continue;
    if (String(permanent?.id || '') === String(activatingPermanentId || '')) continue;
    for (const text of collectGrantTextsFromPermanent(permanent)) {
      const reduction = parsePowerUpOtherCreaturesCostReduction(text);
      if (reduction) reductions.push(reduction);
    }
  }

  for (const effect of Array.isArray(state?.staticAbilityGrantEffects) ? state.staticAbilityGrantEffects : []) {
    const effectController = String(effect?.controllerId || effect?.controller || '').trim();
    if (effectController && effectController !== String(controllerId || '')) continue;
    const texts = [
      String(effect?.raw || '').trim(),
      ...(Array.isArray(effect?.effectText) ? effect.effectText.map((entry: unknown) => String(entry || '').trim()) : []),
      ...(Array.isArray(effect?.abilities) ? effect.abilities.map((entry: unknown) => String(entry || '').trim()) : []),
    ].filter(Boolean);
    for (const text of texts) {
      const reduction = parsePowerUpOtherCreaturesCostReduction(text);
      if (reduction) reductions.push(reduction);
    }
  }

  return reductions;
}

export function applyPowerUpActivationCostReductions(
  manaCost: string,
  state: any,
  controllerId: string,
  activatingPermanentId: string,
): string {
  let adjusted = String(manaCost || '');
  for (const reduction of collectPowerUpStaticCostReductions(state, controllerId, activatingPermanentId)) {
    adjusted = applyManaCostReductionByManaCost(adjusted, reduction);
  }
  return adjusted;
}

export function stripPowerUpReminderParenthetical(text: string): string {
  return String(text || '')
    .replace(/\s*\(\s*Activate each power-up ability only once\.[^)]*\)\s*\.?\s*$/i, '')
    .trim();
}

export function getActivatedAbilityIndexFromAbilityId(abilityId: string): number {
  const match = String(abilityId || '').match(/-ability-(\d+)$/i);
  if (!match) return -1;
  const index = Number.parseInt(String(match[1] || ''), 10);
  return Number.isFinite(index) && index >= 0 ? index : -1;
}

export function hasUsedPowerUpAbility(permanent: any, abilityIndex: number): boolean {
  if (!Number.isInteger(abilityIndex) || abilityIndex < 0) return false;
  const used = (permanent as any)?.powerUpAbilitiesUsed;
  return Boolean(used && used[String(abilityIndex)] === true);
}

export function markPowerUpAbilityUsed(permanent: any, abilityIndex: number): void {
  if (!Number.isInteger(abilityIndex) || abilityIndex < 0) return;
  (permanent as any).powerUpAbilitiesUsed = {
    ...((permanent as any)?.powerUpAbilitiesUsed || {}),
    [String(abilityIndex)]: true,
  };
}

export type ResolvedPowerUpActivationPricing = {
  readonly powerUpAbilityIndex: number;
  readonly discountedManaCost: string;
  readonly effectText: string;
};

function resolvePowerUpAbilityLineText(
  permanent: any,
  activatedAbilityText?: string,
  abilityId?: string,
): string | null {
  const activated = stripPowerUpReminderParenthetical(String(activatedAbilityText || '').trim());
  if (activated && parsePowerUpActivatedAbility(activated)) {
    return activated;
  }

  const resolved = resolveActivatedAbilityLineById(permanent, String(abilityId || '').trim());
  if (resolved?.lineText && isPowerUpAbilityLine(resolved.lineText)) {
    return stripPowerUpReminderParenthetical(resolved.lineText);
  }

  return null;
}

function inferPowerUpAbilityIndexFromOracle(permanent: any, lineText: string, effectText: string): number {
  const oracleText = String(permanent?.card?.oracle_text || '');
  let powerUpIndex = 0;
  for (const rawLine of oracleText.split(/\r?\n/)) {
    const trimmed = stripPowerUpReminderParenthetical(String(rawLine || '').trim());
    if (!isPowerUpAbilityLine(trimmed)) continue;
    const parsed = parsePowerUpActivatedAbility(trimmed);
    if (trimmed === lineText || parsed?.effectText === effectText) {
      return powerUpIndex;
    }
    powerUpIndex += 1;
  }
  return -1;
}

export function resolvePowerUpActivationPricing(
  permanent: any,
  state: any,
  controllerId: string,
  options: { activatedAbilityText?: string; abilityId?: string },
): ResolvedPowerUpActivationPricing | null {
  const lineText = resolvePowerUpAbilityLineText(
    permanent,
    options.activatedAbilityText,
    options.abilityId,
  );
  if (!lineText) return null;

  const info = parsePowerUpActivatedAbility(lineText);
  if (!info) return null;

  let powerUpAbilityIndex = getActivatedAbilityIndexFromAbilityId(String(options.abilityId || ''));
  if (powerUpAbilityIndex < 0) {
    powerUpAbilityIndex = inferPowerUpAbilityIndexFromOracle(permanent, lineText, info.effectText);
  }
  if (powerUpAbilityIndex < 0) return null;

  let discountedManaCost = applyPowerUpEnteredThisTurnDiscount(info.manaCost, permanent);
  discountedManaCost = applyPowerUpActivationCostReductions(
    discountedManaCost,
    state,
    controllerId,
    String(permanent?.id || ''),
  );

  return {
    powerUpAbilityIndex,
    discountedManaCost,
    effectText: info.effectText,
  };
}

export function applyPowerUpDiscountsToActivationManaCost(
  manaCost: string,
  permanent: any,
  state: any,
  controllerId: string,
  options: { activatedAbilityText?: string; abilityId?: string },
): string {
  const pricing = resolvePowerUpActivationPricing(permanent, state, controllerId, options);
  return pricing?.discountedManaCost ?? String(manaCost || '');
}

export function maybeMarkPowerUpAbilityUsedFromActivationContext(
  game: any,
  controllerId: string,
  permanentId: string,
  options: { activatedAbilityText?: string; abilityId?: string },
): void {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
  if (!permanent || String(permanent.controller || '') !== String(controllerId)) return;

  const pricing = resolvePowerUpActivationPricing(permanent, game.state, controllerId, options);
  if (!pricing || hasUsedPowerUpAbility(permanent, pricing.powerUpAbilityIndex)) return;
  markPowerUpAbilityUsed(permanent, pricing.powerUpAbilityIndex);
}
