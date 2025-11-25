import React, { useState, useMemo } from 'react';
import { PaymentPicker } from './PaymentPicker';
import type { PaymentItem, ManaColor } from '../../../shared/src';

type Color = ManaColor;
const MANA_COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

interface OtherCardInfo {
  id: string;
  name: string;
  mana_cost?: string;
}

interface CastSpellModalProps {
  open: boolean;
  cardName: string;
  manaCost?: string;
  availableSources: Array<{ id: string; name: string; options: Color[] }>;
  otherCardsInHand?: OtherCardInfo[];
  onConfirm: (payment: PaymentItem[]) => void;
  onCancel: () => void;
}

// Parse mana cost string into components
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

// Compute colors needed by other cards in hand
function computeColorsNeededByOtherCards(otherCards: OtherCardInfo[]): Set<Color> {
  const neededColors = new Set<Color>();
  for (const card of otherCards) {
    if (!card.mana_cost) continue;
    const parsed = parseManaCost(card.mana_cost);
    for (const c of MANA_COLORS) {
      if (parsed.colors[c] > 0) neededColors.add(c);
    }
    for (const hybrid of parsed.hybrids) {
      for (const c of hybrid) neededColors.add(c);
    }
  }
  return neededColors;
}

// Calculate suggested payment with priority: colorless first, single-color, multi-color last
function calculateSuggestedPayment(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  sources: Array<{ id: string; name: string; options: Color[] }>,
  colorsToPreserve: Set<Color>
): Map<string, Color> {
  const suggestions = new Map<string, Color>();
  const costRemaining = { ...cost.colors };
  let genericRemaining = cost.generic;
  const usedSources = new Set<string>();
  
  const isColorlessOnly = (source: { options: Color[] }) => 
    source.options.length === 1 && source.options[0] === 'C';
  const hasColorlessOption = (source: { options: Color[] }) => 
    source.options.includes('C');
  const colorOptionCount = (source: { options: Color[] }) => 
    source.options.filter(c => c !== 'C').length;
  
  // First: assign sources for specific color requirements
  for (const c of MANA_COLORS) {
    if (c === 'C') continue;
    if (costRemaining[c] <= 0) continue;
    const colorSources = sources
      .filter(s => !usedSources.has(s.id) && s.options.includes(c))
      .sort((a, b) => a.options.length - b.options.length);
    for (const source of colorSources) {
      if (costRemaining[c] <= 0) break;
      suggestions.set(source.id, c);
      usedSources.add(source.id);
      costRemaining[c]--;
    }
  }
  
  // Handle colorless requirement
  if (costRemaining['C'] > 0) {
    const colorlessSources = sources
      .filter(s => !usedSources.has(s.id) && s.options.includes('C'))
      .sort((a, b) => {
        if (isColorlessOnly(a) && !isColorlessOnly(b)) return -1;
        if (!isColorlessOnly(a) && isColorlessOnly(b)) return 1;
        return a.options.length - b.options.length;
      });
    for (const source of colorlessSources) {
      if (costRemaining['C'] <= 0) break;
      suggestions.set(source.id, 'C');
      usedSources.add(source.id);
      costRemaining['C']--;
    }
  }
  
  // Handle hybrid costs
  for (const hybrid of cost.hybrids) {
    let bestColor: Color | null = null;
    let bestSource: { id: string; name: string; options: Color[] } | null = null;
    let bestScore = Infinity;
    for (const source of sources) {
      if (usedSources.has(source.id)) continue;
      for (const c of hybrid) {
        if (!source.options.includes(c)) continue;
        const score = (colorsToPreserve.has(c) ? 100 : 0) + source.options.length;
        if (score < bestScore) {
          bestScore = score;
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
  
  // Generic cost: colorless-only first, then single-color, then multi-color
  if (genericRemaining > 0) {
    const remainingSources = sources.filter(s => !usedSources.has(s.id));
    remainingSources.sort((a, b) => {
      if (isColorlessOnly(a) && !isColorlessOnly(b)) return -1;
      if (!isColorlessOnly(a) && isColorlessOnly(b)) return 1;
      if (hasColorlessOption(a) && !hasColorlessOption(b)) return -1;
      if (!hasColorlessOption(a) && hasColorlessOption(b)) return 1;
      const aCount = colorOptionCount(a);
      const bCount = colorOptionCount(b);
      if (aCount !== bCount) return aCount - bCount;
      const aPreserved = a.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      const bPreserved = b.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      if (!aPreserved && bPreserved) return -1;
      if (aPreserved && !bPreserved) return 1;
      return 0;
    });
    for (const source of remainingSources) {
      if (genericRemaining <= 0) break;
      let bestColor: Color = source.options.includes('C') ? 'C' : source.options[0];
      if (!source.options.includes('C')) {
        for (const c of source.options) {
          if (!colorsToPreserve.has(c)) { bestColor = c; break; }
        }
      }
      suggestions.set(source.id, bestColor);
      usedSources.add(source.id);
      genericRemaining--;
    }
  }
  
  return suggestions;
}

export function CastSpellModal({
  open,
  cardName,
  manaCost,
  availableSources,
  otherCardsInHand = [],
  onConfirm,
  onCancel,
}: CastSpellModalProps) {
  const [payment, setPayment] = useState<PaymentItem[]>([]);
  const [xValue, setXValue] = useState(0);

  // Calculate suggested payment for auto-fill
  const suggestedPayment = useMemo(() => {
    const parsed = parseManaCost(manaCost);
    const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, xValue), hybrids: parsed.hybrids };
    const colorsToPreserve = computeColorsNeededByOtherCards(otherCardsInHand);
    return calculateSuggestedPayment(cost, availableSources, colorsToPreserve);
  }, [manaCost, xValue, availableSources, otherCardsInHand]);

  if (!open) return null;

  const handleConfirm = () => {
    // If no payment was manually selected, use the suggested payment
    let finalPayment = payment;
    if (payment.length === 0 && suggestedPayment.size > 0) {
      finalPayment = Array.from(suggestedPayment.entries()).map(([permanentId, mana]) => ({
        permanentId,
        mana,
      }));
    }
    onConfirm(finalPayment);
    setPayment([]);
    setXValue(0);
  };

  const handleCancel = () => {
    onCancel();
    setPayment([]);
    setXValue(0);
  };

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Cast {cardName}</h3>
          <button onClick={handleCancel} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>

        <PaymentPicker
          manaCost={manaCost}
          manaCostDisplay={manaCost}
          sources={availableSources}
          chosen={payment}
          xValue={xValue}
          onChangeX={setXValue}
          onChange={setPayment}
          otherCardsInHand={otherCardsInHand}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel}>Cancel</button>
          <button onClick={handleConfirm} style={{ background: '#2b6cb0', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>
            Cast Spell
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
