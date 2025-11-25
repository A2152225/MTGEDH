import React, { useMemo } from 'react';
import type { PaymentItem, ManaColor } from '../../../shared/src';
import {
  Color,
  MANA_COLORS,
  parseManaCost,
  paymentToPool,
  canPayCost,
  computeColorsNeededByOtherCards,
  calculateSuggestedPayment,
  calculateRemainingCostAfterFloatingMana,
  type OtherCardInfo,
  type ManaPool,
} from '../utils/manaUtils';

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

export function PaymentPicker(props: {
  manaCost?: string;
  manaCostDisplay?: string;
  sources: Array<{ id: string; name: string; options: Color[] }>;
  chosen: PaymentItem[];
  xValue?: number;
  onChangeX?: (x: number) => void;
  onChange: (next: PaymentItem[]) => void;
  otherCardsInHand?: OtherCardInfo[];
  floatingMana?: ManaPool;
}) {
  const { manaCost, manaCostDisplay, sources, chosen, xValue = 0, onChangeX, onChange, otherCardsInHand = [], floatingMana } = props;

  const parsed = useMemo(() => parseManaCost(manaCost), [manaCost]);
  const cost = useMemo(() => ({ colors: parsed.colors, generic: parsed.generic + Math.max(0, Number(xValue || 0) | 0), hybrids: parsed.hybrids }), [parsed, xValue]);
  
  // Calculate remaining cost after floating mana
  const { colors: costAfterFloating, generic: genericAfterFloating, hybrids: hybridsAfterFloating } = useMemo(() => 
    calculateRemainingCostAfterFloatingMana(cost, floatingMana), 
    [cost, floatingMana]
  );
  const costForPayment = useMemo(() => ({ 
    colors: costAfterFloating, 
    generic: genericAfterFloating, 
    hybrids: hybridsAfterFloating 
  }), [costAfterFloating, genericAfterFloating, hybridsAfterFloating]);
  
  const pool = useMemo(() => paymentToPool(chosen), [chosen]);
  const satisfied = useMemo(() => canPayEnhanced(costForPayment, pool), [costForPayment, pool]);
  const remaining = useMemo(() => remainingAfter(costForPayment, pool), [costForPayment, pool]);

  const chosenById = useMemo(() => new Set(chosen.map(p => p.permanentId)), [chosen]);

  // Calculate colors needed by other cards in hand
  const colorsToPreserve = useMemo(() => computeColorsNeededByOtherCards(otherCardsInHand), [otherCardsInHand]);
  
  // Calculate suggested payment when no sources have been chosen yet (considers floating mana)
  const suggestedPayment = useMemo(() => {
    if (chosen.length > 0) return new Map<string, Color>();
    return calculateSuggestedPayment(cost, sources, colorsToPreserve, floatingMana);
  }, [cost, sources, colorsToPreserve, chosen.length, floatingMana]);

  const add = (permanentId: string, mana: Color) => {
    if (chosenById.has(permanentId)) return; // one per source
    onChange([...chosen, { permanentId, mana }]);
  };
  const remove = (permanentId: string) => {
    onChange(chosen.filter(p => p.permanentId !== permanentId));
  };
  const clear = () => onChange([]);

  const doAutoSelect = () => {
    // Use the suggested payment to auto-fill (considers floating mana)
    if (suggestedPayment.size === 0) {
      // Recalculate if already chosen some
      const newSuggested = calculateSuggestedPayment(cost, sources, colorsToPreserve, floatingMana);
      const newPayment: PaymentItem[] = [];
      for (const [permanentId, mana] of newSuggested.entries()) {
        newPayment.push({ permanentId, mana });
      }
      onChange(newPayment);
    } else {
      const newPayment: PaymentItem[] = [];
      for (const [permanentId, mana] of suggestedPayment.entries()) {
        newPayment.push({ permanentId, mana });
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Sources:</b>
        <button onClick={clear} disabled={chosen.length === 0} title="Clear selected payment">Clear</button>
        <button onClick={doAutoSelect} disabled={sources.length === 0 || satisfied} title="Auto-select mana (considers other cards in hand)">
          Auto-select
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Tip: Green border = suggested source</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, maxHeight: 220, overflow: 'auto', paddingRight: 2 }}>
        {sources.map(s => {
          const used = chosenById.has(s.id);
          const suggested = suggestedPayment.get(s.id);
          const isSuggested = suggested !== undefined && !used;
          
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
                  <span style={{ fontSize: 11, opacity: 0.7 }}>untapped</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {s.options.map(opt => {
                  const isSuggestedColor = suggested === opt;
                  return (
                    <button
                      key={`${s.id}:${opt}`}
                      onClick={() => add(s.id, opt)}
                      disabled={used}
                      style={{ 
                        padding: '2px 6px', 
                        fontSize: 12, 
                        borderRadius: 6, 
                        border: isSuggestedColor ? '2px solid #4caf50' : '1px solid #ccc',
                        background: isSuggestedColor ? 'rgba(76, 175, 80, 0.15)' : 'transparent',
                        fontWeight: isSuggestedColor ? 600 : 400
                      }}
                      title={used ? 'Already used' : isSuggestedColor ? `Suggested: Add ${opt}` : `Add ${opt}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {sources.length === 0 && (
          <div style={{ opacity: 0.7, fontSize: 12 }}>No untapped mana sources available</div>
        )}
      </div>
    </div>
  );
}