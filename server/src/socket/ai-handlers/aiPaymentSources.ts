/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: getPaymentSources plus its top-level payment-source support
 * helpers (getAISpellPaymentSourceCostText through getAISupportedSpellPaymentSource).
 *
 * Public entry symbols: getPaymentSources.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseSacrificeCost } from "../../../../shared/src/textUtils.js";
import { parseManaCost } from "../../state/modules/mana-check.js";
import {
  calculateManaProduction,
  paymentActivationCostHasUnsupportedAdditionalCosts,
  resolvePaymentManaAbilitySpendRestriction,
  restrictedManaSpendRestrictionAllowsPurpose,
  type RestrictedManaSpendPurpose,
} from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { COLOR_IDENTITY_MAP } from "./aiConstants.js";
import type { AIActivatedAbilityResolverCandidate } from "./aiAbilityActivationTypes.js";
import {
  getAIManaProductionOptions,
  hasCreatureSummoningSickness,
  hasManaAbility,
} from "./aiManaCostHelpers.js";
import { permanentCannotActivateTapAbilities } from "../../state/modules/staticEffectSpecActivationLocks.js";
import { permanentHasAIManaAbilityResolverCandidates, resolveAIPaymentManaAbilityId } from "./aiManaActivationHelpers.js";
import { chooseAISacrificePermanentsForManaAbility } from "./aiSpellPaymentPlanHelpers.js";

function buildAIActivatedAbilityResolverCandidates(permanent: any): AIActivatedAbilityResolverCandidate[] {
  return getAIHandlerDeps().buildAIActivatedAbilityResolverCandidates(permanent);
}

function parsedActivationManaPips(activationCostText: string): number {
  const text = String(activationCostText || '').trim();
  if (!text) return 0;
  const parsed = parseManaCost(text);
  return Number(parsed.generic || 0)
    + Object.values(parsed.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
}

function getAISpellPaymentSourceCostText(
  game: any,
  playerId: PlayerID,
  permanent: any,
  manaColor: string,
  abilityId?: string,
): string {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (normalizedAbilityId) {
    const candidate = buildAIActivatedAbilityResolverCandidates(permanent).find(
      (entry) => String(entry?.id || '') === normalizedAbilityId,
    );
    const candidateText = String(candidate?.text || '').trim();
    const candidateCostText = candidateText.split(':')[0] || '';
    if (candidateCostText.trim()) {
      return candidateCostText.trim().toLowerCase();
    }
  }

  const selectedActivationCost = String(
    calculateManaProduction(game.state, permanent, String(playerId), String(manaColor || ''), abilityId)?.activationCost || ''
  ).trim();
  if (selectedActivationCost) {
    return selectedActivationCost.toLowerCase();
  }

  if (normalizedAbilityId) {
    return '';
  }

  return String(permanent?.card?.oracle_text || '').split(':')[0].toLowerCase();
}

function aiSpellPaymentSourceHasUnsupportedAdditionalCosts(
  game: any,
  playerId: PlayerID,
  permanent: any,
  manaColor: string,
  abilityId?: string,
): boolean {
  const costText = getAISpellPaymentSourceCostText(game, playerId, permanent, manaColor, abilityId);
  // Keep AI payment planning in lockstep with castSpellFromHand rejection rules.
  // Mana symbols / {T}/{Q} are supported (e.g. Three Tree City "{2}, {T}") — paid from
  // other sources in the same batched payment plan.
  if (paymentActivationCostHasUnsupportedAdditionalCosts(costText, String(permanent?.card?.name || ''))) {
    return true;
  }

  return /\bpay\b|\bdiscard\b|\bexile\b|\breturn\b/.test(costText);
}

function aiSpellPaymentSourceProducesUnsupportedMulticolor(
  permanent: any,
  manaColor: string,
  manaInfo: ReturnType<typeof calculateManaProduction>,
  abilityId?: string,
): boolean {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (normalizedAbilityId) {
    const candidate = buildAIActivatedAbilityResolverCandidates(permanent).find(
      (entry) => String(entry?.id || '') === normalizedAbilityId,
    );
    const effectText = String(candidate?.effect || candidate?.text || '').toLowerCase();
    const manaSymbols = effectText.match(/\{([wubrgc])\}/gi) || [];
    const distinctSymbols = new Set(
      manaSymbols.map((token) => token.replace(/[{}]/g, '').toUpperCase())
    );
    const isChoiceAbility = /\bor\b/.test(effectText)
      || /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(effectText)
      || /choose a colou?r/i.test(effectText)
      || /mana of that colou?r/i.test(effectText);
    if (!isChoiceAbility && (distinctSymbols.size > 1 || /mana in any combination/i.test(effectText))) {
      return true;
    }
  }

  const producedPoolKeys = new Set<string>();
  const primaryPoolKey = COLOR_IDENTITY_MAP[String(manaColor || '').toUpperCase()] || 'colorless';
  if (Number(manaInfo.totalAmount || 0) > 0) {
    producedPoolKeys.add(primaryPoolKey);
  }

  for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
    const bonusPoolKey = COLOR_IDENTITY_MAP[String(bonus?.color || '').toUpperCase()] || 'colorless';
    if (Number(bonus?.amount || 0) > 0) {
      producedPoolKeys.add(bonusPoolKey);
    }
  }

  return producedPoolKeys.size > 1;
}

function getAISupportedSpellPaymentSource(
  game: any,
  playerId: PlayerID,
  permanent: any,
  manaColor: string,
  abilityId?: string,
  unavailablePermanentIds?: Set<string>,
  restrictedSpendPurpose?: RestrictedManaSpendPurpose,
): { manaAmount: number; abilityId?: string; sacrificedPermanentIds?: string[] } | null {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (
    restrictedSpendPurpose &&
    !normalizedAbilityId &&
    permanentHasAIManaAbilityResolverCandidates(permanent)
  ) {
    return null;
  }

  const spendRestriction = resolvePaymentManaAbilitySpendRestriction(
    game.state,
    permanent,
    String(playerId),
    abilityId,
  );
  if (
    restrictedSpendPurpose &&
    spendRestriction &&
    !restrictedManaSpendRestrictionAllowsPurpose(spendRestriction, restrictedSpendPurpose)
  ) {
    return null;
  }

  const manaInfo = calculateManaProduction(game.state, permanent, String(playerId), manaColor, abilityId);
  const manaAmount = Number(manaInfo.totalAmount || 0);
  if (manaAmount <= 0) {
    return null;
  }

  if (aiSpellPaymentSourceHasUnsupportedAdditionalCosts(game, playerId, permanent, manaColor, abilityId)) {
    return null;
  }

  if (aiSpellPaymentSourceProducesUnsupportedMulticolor(permanent, manaColor, manaInfo, abilityId)) {
    return null;
  }

  const costText = getAISpellPaymentSourceCostText(game, playerId, permanent, manaColor, abilityId);
  const sacrificeInfo = parseSacrificeCost(costText);
  let sacrificedPermanentIds: string[] | undefined;

  if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType && sacrificeInfo.sacrificeType !== 'self') {
    const chosenSacrifices = chooseAISacrificePermanentsForManaAbility(
      game,
      playerId,
      permanent,
      costText,
      unavailablePermanentIds,
    );
    const requiredCount = Math.max(1, Number(sacrificeInfo.sacrificeCount || 1));
    if (chosenSacrifices.length !== requiredCount) {
      return null;
    }
    sacrificedPermanentIds = chosenSacrifices;
  }

  return {
    manaAmount,
    ...(abilityId ? { abilityId } : {}),
    ...(sacrificedPermanentIds && sacrificedPermanentIds.length > 0 ? { sacrificedPermanentIds } : {}),
  };
}

/**
 * Get untapped mana sources (lands, artifacts, creatures) that can pay for a spell
 * Returns source IDs in the order they should be tapped, with the color each should produce
 */
export function getPaymentSources(
  game: any,
  playerId: PlayerID,
  cost: { colors: Record<string, number>; generic: number },
  options?: { restrictedSpendPurpose?: RestrictedManaSpendPurpose },
): Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }> {
  const battlefield = game.state?.battlefield || [];
  const payments: Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }> = [];
  const usedSourceIds = new Set<string>(); // Track which sources we've already assigned
  const reservedSacrificeIds = new Set<string>();
  const colorsPaid: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let genericPaid = 0;
  const restrictedSpendPurpose = options?.restrictedSpendPurpose;
  
  // Collect all available mana sources with their produced colors
  const availableSources: Array<{ perm: any; producedColors: string[]; isLand: boolean }> = [];
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId && !perm.tapped) {
      // Check if this permanent can produce mana
      if (!hasManaAbility(perm.card)) continue;
      
      // Creatures with summoning sickness can't tap for mana
      if (hasCreatureSummoningSickness(perm)) continue;
      if (permanentCannotActivateTapAbilities(perm, game.state)) continue;
      
      const producedColors = getAIManaProductionOptions(game, playerId, perm);
      if (producedColors.length === 0) continue;
      
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      const isLand = typeLine.includes('land');

      availableSources.push({ perm, producedColors, isLand });
    }
  }
  
  // First pass: assign sources to colored requirements
  // Prefer single-color sources for specific colors to save multi-color sources for flexibility
  // Also prefer lands over mana rocks/creatures for colored mana
  for (const [color, needed] of Object.entries(cost.colors)) {
    if (needed <= 0) continue;
    
    while (colorsPaid[color] < needed) {
      // Find an unassigned source that can produce this color
      // Priority: single-color land > single-color artifact > multi-color land > multi-color artifact
      let bestSource: { perm: any; producedColors: string[]; isLand: boolean } | null = null;
      let bestSourceAbilityId: string | undefined;
      let bestSourceAmount = 0;
      let bestSourceSacrificedPermanentIds: string[] | undefined;
      let bestScore = -1;
      
      for (const source of availableSources) {
        if (usedSourceIds.has(source.perm.id) || reservedSacrificeIds.has(String(source.perm.id || ''))) continue;
        if (!source.producedColors.includes(color)) continue;

        const abilityId = resolveAIPaymentManaAbilityId(game, playerId, source.perm, color, restrictedSpendPurpose);
        const supportedSource = getAISupportedSpellPaymentSource(
          game,
          playerId,
          source.perm,
          color,
          abilityId,
          new Set<string>([
            ...Array.from(usedSourceIds).map((id) => String(id || '')),
            ...Array.from(reservedSacrificeIds).map((id) => String(id || '')),
          ]),
          restrictedSpendPurpose,
        );
        if (!supportedSource) continue;
        const manaAmount = supportedSource.manaAmount;
        const manaInfo = calculateManaProduction(game.state, source.perm, String(playerId), color, abilityId);
        const activationCostText = String(manaInfo?.activationCost || '').trim();
        const parsedActivation = activationCostText ? parseManaCost(activationCostText) : null;
        const activationManaNeeded = parsedActivation
          ? Number(parsedActivation.generic || 0)
            + Object.values(parsedActivation.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0)
          : 0;
        if (activationManaNeeded > 0) {
          const freeCandidates = availableSources.filter((candidate) => {
            if (usedSourceIds.has(candidate.perm.id) || reservedSacrificeIds.has(String(candidate.perm.id || ''))) {
              return false;
            }
            if (String(candidate.perm.id || '') === String(source.perm.id || '')) return false;
            const freeAbilityId = resolveAIPaymentManaAbilityId(game, playerId, candidate.perm, candidate.producedColors[0] || 'C');
            const freeInfo = calculateManaProduction(
              game.state,
              candidate.perm,
              String(playerId),
              candidate.producedColors[0] || 'C',
              freeAbilityId,
            );
            const freeActivation = String(freeInfo?.activationCost || '').trim();
            const freeParsed = freeActivation ? parseManaCost(freeActivation) : null;
            const freeActivationNeeded = freeParsed
              ? Number(freeParsed.generic || 0)
                + Object.values(freeParsed.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0)
              : 0;
            return freeActivationNeeded === 0 && Number(freeInfo?.totalAmount || 0) > 0;
          });
          const freeSourcesRemaining = freeCandidates.length;
          const freeManaRemaining = freeCandidates.reduce((sum, candidate) => {
            const freeAbilityId = resolveAIPaymentManaAbilityId(game, playerId, candidate.perm, candidate.producedColors[0] || 'C');
            const freeInfo = calculateManaProduction(
              game.state,
              candidate.perm,
              String(playerId),
              candidate.producedColors[0] || 'C',
              freeAbilityId,
            );
            return sum + Number(freeInfo?.totalAmount || 0);
          }, 0);
          const unpaidColoredMana = Object.entries(cost.colors || {}).reduce((sum, [costColor, amount]) => {
            const paid = Number(colorsPaid[costColor] || 0);
            return sum + Math.max(0, Number(amount || 0) - paid);
          }, 0);
          const remainingSpellMana = unpaidColoredMana + Number(cost.generic || 0);
          // If free taps already cover the rest of the spell, don't burn them on an invest line.
          if (freeManaRemaining >= remainingSpellMana) continue;
          // Three Tree / Nykthos-style invest lines need spare free taps to float their activation cost.
          if (freeSourcesRemaining < activationManaNeeded) continue;
          // Only prefer invest lines when they clearly beat tapping the same number of basics.
          if (manaAmount <= activationManaNeeded) continue;
        }
        
        // Score: prefer single-color lands, then single-color artifacts, then multi
        let score = 0;
        if (source.producedColors.length === 1) score += 10; // Single color is better
        if (source.isLand) score += 5; // Lands are slightly preferred over rocks
        const spendRestriction = resolvePaymentManaAbilitySpendRestriction(
          game.state,
          source.perm,
          String(playerId),
          abilityId,
        );
        if (!spendRestriction) score += 25;
        score += Math.min(manaAmount, needed - colorsPaid[color]) * 20;
        if (activationManaNeeded > 0) {
          score += (manaAmount - activationManaNeeded) * 15;
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestSource = source;
          bestSourceAbilityId = abilityId;
          bestSourceAmount = manaAmount;
          bestSourceSacrificedPermanentIds = supportedSource.sacrificedPermanentIds;
        }
      }
      
      if (bestSource) {
        usedSourceIds.add(bestSource.perm.id);
        for (const sacrificedId of bestSourceSacrificedPermanentIds || []) {
          reservedSacrificeIds.add(String(sacrificedId || ''));
        }
        const spendCount = Math.min(bestSourceAmount, needed - colorsPaid[color]);
        payments.push({
          sourceId: bestSource.perm.id,
          produceColor: color,
          ...(bestSourceAbilityId ? { abilityId: bestSourceAbilityId } : {}),
          ...((spendCount !== 1 || bestSourceAmount !== spendCount) ? { count: spendCount } : {}),
          ...(bestSourceSacrificedPermanentIds && bestSourceSacrificedPermanentIds.length > 0
            ? { sacrificedPermanentIds: bestSourceSacrificedPermanentIds }
            : {}),
        });
        colorsPaid[color] += spendCount;
      } else {
        break; // No more sources available for this color
      }
    }
  }
  
  // Second pass: assign remaining sources to generic mana
  // For sources that produce 2 mana (Sol Ring), they count for 2 generic
  let genericNeeded = cost.generic;
  const remainingSources = availableSources
    .filter((source) => !usedSourceIds.has(source.perm.id))
    .map((source) => {
      const colorOptions = source.producedColors.length > 0 ? source.producedColors : ['C'];
      let bestColor = colorOptions[0] || 'C';
      let bestAbilityId: string | undefined;
      let bestAmount = 0;
      let bestActivationManaNeeded = 0;
      let bestNetAmount = 0;
      let bestSacrificedPermanentIds: string[] | undefined;
      let bestGenericScore = Number.NEGATIVE_INFINITY;

      for (const colorOption of colorOptions) {
        const abilityId = resolveAIPaymentManaAbilityId(game, playerId, source.perm, colorOption, restrictedSpendPurpose);
        const supportedSource = getAISupportedSpellPaymentSource(
          game,
          playerId,
          source.perm,
          colorOption,
          abilityId,
          new Set<string>([
            ...Array.from(usedSourceIds).map((id) => String(id || '')),
            ...Array.from(reservedSacrificeIds).map((id) => String(id || '')),
          ]),
          restrictedSpendPurpose,
        );
        if (!supportedSource) continue;
        const manaInfo = calculateManaProduction(
          game.state,
          source.perm,
          String(playerId),
          colorOption,
          abilityId,
        );
        const activationManaNeeded = parsedActivationManaPips(String(manaInfo?.activationCost || ''));
        const netAmount = Math.max(0, supportedSource.manaAmount - activationManaNeeded);
        if (activationManaNeeded > 0) {
          const freeCandidates = availableSources.filter((candidate) => {
            if (usedSourceIds.has(candidate.perm.id) || reservedSacrificeIds.has(String(candidate.perm.id || ''))) {
              return false;
            }
            if (String(candidate.perm.id || '') === String(source.perm.id || '')) return false;
            const freeAbilityId = resolveAIPaymentManaAbilityId(game, playerId, candidate.perm, candidate.producedColors[0] || 'C');
            const freeInfo = calculateManaProduction(
              game.state,
              candidate.perm,
              String(playerId),
              candidate.producedColors[0] || 'C',
              freeAbilityId,
            );
            return parsedActivationManaPips(String(freeInfo?.activationCost || '')) === 0
              && Number(freeInfo?.totalAmount || 0) > 0;
          });
          const freeManaRemaining = freeCandidates.reduce((sum, candidate) => {
            const freeAbilityId = resolveAIPaymentManaAbilityId(game, playerId, candidate.perm, candidate.producedColors[0] || 'C');
            const freeInfo = calculateManaProduction(
              game.state,
              candidate.perm,
              String(playerId),
              candidate.producedColors[0] || 'C',
              freeAbilityId,
            );
            return sum + Number(freeInfo?.totalAmount || 0);
          }, 0);
          // If free taps already cover remaining generic, do not spend them on an invest line.
          if (freeManaRemaining >= genericNeeded) continue;
          if (freeCandidates.length < activationManaNeeded) continue;
          if (netAmount <= 0) continue;
        }
        const spendRestriction = resolvePaymentManaAbilitySpendRestriction(
          game.state,
          source.perm,
          String(playerId),
          abilityId,
        );
        // Prefer net mana so Three Tree City's {2} line does not look like 4–8 free pips.
        let genericScore = netAmount * 100;
        if (activationManaNeeded === 0) genericScore += 40;
        if (!spendRestriction) genericScore += 50;
        if (String(colorOption || '').toUpperCase() === 'C') genericScore += 10;
        if (genericScore > bestGenericScore) {
          bestGenericScore = genericScore;
          bestAmount = supportedSource.manaAmount;
          bestActivationManaNeeded = activationManaNeeded;
          bestNetAmount = netAmount;
          bestColor = colorOption;
          bestAbilityId = abilityId;
          bestSacrificedPermanentIds = supportedSource.sacrificedPermanentIds;
        }
      }

      return {
        source,
        color: bestColor,
        abilityId: bestAbilityId,
        amount: bestAmount,
        activationManaNeeded: bestActivationManaNeeded,
        netAmount: bestNetAmount,
        sacrificedPermanentIds: bestSacrificedPermanentIds,
      };
    })
    .filter((entry) => entry.amount > 0)
    .sort((left, right) => {
      const leftPaid = left.activationManaNeeded > 0 ? 1 : 0;
      const rightPaid = right.activationManaNeeded > 0 ? 1 : 0;
      if (leftPaid !== rightPaid) return leftPaid - rightPaid;
      return right.netAmount - left.netAmount;
    });

  for (const entry of remainingSources) {
    if (genericNeeded <= 0) break;

    usedSourceIds.add(entry.source.perm.id);
    for (const sacrificedId of entry.sacrificedPermanentIds || []) {
      reservedSacrificeIds.add(String(sacrificedId || ''));
    }
    const creditAmount = entry.activationManaNeeded > 0 ? entry.netAmount : entry.amount;
    const credited = Math.min(creditAmount, genericNeeded);
    const spendCount = Math.min(entry.amount, genericNeeded);
    payments.push({
      sourceId: entry.source.perm.id,
      produceColor: entry.color,
      ...(entry.abilityId ? { abilityId: entry.abilityId } : {}),
      ...((spendCount !== 1 || entry.amount !== spendCount) ? { count: spendCount } : {}),
      ...(entry.sacrificedPermanentIds && entry.sacrificedPermanentIds.length > 0
        ? { sacrificedPermanentIds: entry.sacrificedPermanentIds }
        : {}),
    });

    genericNeeded -= credited;
    genericPaid += credited;
  }

  const getPaymentEntryActivationManaNeeded = (
    entry: { sourceId: string; produceColor: string; abilityId?: string },
  ): number => {
    const permanent = battlefield.find((perm: any) => String(perm?.id || '') === String(entry.sourceId || ''));
    if (!permanent) return 0;
    const manaInfo = calculateManaProduction(
      game.state,
      permanent,
      String(playerId),
      entry.produceColor,
      entry.abilityId,
    );
    const activationCostText = String(manaInfo?.activationCost || '').trim();
    return parsedActivationManaPips(activationCostText);
  };

  const getPaymentEntryProducedAmount = (
    entry: { sourceId: string; produceColor: string; abilityId?: string },
  ): number => {
    const permanent = battlefield.find((perm: any) => String(perm?.id || '') === String(entry.sourceId || ''));
    if (!permanent) return 0;
    return Number(calculateManaProduction(
      game.state,
      permanent,
      String(playerId),
      entry.produceColor,
      entry.abilityId,
    )?.totalAmount || 0);
  };

  const collectUnusedFreeTapCandidates = () => availableSources
    .filter((source) => !usedSourceIds.has(source.perm.id) && !reservedSacrificeIds.has(String(source.perm.id || '')))
    .map((source) => {
      const color = source.producedColors[0] || 'C';
      const abilityId = resolveAIPaymentManaAbilityId(game, playerId, source.perm, color);
      const supportedSource = getAISupportedSpellPaymentSource(
        game,
        playerId,
        source.perm,
        color,
        abilityId,
        new Set<string>([
          ...Array.from(usedSourceIds).map((id) => String(id || '')),
          ...Array.from(reservedSacrificeIds).map((id) => String(id || '')),
        ]),
        restrictedSpendPurpose,
      );
      if (!supportedSource) return null;
      const manaInfo = calculateManaProduction(game.state, source.perm, String(playerId), color, abilityId);
      return {
        source,
        color,
        abilityId,
        activationNeeded: parsedActivationManaPips(String(manaInfo?.activationCost || '')),
        amount: Number(manaInfo?.totalAmount || 0),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry) && entry.activationNeeded === 0 && entry.amount > 0);

  // Ensure invest-cost lines (Three Tree {2}{T}, Nykthos, etc.) have enough free taps in the
  // same batched payment to float their activation cost.
  const totalActivationManaNeeded = payments.reduce(
    (sum, entry) => sum + getPaymentEntryActivationManaNeeded(entry),
    0,
  );
  let freeSourcesInPayment = payments.filter((entry) => getPaymentEntryActivationManaNeeded(entry) === 0).length;
  if (totalActivationManaNeeded > freeSourcesInPayment) {
    for (const entry of collectUnusedFreeTapCandidates()) {
      if (freeSourcesInPayment >= totalActivationManaNeeded) break;
      usedSourceIds.add(entry.source.perm.id);
      payments.push({
        sourceId: entry.source.perm.id,
        produceColor: entry.color,
        ...(entry.abilityId ? { abilityId: entry.abilityId } : {}),
      });
      freeSourcesInPayment += 1;
    }
  }

  // Invest lines credit gross production toward generic, but {2} is paid from the same
  // batch. Keep adding unused free taps until net mana covers the spell.
  const totalSpellManaNeeded = Object.values(cost.colors || {}).reduce(
    (sum, amount) => sum + Number(amount || 0),
    0,
  ) + Number(cost.generic || 0);
  const paymentNetMana = () => payments.reduce(
    (sum, entry) => sum + getPaymentEntryProducedAmount(entry) - getPaymentEntryActivationManaNeeded(entry),
    0,
  );
  if (paymentNetMana() < totalSpellManaNeeded) {
    for (const entry of collectUnusedFreeTapCandidates()) {
      if (paymentNetMana() >= totalSpellManaNeeded) break;
      usedSourceIds.add(entry.source.perm.id);
      payments.push({
        sourceId: entry.source.perm.id,
        produceColor: entry.color,
        ...(entry.abilityId ? { abilityId: entry.abilityId } : {}),
      });
    }
  }

  // Batch payment order: float free taps first, then invest-cost lines.
  return payments.sort(
    (left, right) => getPaymentEntryActivationManaNeeded(left) - getPaymentEntryActivationManaNeeded(right),
  );
}
