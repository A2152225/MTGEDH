import React, { useState, useMemo } from 'react';
import { PaymentPicker } from './PaymentPicker';
import { FloatingManaPool } from './FloatingManaPool';
import type { PaymentItem, ManaColor } from '../../../shared/src';
import {
  Color,
  parseManaCost,
  computeColorsNeededByOtherCards,
  calculateSuggestedPayment,
  calculateRemainingCostAfterFloatingMana,
  type OtherCardInfo,
  type ManaPool,
} from '../utils/manaUtils';

interface CastSpellModalProps {
  open: boolean;
  cardName: string;
  manaCost?: string;
  availableSources: Array<{ id: string; name: string; options: Color[] }>;
  otherCardsInHand?: OtherCardInfo[];
  floatingMana?: ManaPool;
  onConfirm: (payment: PaymentItem[]) => void;
  onCancel: () => void;
}

export function CastSpellModal({
  open,
  cardName,
  manaCost,
  availableSources,
  otherCardsInHand = [],
  floatingMana,
  onConfirm,
  onCancel,
}: CastSpellModalProps) {
  const [payment, setPayment] = useState<PaymentItem[]>([]);
  const [xValue, setXValue] = useState(0);

  // Calculate suggested payment for auto-fill (considers floating mana)
  const suggestedPayment = useMemo(() => {
    const parsed = parseManaCost(manaCost);
    const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, xValue), hybrids: parsed.hybrids };
    const colorsToPreserve = computeColorsNeededByOtherCards(otherCardsInHand);
    return calculateSuggestedPayment(cost, availableSources, colorsToPreserve, floatingMana);
  }, [manaCost, xValue, availableSources, otherCardsInHand, floatingMana]);

  // Calculate how much floating mana will be used
  const floatingManaUsage = useMemo(() => {
    if (!floatingMana) return null;
    const parsed = parseManaCost(manaCost);
    const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, xValue), hybrids: parsed.hybrids };
    const { usedFromPool } = calculateRemainingCostAfterFloatingMana(cost, floatingMana);
    const totalUsed = Object.values(usedFromPool).reduce((a, b) => a + b, 0);
    return totalUsed > 0 ? usedFromPool : null;
  }, [manaCost, xValue, floatingMana]);

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

  // Check if there's floating mana that will be used
  const hasFloatingManaToUse = floatingManaUsage && Object.values(floatingManaUsage).some(v => v > 0);

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Cast {cardName}</h3>
          <button onClick={handleCancel} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>

        {/* Show floating mana pool if available */}
        {floatingMana && (
          <div style={{ marginBottom: 12 }}>
            <FloatingManaPool manaPool={floatingMana} compact />
            {hasFloatingManaToUse && (
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

        <PaymentPicker
          manaCost={manaCost}
          manaCostDisplay={manaCost}
          sources={availableSources}
          chosen={payment}
          xValue={xValue}
          onChangeX={setXValue}
          onChange={setPayment}
          otherCardsInHand={otherCardsInHand}
          floatingMana={floatingMana}
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
