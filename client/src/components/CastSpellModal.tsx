import React, { useState, useMemo, useEffect } from 'react';
import { PaymentPicker } from './PaymentPicker';
import { FloatingManaPool } from './FloatingManaPool';
import type { BattlefieldPermanent, PaymentCostAdjustment, PaymentItem, ManaColor } from '../../../shared/src';
import {
  Color,
  parseManaCost,
  applyXValueToParsedCost,
  computeColorsNeededByOtherCards,
  calculateRemainingCostAfterFloatingMana,
  canUseRestrictedManaClient,
  buildRestrictedManaPurposeForSpell,
  canPayCost,
  type ManaPaymentSource,
  type OtherCardInfo,
  type ManaPool,
} from '../utils/manaUtils';
import { buildSuggestedPaymentItems } from '../utils/manaSourceBuilder';
import { applyConvokeToCost } from '../utils/convokeCostReduction';
import { manaPoolToColorRecord, simulateSequentialPaymentPool } from '../utils/manaSuggestedPaymentActivation';
import { parseAlternateCosts, type AlternateCost } from './CastSpellModal-handlers/castSpellModalParseAlternateCosts';

export { parseAlternateCosts, type AlternateCost };

export type DisplayedCostAdjustment = PaymentCostAdjustment;

const GRAVEYARD_ONLY_ALTERNATE_COST_IDS = new Set([
  'flashback',
  'disturb',
  'escape',
  'unearth',
  'retrace',
  'harmonize',
  'mayhem',
  'jump-start',
]);

/** Filter alternate costs by the zone the spell is being cast from. */
export function filterAlternateCostsForCastZone(
  costs: AlternateCost[],
  castFromZone?: string | null,
): AlternateCost[] {
  const zone = String(castFromZone || 'hand').toLowerCase();
  if (zone === 'graveyard') {
    const graveyardCosts = costs.filter((cost) => GRAVEYARD_ONLY_ALTERNATE_COST_IDS.has(cost.id));
    if (graveyardCosts.length === 0) {
      return [{ id: 'normal', label: 'Cast from Graveyard', manaCost: costs[0]?.manaCost || '', isDefault: true }];
    }
    return graveyardCosts;
  }
  // Hand / exile / library / command: never offer graveyard-only cast keywords.
  return costs.filter((cost) => !GRAVEYARD_ONLY_ALTERNATE_COST_IDS.has(cost.id));
}

function applyDisplayedCostAdjustment(
  manaCost: string,
  costAdjustment?: DisplayedCostAdjustment,
): string {
  if (!costAdjustment || !manaCost) return manaCost;

  const parsed = parseManaCost(manaCost);
  let newGeneric = Math.max(
    0,
    parsed.generic
      + Math.max(0, Number(costAdjustment.genericTax || 0))
      - Math.max(0, Number(costAdjustment.genericReduction || 0)),
  );
  const newColors = { ...parsed.colors };

  const colorNameToSymbol: Record<string, Color> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    colorless: 'C',
    W: 'W',
    U: 'U',
    B: 'B',
    R: 'R',
    G: 'G',
    C: 'C',
  };

  for (const colorKey of Object.keys(costAdjustment.coloredReductions || {})) {
    const color = colorNameToSymbol[colorKey];
    if (!color) continue;
    if (!newColors[color]) continue;

    const reduction = costAdjustment.coloredReductions[colorKey];
    newColors[color] = Math.max(0, newColors[color] - reduction);
  }

  const parts: string[] = [];
  if (newGeneric > 0) parts.push(`{${newGeneric}}`);
  if (newColors.W) parts.push('{W}'.repeat(newColors.W));
  if (newColors.U) parts.push('{U}'.repeat(newColors.U));
  if (newColors.B) parts.push('{B}'.repeat(newColors.B));
  if (newColors.R) parts.push('{R}'.repeat(newColors.R));
  if (newColors.G) parts.push('{G}'.repeat(newColors.G));
  if (newColors.C) parts.push('{C}'.repeat(newColors.C));

  return parts.length > 0 ? parts.join('') : '{0}';
}

export function resolveEffectiveManaCostForCastStep(options: {
  selectedManaCost?: string;
  queuedManaCost?: string;
  selectedCostId: string;
  forcedAlternateCostId?: string;
  costAdjustment?: DisplayedCostAdjustment;
}): string {
  const selectedManaCost = options.selectedManaCost || options.queuedManaCost || options.costAdjustment?.adjustedManaCost || '';
  if (
    String(options.forcedAlternateCostId || '').toLowerCase() === 'free'
    && (options.selectedCostId === 'free' || options.selectedCostId === 'normal' || !options.selectedCostId)
  ) {
    return '{0}';
  }
  if (!selectedManaCost) return selectedManaCost;

  const usesServerResolvedPaymentLine =
    options.selectedCostId === 'normal'
    || (Boolean(options.forcedAlternateCostId) && options.selectedCostId === options.forcedAlternateCostId);

  if (usesServerResolvedPaymentLine) {
    return options.queuedManaCost || options.costAdjustment?.adjustedManaCost || selectedManaCost;
  }

  return applyDisplayedCostAdjustment(selectedManaCost, options.costAdjustment);
}

interface CastSpellModalProps {
  open: boolean;
  cardName: string;
  manaCost?: string;
  typeLine?: string;
  isActivatedAbilityPayment?: boolean;
  oracleText?: string;
  forcedAlternateCostId?: string;
  preferredAlternateCostId?: string;
  extraAlternateCosts?: AlternateCost[];
  availableSources: ManaPaymentSource[];
  battlefieldPermanents?: BattlefieldPermanent[];
  otherCardsInHand?: OtherCardInfo[];
  floatingMana?: ManaPool;
  castFromZone?: 'hand' | 'graveyard' | 'exile' | 'library' | 'command';
  title?: string;
  confirmLabel?: string;
  manualFloatingManaSelection?: boolean;
  initialXValue?: number;
  costAdjustment?: DisplayedCostAdjustment;
  convokeOptions?: {
    availableCreatures: Array<{
      id: string;
      name: string;
      colors: string[];
      canTapFor: string[];
    }>;
    messages: string[];
  };
  sneakOptions?: {
    availableCreatures: Array<{
      id: string;
      name: string;
      attackTarget: string;
      imageUrl?: string;
    }>;
    messages: string[];
  };
  webSlingingOptions?: {
    availableCreatures: Array<{ id: string; name: string; imageUrl?: string }>;
    messages: string[];
  };
  currentStep?: string;
  onConfirm: (
    payment: PaymentItem[],
    alternateCostId?: string,
    xValue?: number,
    convokeTappedCreatures?: string[],
    sneakReturnedCreatureId?: string,
    webSlingingReturnedCreatureId?: string,
  ) => void;
  onCancel: () => void;
}

export function CastSpellModal({
  open,
  cardName,
  manaCost,
  typeLine,
  isActivatedAbilityPayment = false,
  oracleText,
  forcedAlternateCostId,
  preferredAlternateCostId,
  extraAlternateCosts,
  availableSources,
  battlefieldPermanents = [],
  otherCardsInHand = [],
  floatingMana,
  castFromZone = 'hand',
  title,
  confirmLabel,
  manualFloatingManaSelection = false,
  initialXValue,
  costAdjustment,
  convokeOptions,
  sneakOptions,
  webSlingingOptions,
  currentStep,
  onConfirm,
  onCancel,
}: CastSpellModalProps) {
  const [payment, setPayment] = useState<PaymentItem[]>([]);
  const [xValue, setXValue] = useState(0);
  const [selectedCostId, setSelectedCostId] = useState('normal');
  const [selectedConvokeCreatures, setSelectedConvokeCreatures] = useState<string[]>([]);
  const [selectedSneakCreatureId, setSelectedSneakCreatureId] = useState('');
  const [selectedWebSlingingCreatureId, setSelectedWebSlingingCreatureId] = useState('');

  // When the server forces an alternate cost (e.g., Miracle), lock the selection.
  // Otherwise prefer an eligible free/alternate cost (e.g. Fierce Guardianship with a commander).
  useEffect(() => {
    if (!open) return;
    if (forcedAlternateCostId && forcedAlternateCostId.length > 0) {
      setSelectedCostId(forcedAlternateCostId);
      return;
    }
    if (preferredAlternateCostId && preferredAlternateCostId.length > 0) {
      setSelectedCostId(preferredAlternateCostId);
    }
  }, [open, forcedAlternateCostId, preferredAlternateCostId]);

  useEffect(() => {
    if (!open) return;
    setXValue(Number.isFinite(initialXValue) ? Math.max(0, Math.floor(Number(initialXValue))) : 0);
  }, [open, initialXValue]);

  const restrictedPurpose = useMemo(
    () => (
      isActivatedAbilityPayment
        ? { isActivatedAbility: true, isAbility: true }
        : buildRestrictedManaPurposeForSpell(
          { type_line: typeLine || '', oracle_text: oracleText, name: cardName },
          { isCommander: castFromZone === 'command' },
        )
    ),
    [isActivatedAbilityPayment, typeLine, oracleText, cardName, castFromZone],
  );

  // Parse alternate costs from oracle text
  const alternateCosts = useMemo(() => {
    let costs = parseAlternateCosts(oracleText || '', manaCost || '', cardName);

    if (Array.isArray(extraAlternateCosts) && extraAlternateCosts.length > 0) {
      const existingIds = new Set(costs.map(cost => cost.id));
      for (const extraCost of extraAlternateCosts) {
        if (!extraCost) continue;
        if (existingIds.has(extraCost.id)) {
          costs = costs.map((cost) => (cost.id === extraCost.id ? extraCost : cost));
          continue;
        }
        costs.push(extraCost);
        existingIds.add(extraCost.id);
      }
    }

    // Warp is only castable from hand.
    if (castFromZone !== 'hand') {
      costs = costs.filter((cost) => cost.id !== 'warp');
    }

    const normalizedStep = String(currentStep || '').toUpperCase();
    const isDeclareBlockersStep = normalizedStep === 'DECLARE_BLOCKERS' || normalizedStep.includes('BLOCKERS');
    if (!isDeclareBlockersStep) {
      costs = costs.filter((cost) => cost.id !== 'sneak');
    } else if (sneakOptions && sneakOptions.availableCreatures.length === 0) {
      costs = costs.filter((cost) => cost.id !== 'sneak');
    }
    if (!webSlingingOptions || webSlingingOptions.availableCreatures.length === 0) {
      costs = costs.filter((cost) => cost.id !== 'web_slinging');
    }

    costs = filterAlternateCostsForCastZone(costs, castFromZone);

    if (forcedAlternateCostId === 'free' && !costs.some((cost) => cost.id === 'free')) {
      costs = [
        ...costs,
        {
          id: 'free',
          label: 'Free Cast',
          description: 'Cast without paying its mana cost',
          manaCost: '{0}',
        },
      ];
    }

    return costs;
  }, [oracleText, manaCost, cardName, castFromZone, extraAlternateCosts, currentStep, sneakOptions, webSlingingOptions, forcedAlternateCostId]);

  // Get the currently selected cost
  const currentCost = useMemo(() => {
    return alternateCosts.find(c => c.id === selectedCostId) || alternateCosts[0];
  }, [alternateCosts, selectedCostId]);

  // Calculate the reduced mana cost for the currently selected casting cost.
  const effectiveManaCost = useMemo(() => {
    const selectedManaCost = currentCost?.manaCost || manaCost;
    return resolveEffectiveManaCostForCastStep({
      selectedManaCost,
      queuedManaCost: manaCost,
      selectedCostId,
      forcedAlternateCostId,
      costAdjustment,
    });
  }, [currentCost, manaCost, selectedCostId, forcedAlternateCostId, costAdjustment]);

  const alternateCostDisplayMana = useMemo(() => {
    const displayById = new Map<string, string>();
    for (const cost of alternateCosts) {
      displayById.set(cost.id, resolveEffectiveManaCostForCastStep({
        selectedManaCost: cost.manaCost,
        queuedManaCost: manaCost,
        selectedCostId: cost.id,
        forcedAlternateCostId,
        costAdjustment,
      }));
    }
    return displayById;
  }, [alternateCosts, manaCost, forcedAlternateCostId, costAdjustment]);

  const floatingPaymentSources = useMemo(() => {
    if (!manualFloatingManaSelection || !floatingMana) return [] as ManaPaymentSource[];

    const entries: ManaPaymentSource[] = [];
    const poolEntries: Array<[keyof ManaPool, Color]> = [
      ['white', 'W'],
      ['blue', 'U'],
      ['black', 'B'],
      ['red', 'R'],
      ['green', 'G'],
      ['colorless', 'C'],
    ];

    for (const [poolKey, symbol] of poolEntries) {
      const amount = Number(floatingMana[poolKey] || 0);
      if (amount <= 0) continue;
      entries.push({
        id: `__pool__:${String(poolKey)}`,
        name: `Floating {${symbol}} ×${amount.toLocaleString()}`,
        options: [symbol],
        amount,
      });
    }

    const manaSymbols: Record<string, ManaColor> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
      colorless: 'C',
    };
    if (floatingMana.restricted) {
      floatingMana.restricted.forEach((entry, restrictedIndex) => {
        if (!canUseRestrictedManaClient(entry as any, restrictedPurpose)) return;
        const poolKey = String(entry.type || 'colorless');
        const symbol = manaSymbols[poolKey] || 'C';
        const amount = Number(entry.amount || 0);
        if (amount <= 0) return;
        entries.push({
          id: `__pool__:restricted:${restrictedIndex}`,
          name: `Restricted {${symbol}} x${amount.toLocaleString()}`,
          options: [symbol],
          amount,
        });
      });
    }

    return entries;
  }, [floatingMana, manualFloatingManaSelection, restrictedPurpose]);

  const effectiveSuggestedSources = useMemo(
    () => (manualFloatingManaSelection ? [...floatingPaymentSources, ...availableSources] : availableSources),
    [availableSources, floatingPaymentSources, manualFloatingManaSelection]
  );

  // Selected convoke creatures pay part of the (already reduced, X-applied) cost; only the
  // remainder needs mana sources (issue #55).
  const selectedConvokeDetails = useMemo(
    () => (convokeOptions?.availableCreatures || []).filter((c) => selectedConvokeCreatures.includes(c.id)),
    [convokeOptions, selectedConvokeCreatures],
  );
  const spellCostForPayment = useMemo(() => {
    const costToUse = effectiveManaCost || currentCost?.manaCost || manaCost;
    const withX = applyXValueToParsedCost(parseManaCost(costToUse), xValue);
    if (selectedConvokeDetails.length === 0) return withX;
    const { convokeUnused: _unused, ...rest } = applyConvokeToCost(withX, selectedConvokeDetails);
    return rest;
  }, [currentCost, effectiveManaCost, manaCost, xValue, selectedConvokeDetails]);

  // Calculate how much floating mana will be used
  const floatingManaUsage = useMemo(() => {
    if (!floatingMana) return null;
    const costToUse = effectiveManaCost || currentCost?.manaCost || manaCost;
    const cost = applyXValueToParsedCost(parseManaCost(costToUse), xValue);
    const { usedFromPool } = calculateRemainingCostAfterFloatingMana(cost, floatingMana, restrictedPurpose);
    const totalUsed = Object.values(usedFromPool).reduce((a, b) => a + b, 0);
    return totalUsed > 0 ? usedFromPool : null;
  }, [currentCost, effectiveManaCost, manaCost, xValue, floatingMana, restrictedPurpose]);

  const isForceAltCostSelected = selectedCostId === 'force_of_will';
  const isEvokeExileSelected = selectedCostId === 'evoke_exile';
  const skipManaPaymentPicker = isForceAltCostSelected || isEvokeExileSelected || selectedCostId === 'free';

  const explicitPaymentSelectionRequired = useMemo(() => {
    if (!manualFloatingManaSelection || skipManaPaymentPicker) return false;

    const colorCost = Object.values(spellCostForPayment.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
    const totalCost = Number(spellCostForPayment.generic || 0) + colorCost + spellCostForPayment.hybrids.length;

    return totalCost > 0;
  }, [skipManaPaymentPicker, manualFloatingManaSelection, spellCostForPayment]);

  const suggestedPaymentItems = useMemo(() => {
    const colorsToPreserve = computeColorsNeededByOtherCards(otherCardsInHand);
    return buildSuggestedPaymentItems(
      spellCostForPayment,
      effectiveSuggestedSources.filter((source) => !source.sacrificeCost),
      colorsToPreserve,
      floatingMana,
      { includeExplicitPoolItems: manualFloatingManaSelection, purpose: restrictedPurpose },
    );
  }, [
    spellCostForPayment,
    effectiveSuggestedSources,
    otherCardsInHand,
    floatingMana,
    manualFloatingManaSelection,
    restrictedPurpose,
  ]);

  const sequentialSourceById = useMemo(
    () => new Map(effectiveSuggestedSources.map((source) => [source.id, source])),
    [effectiveSuggestedSources],
  );

  const paymentCoversCost = useMemo(() => {
    if (skipManaPaymentPicker) return true;
    const items = payment.length > 0 ? payment : suggestedPaymentItems;
    if (items.length === 0) return true;
    const simulated = simulateSequentialPaymentPool(
      items,
      sequentialSourceById,
      manualFloatingManaSelection ? undefined : manaPoolToColorRecord(floatingMana),
    );
    if (simulated.unpaidActivationPips > 0) return false;
    return canPayCost(spellCostForPayment, simulated.pool);
  }, [
    skipManaPaymentPicker,
    payment,
    suggestedPaymentItems,
    sequentialSourceById,
    manualFloatingManaSelection,
    floatingMana,
    spellCostForPayment,
  ]);

  useEffect(() => {
    if (!open) return;
    setPayment(suggestedPaymentItems);
  }, [open, suggestedPaymentItems, selectedCostId, xValue]);

  if (!open) return null;

  const handleConfirm = () => {
    // If no payment was manually selected, use the suggested payment
    let finalPayment = payment;
    if (payment.length === 0 && suggestedPaymentItems.length > 0) {
      finalPayment = suggestedPaymentItems;
    }

    if (explicitPaymentSelectionRequired && finalPayment.length === 0) {
      return;
    }

    if (!skipManaPaymentPicker && finalPayment.length > 0) {
      const simulated = simulateSequentialPaymentPool(
        finalPayment,
        sequentialSourceById,
        manualFloatingManaSelection ? undefined : manaPoolToColorRecord(floatingMana),
      );
      if (simulated.unpaidActivationPips > 0 || !canPayCost(spellCostForPayment, simulated.pool)) {
        return;
      }
    }

    const effectiveCostId = forcedAlternateCostId && forcedAlternateCostId.length > 0
      ? forcedAlternateCostId
      : selectedCostId;

    if (effectiveCostId === 'sneak' && !selectedSneakCreatureId) {
      return;
    }
    if (effectiveCostId === 'web_slinging' && !selectedWebSlingingCreatureId) {
      return;
    }

    onConfirm(
      finalPayment,
      effectiveCostId !== 'normal' ? effectiveCostId : undefined,
      xValue,
      selectedConvokeCreatures.length > 0 ? selectedConvokeCreatures : undefined,
      effectiveCostId === 'sneak' ? selectedSneakCreatureId : undefined,
      effectiveCostId === 'web_slinging' ? selectedWebSlingingCreatureId : undefined,
    );
    setPayment([]);
    setXValue(0);
    setSelectedCostId('normal');
    setSelectedConvokeCreatures([]);
    setSelectedSneakCreatureId('');
    setSelectedWebSlingingCreatureId('');
  };

  const handleCancel = () => {
    onCancel();
    setPayment([]);
    setXValue(0);
    setSelectedCostId('normal');
    setSelectedConvokeCreatures([]);
  };

  // Check if there's floating mana that will be used
  const hasFloatingManaToUse = floatingManaUsage && Object.values(floatingManaUsage).some(v => v > 0);
  
  // Show alternate cost selector if there are options
  const showAlternateCosts = alternateCosts.length > 1 && !(forcedAlternateCostId && forcedAlternateCostId.length > 0);

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title || `Cast ${cardName}`}</h3>
          <button onClick={handleCancel} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>

        {/* Alternate Cost Selector */}
        {showAlternateCosts && (
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: 8,
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>
              Choose Casting Cost:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alternateCosts.map(cost => (
                <label
                  key={cost.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '8px 10px',
                    backgroundColor: selectedCostId === cost.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: selectedCostId === cost.id ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="castingCost"
                    checked={selectedCostId === cost.id}
                    onChange={() => setSelectedCostId(cost.id)}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{cost.label}</span>
                      {!cost.hideManaCost && <span style={{ 
                        fontFamily: 'monospace', 
                        backgroundColor: 'rgba(0,0,0,0.3)', 
                        padding: '2px 6px', 
                        borderRadius: 4,
                        fontSize: 12,
                      }}>
                        {alternateCostDisplayMana.get(cost.id) || cost.manaCost || '{0}'}
                      </span>}
                      {alternateCostDisplayMana.get(cost.id)
                        && cost.manaCost
                        && alternateCostDisplayMana.get(cost.id) !== cost.manaCost && (
                        <span style={{ fontSize: 11, color: '#888', textDecoration: 'line-through' }}>
                          {cost.manaCost}
                        </span>
                      )}
                    </div>
                    {cost.description && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {cost.description}
                      </div>
                    )}
                    {cost.additionalCost && (
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                        ⚠ {cost.additionalCost}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Cost Adjustment Display */}
        {costAdjustment && costAdjustment.sources.length > 0 && (
          <div style={{
            marginBottom: 12,
            padding: 10,
            backgroundColor: costAdjustment.kind === 'increase'
              ? 'rgba(245, 158, 11, 0.1)'
              : costAdjustment.kind === 'mixed'
                ? 'rgba(59, 130, 246, 0.1)'
                : 'rgba(16, 185, 129, 0.1)',
            borderRadius: 8,
            border: costAdjustment.kind === 'increase'
              ? '1px solid rgba(245, 158, 11, 0.3)'
              : costAdjustment.kind === 'mixed'
                ? '1px solid rgba(59, 130, 246, 0.3)'
                : '1px solid rgba(16, 185, 129, 0.3)',
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 600,
              color: costAdjustment.kind === 'increase'
                ? '#f59e0b'
                : costAdjustment.kind === 'mixed'
                  ? '#60a5fa'
                  : '#10b981',
              marginBottom: 4,
            }}>
              {costAdjustment.kind === 'increase'
                ? 'Cost Increases:'
                : costAdjustment.kind === 'mixed'
                  ? 'Cost Adjustments:'
                  : 'Cost Reductions:'}
            </div>
            {(() => {
              const usesServerResolvedPaymentLine = selectedCostId === 'normal'
                || (Boolean(forcedAlternateCostId) && selectedCostId === forcedAlternateCostId);
              const selectedManaCost = usesServerResolvedPaymentLine
                ? (costAdjustment.originalManaCost || currentCost?.manaCost || manaCost)
                : (currentCost?.manaCost || manaCost);
              return selectedManaCost && effectiveManaCost !== selectedManaCost;
            })() && (
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>
                  {(() => {
                    const usesServerResolvedPaymentLine = selectedCostId === 'normal'
                      || (Boolean(forcedAlternateCostId) && selectedCostId === forcedAlternateCostId);
                    return usesServerResolvedPaymentLine
                      ? (costAdjustment.originalManaCost || currentCost?.manaCost || manaCost)
                      : (currentCost?.manaCost || manaCost);
                  })()}
                </span>
                {' → '}
                <span style={{
                  fontWeight: 600,
                  color: costAdjustment.kind === 'increase'
                    ? '#f59e0b'
                    : costAdjustment.kind === 'mixed'
                      ? '#60a5fa'
                      : '#10b981',
                }}>
                  {effectiveManaCost}
                </span>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#888' }}>
              {costAdjustment.sources.map((source, i) => (
                <div key={i}>• {source.message}</div>
              ))}
            </div>
          </div>
        )}

        {/* Convoke Options */}
        {convokeOptions && convokeOptions.availableCreatures.length > 0 && (
          <div style={{
            marginBottom: 12,
            padding: 10,
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderRadius: 8,
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6', marginBottom: 6 }}>
              ⚡ Convoke: Tap Creatures to Help Pay
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              Each creature tapped pays for {'{1}'} or one mana of its color
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {convokeOptions.availableCreatures.map(creature => (
                <label
                  key={creature.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    backgroundColor: selectedConvokeCreatures.includes(creature.id) ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: selectedConvokeCreatures.includes(creature.id) ? '1px solid rgba(139, 92, 246, 0.5)' : '1px solid transparent',
                    transition: 'all 0.15s',
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedConvokeCreatures.includes(creature.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedConvokeCreatures([...selectedConvokeCreatures, creature.id]);
                      } else {
                        setSelectedConvokeCreatures(selectedConvokeCreatures.filter(id => id !== creature.id));
                      }
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 500 }}>{creature.name}</span>
                    <span style={{ color: '#888', marginLeft: 8, fontSize: 11 }}>
                      (pays: {creature.canTapFor.slice(0, 3).join(', ')}{creature.canTapFor.length > 3 ? '...' : ''})
                    </span>
                  </div>
                </label>
              ))}
            </div>
            {selectedConvokeCreatures.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#8b5cf6' }}>
                ✓ Tapping {selectedConvokeCreatures.length} creature{selectedConvokeCreatures.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {selectedCostId === 'sneak' && sneakOptions && sneakOptions.availableCreatures.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, background: '#1a1a2e', borderRadius: 8, border: '1px solid #334155' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#fbbf24' }}>
              Return an unblocked attacker to hand
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sneakOptions.availableCreatures.map((creature) => (
                <label
                  key={creature.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: selectedSneakCreatureId === creature.id ? '#2d3748' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="sneak-creature"
                    checked={selectedSneakCreatureId === creature.id}
                    onChange={() => setSelectedSneakCreatureId(creature.id)}
                  />
                  <span style={{ fontWeight: 500 }}>{creature.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedCostId === 'web_slinging' && webSlingingOptions && webSlingingOptions.availableCreatures.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, background: '#1a1a2e', borderRadius: 8, border: '1px solid #334155' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#fbbf24' }}>
              Return a tapped creature you control
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {webSlingingOptions.availableCreatures.map((creature) => (
                <label key={creature.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: selectedWebSlingingCreatureId === creature.id ? '#2d3748' : 'transparent' }}>
                  <input type="radio" name="web-slinging-creature" checked={selectedWebSlingingCreatureId === creature.id} onChange={() => setSelectedWebSlingingCreatureId(creature.id)} />
                  <span style={{ fontWeight: 500 }}>{creature.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Show floating mana pool if available */}
        {floatingMana && (
          <div style={{ marginBottom: 12 }}>
            <FloatingManaPool manaPool={floatingMana} compact />
            {!manualFloatingManaSelection && hasFloatingManaToUse && (
              <div style={{ 
                marginTop: 6, 
                fontSize: 12, 
                color: '#68d391',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                ✓ Will use floating mana: {
                  Object.entries(floatingManaUsage!)
                    .filter(([_, v]) => v > 0)
                    .map(([color, amount]) => `${amount} ${color}`)
                    .join(', ')
                }
              </div>
            )}
          </div>
        )}

        {skipManaPaymentPicker ? (
          <div style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 8,
            border: '1px solid rgba(59, 130, 246, 0.35)',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            fontSize: 13,
            color: '#cbd5e1',
          }}>
            {isEvokeExileSelected
              ? `No mana payment required. After confirming, you'll be prompted to ${String(currentCost?.additionalCost || 'exile a card from your hand').split(';')[0].toLowerCase()}.`
              : isForceAltCostSelected
              ? 'No mana payment required. You’ll be prompted to exile a blue card (and pay life if applicable) after confirming.'
              : 'No mana payment required. This spell is being cast without paying its mana cost.'}
          </div>
        ) : (
          <PaymentPicker
            manaCost={effectiveManaCost || currentCost?.manaCost || manaCost}
            manaCostDisplay={effectiveManaCost || currentCost?.manaCost || manaCost}
            sources={availableSources}
            battlefieldPermanents={battlefieldPermanents}
            chosen={payment}
            xValue={xValue}
            onChangeX={setXValue}
            onChange={setPayment}
            otherCardsInHand={otherCardsInHand}
            floatingMana={floatingMana}
            typeLine={typeLine}
            oracleText={oracleText}
            isCommander={castFromZone === 'command'}
            isActivatedAbilityPayment={isActivatedAbilityPayment}
            manualFloatingManaSelection={manualFloatingManaSelection}
            autoSelectedPayment={suggestedPaymentItems}
          />
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={
              (explicitPaymentSelectionRequired && payment.length === 0 && suggestedPaymentItems.length === 0)
              || (payment.length > 0 && !paymentCoversCost)
            }
            style={{
              background: (explicitPaymentSelectionRequired && payment.length === 0 && suggestedPaymentItems.length === 0)
                || (payment.length > 0 && !paymentCoversCost)
                ? '#4b5563'
                : '#2b6cb0',
              color: '#fff',
              border: 'none',
              padding: '6px 16px',
              borderRadius: 6,
              cursor: (explicitPaymentSelectionRequired && payment.length === 0 && suggestedPaymentItems.length === 0)
                || (payment.length > 0 && !paymentCoversCost)
                ? 'not-allowed'
                : 'pointer',
              opacity: (explicitPaymentSelectionRequired && payment.length === 0 && suggestedPaymentItems.length === 0)
                || (payment.length > 0 && !paymentCoversCost)
                ? 0.7
                : 1,
            }}
          >
            {confirmLabel || (selectedCostId !== 'normal' ? `Cast with ${currentCost?.label}` : 'Cast Spell')}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const modal: React.CSSProperties = {
  background: '#1d1f21',
  border: '1px solid #444',
  borderRadius: 8,
  padding: '16px 20px',
  minWidth: 500,
  maxWidth: 700,
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
  color: '#eee',
};
