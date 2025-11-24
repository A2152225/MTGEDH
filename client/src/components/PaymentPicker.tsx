import React, { useMemo } from 'react';
import type { PaymentItem, ManaColor } from '../../../shared/src';

type Color = ManaColor;

// Constants
const MANA_COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

interface OtherCardInfo {
  id: string;
  name: string;
  mana_cost?: string;
}

function parseManaCost(manaCost?: string): { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } {
  const res: { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } =
    { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: 0, hybrids: [], hasX: false };
  if (!manaCost) return res;
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '').toUpperCase();
    if (sym === 'X') { res.hasX = true; continue; }
    if (/^\d+$/.test(sym)) { res.generic += parseInt(sym, 10); continue; }
    if (sym.includes('/')) {
      const parts = sym.split('/');
      if (parts.length === 2 && parts[1] === 'P') {
        const c = parts[0] as Color;
        if (MANA_COLORS.includes(c)) res.colors[c] += 1;
        continue;
      }
      if (parts.length === 2 && MANA_COLORS.includes(parts[0] as Color) && MANA_COLORS.includes(parts[1] as Color)) {
        res.hybrids.push([parts[0] as Color, parts[1] as Color]);
        continue;
      }
      // two-brid fallback: treat numeric as generic
      const num = parseInt(parts[0], 10);
      if (!Number.isNaN(num)) { res.generic += num; continue; }
    }
    if (MANA_COLORS.includes(sym as Color)) {
      res.colors[sym as Color] += 1;
      continue;
    }
  }
  return res;
}

function paymentToPool(payment: PaymentItem[]): Record<Color, number> {
  return payment.reduce<Record<Color, number>>((acc, p) => {
    acc[p.mana] = (acc[p.mana] || 0) + 1;
    return acc;
  }, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
}

function canPayEnhanced(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>): boolean {
  const left: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const c of MANA_COLORS) {
    if (left[c] < cost.colors[c]) return false;
    left[c] -= cost.colors[c];
  }
  for (const group of cost.hybrids) {
    let satisfied = false;
    for (const c of group) {
      if (left[c] > 0) { left[c] -= 1; satisfied = true; break; }
    }
    if (!satisfied) return false;
  }
  const total = MANA_COLORS.reduce((a, c) => a + left[c], 0);
  return total >= cost.generic;
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

function costBadge(label: string, n: number) {
  if (n <= 0) return null;
  return (
    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', border: '1px solid #ddd', borderRadius: 12, fontSize: 12, background: '#fafafa' }}>
      {label} × {n}
    </span>
  );
}

/**
 * Compute colors needed by other cards in hand (excluding the current spell)
 * This helps determine which colors to preserve when paying generic mana
 */
function computeColorsNeededByOtherCards(otherCards: OtherCardInfo[]): Set<Color> {
  const neededColors = new Set<Color>();
  for (const card of otherCards) {
    if (!card.mana_cost) continue;
    const parsed = parseManaCost(card.mana_cost);
    for (const c of MANA_COLORS) {
      if (parsed.colors[c] > 0) neededColors.add(c);
    }
    // Also consider hybrid colors
    for (const hybrid of parsed.hybrids) {
      for (const c of hybrid) {
        neededColors.add(c);
      }
    }
  }
  return neededColors;
}

/**
 * Calculate suggested payment: sources and colors to use
 * Returns a map of permanentId -> suggested color
 */
function calculateSuggestedPayment(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  sources: Array<{ id: string; name: string; options: Color[] }>,
  colorsToPreserve: Set<Color>
): Map<string, Color> {
  const suggestions = new Map<string, Color>();
  const costRemaining = { ...cost.colors };
  let genericRemaining = cost.generic;
  
  // Track which sources we've used
  const usedSources = new Set<string>();
  
  // First pass: assign sources for specific color requirements
  for (const c of MANA_COLORS) {
    if (costRemaining[c] <= 0) continue;
    
    for (const source of sources) {
      if (usedSources.has(source.id)) continue;
      if (!source.options.includes(c)) continue;
      
      suggestions.set(source.id, c);
      usedSources.add(source.id);
      costRemaining[c]--;
      
      if (costRemaining[c] <= 0) break;
    }
  }
  
  // Second pass: handle hybrid costs (pick the color that's less needed by other cards)
  for (const hybrid of cost.hybrids) {
    let bestColor: Color | null = null;
    let bestSource: { id: string; name: string; options: Color[] } | null = null;
    
    for (const source of sources) {
      if (usedSources.has(source.id)) continue;
      
      for (const c of hybrid) {
        if (!source.options.includes(c)) continue;
        
        // Prefer colors NOT needed by other cards
        if (bestColor === null || (!colorsToPreserve.has(c) && colorsToPreserve.has(bestColor))) {
          bestColor = c;
          bestSource = source;
        }
      }
    }
    
    if (bestSource && bestColor) {
      suggestions.set(bestSource.id, bestColor);
      usedSources.add(bestSource.id);
    }
  }
  
  // Third pass: assign sources for generic cost
  // Prefer sources that produce colors NOT needed by other cards
  if (genericRemaining > 0) {
    // Sort remaining sources: prefer single-color sources first, then prefer colors not needed by other cards
    const remainingSources = sources.filter(s => !usedSources.has(s.id));
    
    remainingSources.sort((a, b) => {
      // Single option sources first
      if (a.options.length !== b.options.length) {
        return a.options.length - b.options.length;
      }
      // Then prefer sources that don't produce colors needed by other cards
      const aHasPreservedColor = a.options.some(c => colorsToPreserve.has(c));
      const bHasPreservedColor = b.options.some(c => colorsToPreserve.has(c));
      if (!aHasPreservedColor && bHasPreservedColor) return -1;
      if (aHasPreservedColor && !bHasPreservedColor) return 1;
      return 0;
    });
    
    for (const source of remainingSources) {
      if (genericRemaining <= 0) break;
      
      // Pick the color least needed by other cards
      let bestColor = source.options[0];
      for (const c of source.options) {
        if (!colorsToPreserve.has(c)) {
          bestColor = c;
          break;
        }
      }
      
      suggestions.set(source.id, bestColor);
      usedSources.add(source.id);
      genericRemaining--;
    }
  }
  
  return suggestions;
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
}) {
  const { manaCost, manaCostDisplay, sources, chosen, xValue = 0, onChangeX, onChange, otherCardsInHand = [] } = props;

  const parsed = useMemo(() => parseManaCost(manaCost), [manaCost]);
  const cost = useMemo(() => ({ colors: parsed.colors, generic: parsed.generic + Math.max(0, Number(xValue || 0) | 0), hybrids: parsed.hybrids }), [parsed, xValue]);
  const pool = useMemo(() => paymentToPool(chosen), [chosen]);
  const satisfied = useMemo(() => canPayEnhanced(cost, pool), [cost, pool]);
  const remaining = useMemo(() => remainingAfter(cost, pool), [cost, pool]);

  const chosenById = useMemo(() => new Set(chosen.map(p => p.permanentId)), [chosen]);

  // Calculate colors needed by other cards in hand
  const colorsToPreserve = useMemo(() => computeColorsNeededByOtherCards(otherCardsInHand), [otherCardsInHand]);
  
  // Calculate suggested payment when no sources have been chosen yet
  const suggestedPayment = useMemo(() => {
    if (chosen.length > 0) return new Map<string, Color>();
    return calculateSuggestedPayment(cost, sources, colorsToPreserve);
  }, [cost, sources, colorsToPreserve, chosen.length]);

  const add = (permanentId: string, mana: Color) => {
    if (chosenById.has(permanentId)) return; // one per source
    onChange([...chosen, { permanentId, mana }]);
  };
  const remove = (permanentId: string) => {
    onChange(chosen.filter(p => p.permanentId !== permanentId));
  };
  const clear = () => onChange([]);

  const doAutoSelect = () => {
    // Use the suggested payment to auto-fill
    if (suggestedPayment.size === 0) {
      // Recalculate if already chosen some
      const newSuggested = calculateSuggestedPayment(cost, sources, colorsToPreserve);
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
        <b>Selected:</b>
        {MANA_COLORS.map(c => costBadge(c, pool[c]))}
        {Object.values(pool).every(v => v === 0) && <span style={{ fontSize: 12, opacity: 0.7 }}>None (leave empty to auto-pay)</span>}
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