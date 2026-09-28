/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: resolving and validating the mana sources a cast-spell payment
 * names - which permanent an item refers to, what its activation cost is, what
 * mana it produced, floating-pool bookkeeping, and the payment checkpoint used to
 * roll a partially paid cast back.
 *
 * Public entry symbols: getFloatingPaymentPoolKey, resolveSpellPaymentPermanentId,
 * validateCastSpellPaymentPermanentUsage, getPaymentActivationCostInfo,
 * getSupportedPaymentActivationManaCost, resolvePaymentManaAbilityActivationCost,
 * paymentManaAbilityGrantsCreatureSpellHasteUntilEndOfTurn,
 * snapshotCastSpellManaPool, getPaymentItemProducedManaTotals,
 * addCastSpellManaTotals, calculateCastSpellPaymentManaDelta,
 * consumeExplicitSelectedCastSpellMana, restorePlayerCastSpellPaymentCheckpoint,
 * normalizeParsedSpellCostForAnyTypeManaSpending, cardCanSpendManaAsAnyType,
 * paymentSacrificeCandidateMatches, CAST_SPELL_PAYMENT_MANA_KEYS.
 */
import { type PaymentItem, parseSacrificeCost } from "../../../../shared/src/index.js";
import {
  MANA_COLOR_NAMES,
  type RestrictedManaSpendPurpose,
  canUseRestrictedMana,
  consumeManaFromPool,
  getFloatingPaymentPoolColorKey,
  getManaEntryColor,
  getOrInitManaPool,
  parseFloatingPaymentPermanentId,
  parseManaCost,
  resolveActivatedAbilityLineById,
  validateManaPayment,
} from "../util";
import { reserveCastSpellPaymentPermanentId } from "../castSpellPaymentSelectionUtils.js";
import { resolveGroupedPermanentRef } from "../tokenGroupResolve.js";

export function getFloatingPaymentPoolKey(permanentId: string, mana: string, pool?: any): string | null {
  return getFloatingPaymentPoolColorKey(permanentId, mana, pool);
}

function getTappedPaymentPermanentIds(payment?: PaymentItem[]): string[] {
  if (!Array.isArray(payment) || payment.length === 0) return [];

  return Array.from(
    new Set(
      payment
        .map((item) => ({
          permanentId: String(item?.permanentId || '').trim(),
          mana: String(item?.mana || '').trim(),
        }))
        .filter((item) => item.permanentId.length > 0 && !getFloatingPaymentPoolKey(item.permanentId, item.mana))
        .map((item) => item.permanentId)
    )
  );
}

function escapeRegExpForPaymentCost(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paymentActivationCostSelfSacrificesSource(permanent: any, activationCost?: string | null): boolean {
  const normalizedCost = String(activationCost || '').trim();
  if (!/\bsacrifice\b/i.test(normalizedCost)) return false;
  const lowerCost = normalizedCost.toLowerCase();
  if (lowerCost.includes('sacrifice ~') || lowerCost.includes('sacrifice this')) {
    return true;
  }

  const cardName = String(permanent?.card?.name || '').trim();
  if (!cardName) {
    return false;
  }

  return new RegExp(`\\bsacrifice\\s+${escapeRegExpForPaymentCost(cardName)}\\b`, 'i').test(normalizedCost);
}

export function getPaymentActivationCostInfo(permanent: any, activationCost?: string | null): {
  taps: boolean;
  selfSacrifices: boolean;
  sacrificeRequirement?: ReturnType<typeof parseSacrificeCost>;
} {
  const normalizedCost = String(activationCost || '').trim();
  const taps = /\{t\}/i.test(normalizedCost);
  const sacrificeInfo = parseSacrificeCost(normalizedCost);
  const selfSacrifices = paymentActivationCostSelfSacrificesSource(permanent, normalizedCost)
    || sacrificeInfo.sacrificeType === 'self';
  if (!sacrificeInfo.requiresSacrifice || !sacrificeInfo.sacrificeType) {
    if (selfSacrifices) {
      return { taps, selfSacrifices: true };
    }
    return { taps, selfSacrifices: false };
  }

  return {
    taps,
    selfSacrifices,
    sacrificeRequirement: sacrificeInfo,
  };
}


export function getSupportedPaymentActivationManaCost(activationCost?: string | null): ReturnType<typeof parseManaCost> | undefined {
  const normalizedCost = String(activationCost || '').trim();
  if (!normalizedCost) return undefined;

  const parsedCost = parseManaCost(normalizedCost);
  const hasValue = Number(parsedCost.generic || 0) > 0
    || Object.values(parsedCost.colors || {}).some((value) => Number(value || 0) > 0);

  if (!hasValue) return undefined;
  if (parsedCost.hasX || parsedCost.hybrids.length > 0) return undefined;

  return parsedCost;
}

export function snapshotCastSpellManaPool(poolLike: any): Record<string, number> {
  return {
    white: Number(poolLike?.white || 0),
    blue: Number(poolLike?.blue || 0),
    black: Number(poolLike?.black || 0),
    red: Number(poolLike?.red || 0),
    green: Number(poolLike?.green || 0),
    colorless: Number(poolLike?.colorless || 0),
  };
}

export const CAST_SPELL_PAYMENT_MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

function createEmptyCastSpellManaTotals(): Record<string, number> {
  return snapshotCastSpellManaPool(undefined);
}

export function getPaymentItemProducedManaTotals(
  mana?: string | null,
  count?: number | null,
  producedColors?: readonly string[] | null,
): Record<string, number> {
  const totals = createEmptyCastSpellManaTotals();
  const normalizedProducedColors = Array.isArray(producedColors)
    ? producedColors
        .map((color) => String(color || '').trim().toUpperCase())
        .filter((color): color is keyof typeof MANA_COLOR_NAMES => Object.prototype.hasOwnProperty.call(MANA_COLOR_NAMES, color))
    : [];

  if (normalizedProducedColors.length > 0) {
    for (const color of normalizedProducedColors) {
      const poolKey = MANA_COLOR_NAMES[color];
      if (poolKey) {
        totals[poolKey] = (totals[poolKey] || 0) + 1;
      }
    }
    return totals;
  }

  const poolKey = MANA_COLOR_NAMES[String(mana || '').trim().toUpperCase() as keyof typeof MANA_COLOR_NAMES];
  const amount = Math.max(1, Number(count || 1));
  if (poolKey && amount > 0) {
    totals[poolKey] = (totals[poolKey] || 0) + amount;
  }

  return totals;
}

export function addCastSpellManaTotals(target: any, delta: any): void {
  for (const key of CAST_SPELL_PAYMENT_MANA_KEYS) {
    const amount = Number(delta?.[key] || 0);
    if (amount > 0) {
      target[key] = Number(target?.[key] || 0) + amount;
    }
  }
}

export function cardCanSpendManaAsAnyType(card: any): boolean {
  return Boolean((card as any)?.spendManaAsThoughAnyType === true);
}

export function normalizeParsedSpellCostForAnyTypeManaSpending(
  parsedCost: ReturnType<typeof parseManaCost>,
): ReturnType<typeof parseManaCost> {
  const colorCostTotal = Object.values(parsedCost.colors || {}).reduce(
    (sum, value) => sum + Math.max(0, Number(value || 0)),
    0,
  );
  const hybrids = Array.isArray(parsedCost.hybrids)
    ? parsedCost.hybrids.map((options) => {
        const normalizedOptions = Array.isArray(options)
          ? options.map((option) => String(option || '').trim().toUpperCase()).filter(Boolean)
          : [];
        const lifeOptions = normalizedOptions.filter((option) => /^LIFE:\d+$/.test(option));
        const genericOptions = normalizedOptions
          .filter((option) => /^GENERIC:\d+$/.test(option))
          .map((option) => Number(option.slice('GENERIC:'.length)))
          .filter((value) => Number.isFinite(value) && value > 0);
        const hasManaTypeOption = normalizedOptions.some((option) => /^[WUBRGC]$/.test(option));

        if (hasManaTypeOption) {
          return ['GENERIC:1', ...lifeOptions];
        }

        if (genericOptions.length > 0) {
          return [`GENERIC:${Math.min(...genericOptions)}`, ...lifeOptions];
        }

        return lifeOptions;
      })
    : [];

  return {
    ...parsedCost,
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: Math.max(0, Number(parsedCost.generic || 0)) + colorCostTotal,
    hybrids,
  };
}

function sumEligibleRestrictedMana(
  pool: any,
  purpose: RestrictedManaSpendPurpose | undefined,
): Record<string, number> {
  const totals = snapshotCastSpellManaPool(undefined);
  if (!purpose || !Array.isArray(pool?.restricted)) return totals;
  for (const entry of pool.restricted) {
    if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
    const colorKey = getManaEntryColor(entry);
    if (!Object.prototype.hasOwnProperty.call(totals, colorKey)) continue;
    totals[colorKey] = Number(totals[colorKey] || 0) + Number(entry.amount || 0);
  }
  return totals;
}

/**
 * Spend an explicit cast payment.
 * Selected totals count mana the player chose, including Vibranium/Powerstone mana that
 * was added only to pool.restricted. Eligible restricted mana already floating but not
 * copied into those totals is included once. Illegal restricted mana is not spent.
 */
export function consumeExplicitSelectedCastSpellMana(
  pool: any,
  selectedAvailable: Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  purpose?: RestrictedManaSpendPurpose,
): { consumed: Record<string, number> } | { error: string } {
  const selectedPool = snapshotCastSpellManaPool(selectedAvailable);
  const regularPool = snapshotCastSpellManaPool(pool);
  const eligibleRestricted = sumEligibleRestrictedMana(pool, purpose);
  const spendable = snapshotCastSpellManaPool(selectedPool);

  for (const key of CAST_SPELL_PAYMENT_MANA_KEYS) {
    // Produced or explicitly selected restricted mana is in selected totals but not
    // in the regular pool. Don't add that amount again from pool.restricted.
    const alreadyCountedFromRestricted = Math.max(
      0,
      Number(selectedPool[key] || 0) - Number(regularPool[key] || 0),
    );
    const implicitRestricted = Math.max(
      0,
      Number(eligibleRestricted[key] || 0) - alreadyCountedFromRestricted,
    );
    if (implicitRestricted > 0) {
      spendable[key] = Number(spendable[key] || 0) + implicitRestricted;
    }
  }

  const validationError = validateManaPayment(spendable, coloredCost, genericCost);
  if (validationError) {
    return { error: validationError };
  }

  const manaConsumption = consumeManaFromPool(
    spendable,
    coloredCost,
    genericCost,
    '[castSpellFromHand][selectedPayment]',
  );

  const drainPlan: Array<{ key: string; regularUse: number; restrictedUses: Array<{ index: number; use: number }> }> = [];
  for (const key of CAST_SPELL_PAYMENT_MANA_KEYS) {
    let remaining = Number((manaConsumption.consumed as any)?.[key] || 0);
    if (remaining <= 0) continue;

    // Prefer eligible restricted mana before unrestricted (keep flexible mana).
    const restrictedUses: Array<{ index: number; use: number }> = [];
    if (remaining > 0 && purpose && Array.isArray(pool?.restricted)) {
      for (let index = pool.restricted.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const entry = pool.restricted[index];
        if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
        if (getManaEntryColor(entry) !== key) continue;
        const use = Math.min(Number(entry.amount || 0), remaining);
        if (use <= 0) continue;
        restrictedUses.push({ index, use });
        remaining -= use;
      }
    }

    const regularUse = Math.min(Number(pool?.[key] || 0), remaining);
    remaining -= regularUse;

    if (remaining > 0) {
      const blockedByRestriction = Array.isArray(pool?.restricted) && pool.restricted.some((entry: any) => (
        entry
        && getManaEntryColor(entry) === key
        && Number(entry.amount || 0) > 0
        && Boolean(purpose)
        && !canUseRestrictedMana(entry, purpose as RestrictedManaSpendPurpose)
      ));
      if (blockedByRestriction) {
        return { error: `Selected ${key} mana is restricted and cannot be spent on this payment.` };
      }
      return { error: `Selected payment used more ${key} mana than is available.` };
    }

    drainPlan.push({ key, regularUse, restrictedUses });
  }

  for (const step of drainPlan) {
    if (step.regularUse > 0) {
      pool[step.key] = Number(pool?.[step.key] || 0) - step.regularUse;
    }
  }

  const restrictedUses = drainPlan
    .flatMap((step) => step.restrictedUses)
    .sort((left, right) => right.index - left.index);
  for (const use of restrictedUses) {
    const entry = pool.restricted?.[use.index];
    if (!entry) continue;
    entry.amount -= use.use;
    if (entry.amount <= 0) {
      pool.restricted.splice(use.index, 1);
    }
  }
  if (Array.isArray(pool?.restricted) && pool.restricted.length === 0) {
    delete pool.restricted;
  }

  return { consumed: manaConsumption.consumed };
}

export function restorePlayerCastSpellPaymentCheckpoint(
  game: any,
  playerId: string,
  checkpoint: {
    pool: Record<string, number>;
    tappedPermanentIds: Iterable<string>;
    harmonizePermanentId?: string;
    removedCounters?: Array<{ permanentId: string; counterType: string; previousAmount: number }>;
  },
): void {
  const pool = getOrInitManaPool(game.state, playerId) as any;
  for (const key of CAST_SPELL_PAYMENT_MANA_KEYS) {
    pool[key] = Number((checkpoint.pool as any)?.[key] || 0);
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  for (const permanentId of checkpoint.tappedPermanentIds) {
    const permanent = battlefield.find((entry: any) => entry?.id === permanentId);
    if (permanent) {
      (permanent as any).tapped = false;
    }
  }

  if (checkpoint.harmonizePermanentId) {
    const harmonizePermanent = battlefield.find((entry: any) => entry?.id === checkpoint.harmonizePermanentId);
    if (harmonizePermanent) {
      (harmonizePermanent as any).tapped = false;
    }
  }

  for (const removed of Array.isArray(checkpoint.removedCounters) ? checkpoint.removedCounters : []) {
    const permanent = battlefield.find((entry: any) => entry?.id === removed.permanentId);
    if (!permanent) continue;
    (permanent as any).counters = (permanent as any).counters || {};
    const previousAmount = Number(removed.previousAmount || 0);
    if (previousAmount > 0) {
      (permanent as any).counters[removed.counterType] = previousAmount;
    } else {
      delete (permanent as any).counters[removed.counterType];
    }
  }
}


export function resolveSpellPaymentPermanentId(
  gameOrState: any,
  playerId: string,
  permanentId: string,
  usedIds?: Set<string>,
  opts?: { requireUntappedForTapAbility?: boolean; mana?: string; abilityId?: string },
): string | null {
  const game = gameOrState?.state ? gameOrState : { state: gameOrState };
  const raw = String(permanentId || '').trim();
  if (!raw) return null;
  // Floating pool refs are not battlefield permanents; keep them as-is for callers that need the sentinel.
  if (parseFloatingPaymentPermanentId(raw)) return raw;

  const predicate = (perm: any) => {
    if (!opts?.requireUntappedForTapAbility) return true;
    // Prefer untapped when we know activation taps; if we can't tell yet, still allow.
    try {
      const costInfo = getPaymentActivationCostInfo(
        perm,
        resolvePaymentManaAbilityActivationCost(perm, String(opts?.mana || ''), opts?.abilityId),
      );
      if (costInfo.taps && (perm as any).tapped) return false;
    } catch {
      // best-effort
    }
    return true;
  };

  const resolved = resolveGroupedPermanentRef(game, playerId as any, raw, {
    usedIds,
    predicate,
  });
  if (resolved) return resolved;
  // Direct id fallback already handled inside resolveGroupedPermanentRef; null means missing.
  return null;
}

export function validateCastSpellPaymentPermanentUsage(
  gameOrState: any,
  playerId: string,
  payment: Array<{ permanentId?: string; mana?: string; abilityId?: string }>,
): string | null {
  const game = gameOrState?.state ? gameOrState : { state: gameOrState };
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const usedIds = new Set<string>();
  const tapPermanentIds = new Set<string>();

  for (const item of payment) {
    const floatingPoolKey = getFloatingPaymentPoolKey(String(item?.permanentId || ''), String(item?.mana || ''));
    if (floatingPoolKey) continue;

    const rawPermanentId = String(item?.permanentId || '').trim();
    if (!rawPermanentId) continue;

    const permanentId = resolveSpellPaymentPermanentId(game, playerId, rawPermanentId, usedIds, {
      requireUntappedForTapAbility: true,
      mana: item?.mana,
      abilityId: item?.abilityId,
    });
    if (!permanentId || parseFloatingPaymentPermanentId(permanentId)) {
      return `Payment source ${rawPermanentId} is not on the battlefield.`;
    }

    const permanent = battlefield.find((entry: any) => entry?.id === permanentId && entry?.controller === playerId);
    if (!permanent) {
      return `Payment source ${rawPermanentId} is not on the battlefield.`;
    }

    const activationCostInfo = getPaymentActivationCostInfo(
      permanent,
      resolvePaymentManaAbilityActivationCost(permanent, String(item?.mana || ''), item?.abilityId),
    );
    reserveCastSpellPaymentPermanentId(usedIds, permanentId, activationCostInfo.taps);

    if (!activationCostInfo.taps) continue;

    if (tapPermanentIds.has(permanentId)) {
      const cardName = String((permanent as any)?.card?.name || 'Permanent');
      return `${cardName} cannot be tapped more than once to pay for this spell.`;
    }

    tapPermanentIds.add(permanentId);
  }

  return null;
}

export function calculateCastSpellPaymentManaDelta(before: any, after: any): Record<string, number> | undefined {
  const baseline = snapshotCastSpellManaPool(before);
  const current = snapshotCastSpellManaPool(after);
  const delta: Record<string, number> = {};

  for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = Number(current[key] || 0) - Number(baseline[key] || 0);
    if (amount !== 0) {
      delta[key] = amount;
    }
  }

  return Object.keys(delta).length > 0 ? delta : undefined;
}

export function paymentSacrificeCandidateMatches(candidate: any, sourcePermanentId: string, playerId: string, sacrificeInfo: ReturnType<typeof parseSacrificeCost>): boolean {
  if (!candidate) return false;
  if (String(candidate.controller || '') !== String(playerId || '')) return false;
  if (sacrificeInfo.mustBeOther && String(candidate.id || '') === String(sourcePermanentId || '')) return false;

  const typeLine = String(candidate?.card?.type_line || '').toLowerCase();
  switch (sacrificeInfo.sacrificeType) {
    case 'creature':
      if (!typeLine.includes('creature')) return false;
      if (sacrificeInfo.creatureSubtype) {
        return typeLine.includes(String(sacrificeInfo.creatureSubtype).toLowerCase());
      }
      return true;
    case 'artifact':
      return typeLine.includes('artifact');
    case 'enchantment':
      return typeLine.includes('enchantment');
    case 'land':
      return typeLine.includes('land');
    case 'permanent':
      return true;
    case 'artifact_or_creature':
      return typeLine.includes('artifact') || typeLine.includes('creature');
    default:
      return false;
  }
}

function getActivatedAbilityCostFromResolverId(permanent: any, abilityId?: string | null): string | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedAbilityId) return undefined;

  const genericAbilityMatch = normalizedAbilityId.match(/-ability-(\d+)$/i);
  if (!genericAbilityMatch) return undefined;

  const targetIndex = Number(genericAbilityMatch[1]);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return undefined;

  const oracleText = String(permanent?.card?.oracle_text || '').trim();
  if (!oracleText) return undefined;

  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;

  let genericAbilityIndex = 0;
  for (const line of lines) {
    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      if (genericAbilityIndex === targetIndex) {
        return String(activatedMatch[1] || '').trim();
      }
      genericAbilityIndex += 1;
      continue;
    }

    const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
    if (textOnlyMatch) {
      if (genericAbilityIndex === targetIndex) {
        return String(textOnlyMatch[1] || '').trim();
      }
      genericAbilityIndex += 1;
    }
  }

  return undefined;
}

function inferManaAbilityActivationCost(permanent: any, selectedMana: string): string {
  const oracleText = String(permanent?.card?.oracle_text || '');
  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedMana = String(selectedMana || '').trim().toUpperCase();

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*add\s+(.+)$/i);
    if (!match) continue;
    const producedText = String(match[2] || '').toUpperCase();
    if (
      !normalizedMana ||
      producedText.includes(`{${normalizedMana}}`) ||
      /ONE\s+MANA|ANY\s+COLOR|ANY\s+COMBINATION/.test(producedText)
    ) {
      return String(match[1] || '').trim();
    }
  }

  const firstMatch = oracleText.match(/([^:\n]+):\s*add\s+([^\n]+)/i);
  return firstMatch ? String(firstMatch[1] || '').trim() : '';
}

export function resolvePaymentManaAbilityActivationCost(permanent: any, selectedMana: string, abilityId?: string | null): string {
  const resolvedCost = getActivatedAbilityCostFromResolverId(permanent, abilityId);
  if (resolvedCost !== undefined) {
    return resolvedCost;
  }

  return inferManaAbilityActivationCost(permanent, selectedMana);
}

export function paymentManaAbilityGrantsCreatureSpellHasteUntilEndOfTurn(permanent: any, abilityId?: string | null): boolean {
  const selectedAbilityLine = resolveActivatedAbilityLineById(permanent, abilityId);
  if (selectedAbilityLine) {
    return /if that mana is spent on a creature spell, it gains haste until end of turn/i.test(
      String(selectedAbilityLine.lineText || ''),
    );
  }

  const oracleText = String(permanent?.card?.oracle_text || '').trim();
  if (!oracleText) {
    return false;
  }

  const manaAbilityLines = oracleText
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => /:\s*add\b/i.test(line));
  if (manaAbilityLines.length !== 1) {
    return false;
  }

  return /if that mana is spent on a creature spell, it gains haste until end of turn/i.test(manaAbilityLines[0]);
}
