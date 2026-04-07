import React, { useMemo } from 'react';
import type { BattlefieldPermanent, PaymentItem, ManaColor } from '../../../shared/src';
import {
  Color,
  MANA_COLORS,
  parseManaCost,
  paymentToPool,
  canPayCost,
  computeColorsNeededByOtherCards,
  calculateSuggestedPayment,
  calculateRemainingCostAfterFloatingMana,
  getTotalManaProduction,
  type ManaPaymentSource,
  type SuggestedPaymentSelection,
  type OtherCardInfo,
  type ManaPool,
} from '../utils/manaUtils';
import { SacrificeSelectionModal } from './SacrificeSelectionModal';

function canPayEnhanced(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>): boolean {
  return canPayCost(cost, pool);
}

function remainingAfter(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>) {
  const leftColors: Record<Color, number> = { ...cost.colors };
  const leftPool: Record<Color, number> = { ...pool };
  // consume fixed colors
  for (const c of MANA_COLORS) {
    const use = Math.min(leftColors[c], leftPool[c]);
    leftColors[c] -= use;
    leftPool[c] -= use;
  }
  // consume hybrids
  const unsatisfiedHybrids: Color[][] = [];
  for (const g of cost.hybrids) {
    let ok = false;
    for (const c of g) {
      if (leftPool[c] > 0) { leftPool[c] -= 1; ok = true; break; }
    }
    if (!ok) unsatisfiedHybrids.push(g);
  }
  // generic
  const totalPool = MANA_COLORS.reduce((a, c) => a + leftPool[c], 0);
  const leftGeneric = Math.max(0, cost.generic - totalPool);
  return { colors: leftColors, hybrids: unsatisfiedHybrids, generic: leftGeneric };
}

function costBadge(label: string, n: number, variant: 'default' | 'selected' = 'default') {
  if (n <= 0) return null;
  
  const styles = variant === 'selected' 
    ? { 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: 4, 
        padding: '2px 8px', 
        border: '1px solid #2b6cb0', 
        borderRadius: 12, 
        fontSize: 12, 
        background: '#ebf8ff', 
        color: '#1a365d',
        fontWeight: 500,
      }
    : { 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: 4, 
        padding: '2px 6px', 
        border: '1px solid #ddd', 
        borderRadius: 12, 
        fontSize: 12, 
        background: '#fafafa',
        color: '#333',
      };
  
  return (
    <span key={label} style={styles}>
      {label} × {n}
    </span>
  );
}

export interface ConvokeCreature {
  id: string;
  name: string;
  colors: Color[];  // Colors this creature can pay for
}

export interface PaymentPickerProps {
  manaCost?: string;
  manaCostDisplay?: string;
  sources: ManaPaymentSource[];
  battlefieldPermanents?: BattlefieldPermanent[];
  chosen: PaymentItem[];
  xValue?: number;
  onChangeX?: (x: number) => void;
  onChange: (next: PaymentItem[]) => void;
  otherCardsInHand?: OtherCardInfo[];
  floatingMana?: ManaPool;
  // Convoke support
  hasConvoke?: boolean;
  convokeCreatures?: ConvokeCreature[];
  chosenConvokeCreatures?: string[];  // IDs of creatures tapped for convoke
  onConvokeChange?: (creatureIds: string[]) => void;
  // Floating mana usage state
  onClearFloatingMana?: () => void;
  manualFloatingManaSelection?: boolean;
}

export function PaymentPicker(props: PaymentPickerProps) {
  const { 
    manaCost, 
    manaCostDisplay, 
    sources, 
    battlefieldPermanents = [],
    chosen, 
    xValue = 0, 
    onChangeX, 
    onChange, 
    otherCardsInHand = [], 
    floatingMana,
    hasConvoke = false,
    convokeCreatures = [],
    chosenConvokeCreatures = [],
    onConvokeChange,
    onClearFloatingMana,
    manualFloatingManaSelection = false,
  } = props;

  const parsed = useMemo(() => parseManaCost(manaCost), [manaCost]);
  // For XX costs, multiply xValue by the number of X's (xCount)
  // Example: {X}{X}{G} with xValue=7 means you pay 14 generic + G to create 7 tokens
  const xMultiplier = parsed.xCount || 1;
  const cost = useMemo(() => ({ colors: parsed.colors, generic: parsed.generic + Math.max(0, Number(xValue || 0) * xMultiplier), hybrids: parsed.hybrids }), [parsed, xValue, xMultiplier]);
  
  // Calculate remaining cost after floating mana
  const floatingSources = useMemo(() => {
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
      for (let index = 0; index < amount; index++) {
        entries.push({
          id: `__pool__:${String(poolKey)}:${index}`,
          name: `Floating {${symbol}}`,
          options: [symbol],
          amount: 1,
        });
      }
    }

    return entries;
  }, [floatingMana, manualFloatingManaSelection]);

  const effectiveSources = useMemo(
    () => (manualFloatingManaSelection ? [...floatingSources, ...sources] : sources),
    [floatingSources, manualFloatingManaSelection, sources]
  );

  const { colors: costAfterFloating, generic: genericAfterFloating, hybrids: hybridsAfterFloating, usedFromPool } = useMemo(() => {
    if (manualFloatingManaSelection) {
      return {
        colors: { ...cost.colors },
        generic: cost.generic,
        hybrids: [...cost.hybrids],
        usedFromPool: {},
      };
    }

    return calculateRemainingCostAfterFloatingMana(cost, floatingMana);
  }, [cost, floatingMana, manualFloatingManaSelection]);
  const costForPayment = useMemo(() => ({ 
    colors: costAfterFloating, 
    generic: genericAfterFloating, 
    hybrids: hybridsAfterFloating 
  }), [costAfterFloating, genericAfterFloating, hybridsAfterFloating]);
  
  // Check if floating mana is being used
  const hasFloatingManaUsed = useMemo(() => {
    return usedFromPool && Object.values(usedFromPool).some(v => v > 0);
  }, [usedFromPool]);
  
  const pool = useMemo(() => paymentToPool(chosen), [chosen]);
  const satisfied = useMemo(() => canPayEnhanced(costForPayment, pool), [costForPayment, pool]);
  const remaining = useMemo(() => remainingAfter(costForPayment, pool), [costForPayment, pool]);

  const getPaymentItemKey = (item: PaymentItem) => String(item.paymentSourceId || item.permanentId || '');
  const getSourcePermanentId = (source: ManaPaymentSource) => String(source.sourcePermanentId || source.id || '');

  const chosenById = useMemo(() => new Set(chosen.map(getPaymentItemKey)), [chosen]);

  const [pendingSacrificeSelection, setPendingSacrificeSelection] = React.useState<{
    source: ManaPaymentSource;
    mana: Color;
  } | null>(null);

  // Calculate colors needed by other cards in hand
  const colorsToPreserve = useMemo(() => computeColorsNeededByOtherCards(otherCardsInHand), [otherCardsInHand]);
  const sourcesEligibleForSuggestion = useMemo(
    () => effectiveSources.filter((source) => !source.sacrificeCost),
    [effectiveSources]
  );
  
  // Calculate suggested payment when no sources have been chosen yet (considers floating mana)
  const suggestedPayment = useMemo(() => {
    if (chosen.length > 0) return new Map<string, SuggestedPaymentSelection>();
    return calculateSuggestedPayment(cost, sourcesEligibleForSuggestion, colorsToPreserve, manualFloatingManaSelection ? undefined : floatingMana);
  }, [cost, sourcesEligibleForSuggestion, colorsToPreserve, chosen.length, floatingMana, manualFloatingManaSelection]);

  const sourceById = useMemo(() => new Map(effectiveSources.map((source) => [source.id, source])), [effectiveSources]);

  const getConsumableSourcesForIds = (sourceIds: Iterable<string>): ManaPaymentSource[] => {
    const seen = new Set<string>();
    const result: ManaPaymentSource[] = [];
    for (const sourceId of sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source || source.consumable !== true || seen.has(source.id)) continue;
      seen.add(source.id);
      result.push(source);
    }
    return result;
  };

  const selectedConsumableSources = useMemo(
    () => getConsumableSourcesForIds(chosen.map(getPaymentItemKey)),
    [chosen, sourceById]
  );

  const selectedSacrificeCostSources = useMemo(() => {
    const seen = new Set<string>();
    const result: ManaPaymentSource[] = [];
    for (const item of chosen) {
      const source = sourceById.get(getPaymentItemKey(item));
      if (!source || !source.sacrificeCost || seen.has(source.id)) continue;
      seen.add(source.id);
      result.push(source);
    }
    return result;
  }, [chosen, sourceById]);

  const suggestedConsumableSources = useMemo(
    () => getConsumableSourcesForIds(suggestedPayment.keys()),
    [suggestedPayment, sourceById]
  );

  const consumableWarning = useMemo(() => {
    const warnedSources = selectedConsumableSources.length > 0
      ? selectedConsumableSources
      : suggestedConsumableSources;

    if (warnedSources.length === 0 && selectedSacrificeCostSources.length === 0) return null;

    if (warnedSources.length === 0 && selectedSacrificeCostSources.length > 0) {
      const sourceNames = selectedSacrificeCostSources.map((source) => source.name).join(', ');
      return `Selected payment requires sacrificing other permanents via: ${sourceNames}.`;
    }

    const sourceNames = warnedSources.map((source) => source.name).join(', ');
    const prefix = selectedConsumableSources.length > 0
      ? 'Selected payment uses'
      : 'Suggested payment includes';

    return `${prefix} consumable mana source${warnedSources.length === 1 ? '' : 's'}: ${sourceNames}. These will be used up as part of payment.`;
  }, [selectedConsumableSources, selectedSacrificeCostSources, suggestedConsumableSources]);

  // Helper to get mana count for a source - uses amount if specified (for Priest of Titania, etc.)
  // Uses getTotalManaProduction which correctly handles choice sources vs multi-mana sources:
  // - Sol Ring ['C','C'] = 2 mana (duplicates = multi-mana)
  // - Command Tower ['W','U','B','R','G'] = 1 mana (all unique = choice)
  // - Priest of Titania with amount=7 ['G'] = 7 mana
  const getManaCountForSource = (permanentId: string): number => {
    const source = effectiveSources.find(s => s.id === permanentId);
    if (!source) return 1;
    // Use explicit amount if provided (for devotion/creature-count mana)
    if (source.amount && source.amount > 0) return source.amount;
    return getTotalManaProduction(source.options);
  };

  const createPaymentItem = (source: ManaPaymentSource, mana: Color, sacrificedPermanentIds?: string[]): PaymentItem => {
    const count = getManaCountForSource(source.id);
    const actualPermanentId = getSourcePermanentId(source);
    return {
      permanentId: actualPermanentId,
      ...(source.id !== actualPermanentId ? { paymentSourceId: source.id } : {}),
      mana,
      count,
      ...(Array.isArray(sacrificedPermanentIds) && sacrificedPermanentIds.length > 0 ? { sacrificedPermanentIds } : {}),
    };
  };

  const add = (source: ManaPaymentSource, mana: Color) => {
    if (chosenById.has(source.id)) return;
    if (source.sacrificeCost) {
      setPendingSacrificeSelection({ source, mana });
      return;
    }
    onChange([...chosen, createPaymentItem(source, mana)]);
  };
  const remove = (sourceId: string) => {
    onChange(chosen.filter((payment) => getPaymentItemKey(payment) !== sourceId));
  };
  
  // Clear all selections including floating mana
  const clear = () => {
    onChange([]);
    if (!manualFloatingManaSelection && onClearFloatingMana) {
      onClearFloatingMana();
    }
  };

  const doAutoSelect = () => {
    // Use the suggested payment to auto-fill (considers floating mana)
    if (suggestedPayment.size === 0) {
      // Recalculate if already chosen some
      const newSuggested = calculateSuggestedPayment(cost, sourcesEligibleForSuggestion, colorsToPreserve, manualFloatingManaSelection ? undefined : floatingMana);
      const newPayment: PaymentItem[] = [];
      for (const [permanentId, selection] of newSuggested.entries()) {
        const source = sourceById.get(permanentId);
        newPayment.push(source ? createPaymentItem(source, selection.color) : { permanentId, mana: selection.color, count: selection.count });
      }
      onChange(newPayment);
    } else {
      const newPayment: PaymentItem[] = [];
      for (const [permanentId, selection] of suggestedPayment.entries()) {
        const source = sourceById.get(permanentId);
        newPayment.push(source ? createPaymentItem(source, selection.color) : { permanentId, mana: selection.color, count: selection.count });
      }
      onChange(newPayment);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 420 }}>
      {/* Raw cost display */}
      <div style={{ fontSize: 12, opacity: 0.8 }}>Cost: {manaCostDisplay || manaCost || '(none)'}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Cost breakdown:</b>
        {MANA_COLORS.map(c => costBadge(c, parsed.colors[c]))}
        {parsed.hybrids.length > 0 && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Hybrid: {parsed.hybrids.map((g, i) => <span key={i} style={{ border: '1px solid #ddd', borderRadius: 12, padding: '2px 6px', fontSize: 12 }}>{g.join('/')}</span>)}
        </span>}
        {costBadge('Generic', parsed.generic)}
        {parsed.hasX && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            X:
            <input
              type="number"
              min={0}
              value={xValue}
              onChange={e => onChangeX && onChangeX(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 64 }}
              title="Set X value"
            />
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#1a365d' }}>Selected:</b>
        {MANA_COLORS.map(c => costBadge(c, pool[c], 'selected'))}
        {Object.values(pool).every(v => v === 0) && <span style={{ fontSize: 12, color: '#666' }}>None (leave empty to auto-pay)</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Remaining:</b>
        {MANA_COLORS.map(c => costBadge(c, remaining.colors[c]))}
        {remaining.hybrids.length > 0 && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Hybrid: {remaining.hybrids.map((g, i) => <span key={i} style={{ border: '1px solid #ddd', borderRadius: 12, padding: '2px 6px', fontSize: 12 }}>{g.join('/')}</span>)}
        </span>}
        {costBadge('Generic', remaining.generic)}
        {satisfied && <span style={{ fontSize: 12, color: '#2b6cb0' }}>Cost satisfied</span>}
      </div>

      {/* Show colors being preserved for other cards */}
      {colorsToPreserve.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#7cb342' }}>
          <span>Colors needed for other cards:</span>
          {Array.from(colorsToPreserve).map(c => (
            <span key={c} style={{ border: '1px solid #7cb342', borderRadius: 8, padding: '1px 6px', background: 'rgba(124, 179, 66, 0.1)' }}>
              {c}
            </span>
          ))}
        </div>
      )}

      {consumableWarning && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(217, 119, 6, 0.35)',
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#92400e',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          Warning: {consumableWarning}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Sources:</b>
        <button 
          onClick={clear} 
          disabled={chosen.length === 0 && !hasFloatingManaUsed} 
          title={hasFloatingManaUsed ? "Clear selected payment and floating mana usage" : "Clear selected payment"}
        >
          Clear
        </button>
        <button onClick={doAutoSelect} disabled={sources.length === 0 || satisfied} title="Auto-select mana (considers other cards in hand)">
          Auto-select
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Tip: Green border = suggested source</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, maxHeight: 220, overflow: 'auto', paddingRight: 2 }}>
        {effectiveSources.map(s => {
          const used = chosenById.has(s.id);
          const suggested = suggestedPayment.get(s.id);
          const isSuggested = suggested !== undefined && !used;
          const hasAmount = s.amount && s.amount > 1;
          const isFloatingSource = s.id.startsWith('__pool__:');
          
          return (
            <div 
              key={s.id} 
              style={{ 
                border: isSuggested ? '2px solid #4caf50' : '1px solid #ddd', 
                borderRadius: 8, 
                padding: 8, 
                background: used ? '#f6f6f6' : isSuggested ? 'rgba(76, 175, 80, 0.08)' : '#fff', 
                color: '#222',
                boxShadow: isSuggested ? '0 0 8px rgba(76, 175, 80, 0.3)' : 'none'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#111' }} title={s.name}>{s.name}</div>
                {used ? (
                  <button onClick={() => remove(s.id)} style={{ fontSize: 11 }} title="Remove this payment">Remove</button>
                ) : isSuggested ? (
                  <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>suggested</span>
                ) : (
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{isFloatingSource ? 'floating' : 'untapped'}</span>
                )}
              </div>
              {s.consumable && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#b45309',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: 'rgba(245, 158, 11, 0.14)',
                      border: '1px solid rgba(217, 119, 6, 0.28)',
                    }}
                  >
                    consumable
                  </span>
                </div>
              )}
              {s.sacrificeCost && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#7c3aed',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: 'rgba(139, 92, 246, 0.14)',
                      border: '1px solid rgba(124, 58, 237, 0.28)',
                    }}
                  >
                    sacrifice required
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {hasAmount && (
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 600, 
                    color: '#2563eb',
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    border: '1px solid rgba(37, 99, 235, 0.3)'
                  }}>
                    {s.amount}×
                  </span>
                )}
                {s.options.map(opt => {
                  const isSuggestedColor = suggested?.color === opt;
                  const displayText = hasAmount && s.options.length === 1 ? `{${opt}}` : opt;
                  return (
                    <button
                      key={`${s.id}:${opt}`}
                      onClick={() => add(s, opt)}
                      disabled={used}
                      style={{ 
                        padding: '2px 6px', 
                        fontSize: 12, 
                        borderRadius: 6, 
                        border: isSuggestedColor ? '2px solid #4caf50' : '1px solid #ccc',
                        background: isSuggestedColor ? 'rgba(76, 175, 80, 0.15)' : 'transparent',
                        fontWeight: isSuggestedColor ? 600 : 400
                      }}
                      title={used ? 'Already used' : isSuggestedColor ? `Suggested: Add ${suggested?.count || 1} ${opt}` : `Add ${hasAmount ? `${s.amount}×` : ''}${opt}`}
                    >
                      {displayText}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {effectiveSources.length === 0 && (
          <div style={{ opacity: 0.7, fontSize: 12 }}>No untapped mana sources available</div>
        )}
      </div>

      {/* Convoke Section */}
      {hasConvoke && convokeCreatures.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(168, 85, 247, 0.1)', borderRadius: 8, border: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#a855f7' }}>🎭 Convoke</span>
            <span style={{ fontSize: 12, color: '#888' }}>
              Tap creatures to pay for colored or generic mana ({chosenConvokeCreatures.length} selected)
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, maxHeight: 160, overflow: 'auto' }}>
            {convokeCreatures.map(creature => {
              const isSelected = chosenConvokeCreatures.includes(creature.id);
              return (
                <div
                  key={creature.id}
                  onClick={() => {
                    if (!onConvokeChange) return;
                    if (isSelected) {
                      onConvokeChange(chosenConvokeCreatures.filter(id => id !== creature.id));
                    } else {
                      onConvokeChange([...chosenConvokeCreatures, creature.id]);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: isSelected ? '2px solid #a855f7' : '1px solid rgba(168, 85, 247, 0.3)',
                    backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    style={{ pointerEvents: 'none' }}
                  />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ 
                      fontWeight: 500, 
                      fontSize: 12, 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis' 
                    }}>
                      {creature.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#888', display: 'flex', gap: 4 }}>
                      {creature.colors.length > 0 ? (
                        creature.colors.map(c => (
                          <span key={c} style={{ 
                            padding: '1px 4px', 
                            borderRadius: 3, 
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            fontSize: 9,
                          }}>
                            {c}
                          </span>
                        ))
                      ) : (
                        <span>Generic only</span>
                      )}
                    </div>
                  </div>
                  {isSelected && (
                    <span style={{ color: '#a855f7', fontWeight: 600, fontSize: 14 }}>✓</span>
                  )}
                </div>
              );
            })}
          </div>
          {chosenConvokeCreatures.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#a855f7' }}>
              Tapping {chosenConvokeCreatures.length} creature{chosenConvokeCreatures.length !== 1 ? 's' : ''} to reduce cost by {chosenConvokeCreatures.length} mana
            </div>
          )}
        </div>
      )}

      <SacrificeSelectionModal
        open={pendingSacrificeSelection !== null}
        title={pendingSacrificeSelection ? `${pendingSacrificeSelection.source.name} - Choose Sacrifice` : 'Choose Sacrifice'}
        description={pendingSacrificeSelection
          ? `Select ${pendingSacrificeSelection.source.sacrificeCost?.count || 1} permanent(s) to sacrifice for ${pendingSacrificeSelection.source.name} and add ${pendingSacrificeSelection.mana}.`
          : ''}
        permanents={battlefieldPermanents}
        count={pendingSacrificeSelection?.source.sacrificeCost?.count || 1}
        permanentType={pendingSacrificeSelection?.source.sacrificeCost?.permanentType}
        creatureSubtype={pendingSacrificeSelection?.source.sacrificeCost?.creatureSubtype}
        excludePermanentId={pendingSacrificeSelection?.source.sacrificeCost?.mustBeOther ? getSourcePermanentId(pendingSacrificeSelection.source) : undefined}
        onConfirm={(selectedIds) => {
          if (!pendingSacrificeSelection) return;
          onChange([...chosen, createPaymentItem(pendingSacrificeSelection.source, pendingSacrificeSelection.mana, selectedIds)]);
          setPendingSacrificeSelection(null);
        }}
        onCancel={() => setPendingSacrificeSelection(null)}
      />
    </div>
  );
}