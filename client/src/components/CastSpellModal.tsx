import React, { useState, useMemo } from 'react';
import { PaymentPicker } from './PaymentPicker';
import type { PaymentItem, ManaColor } from '../../../shared/src';

type Color = ManaColor;

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

  if (!open) return null;

  const handleConfirm = () => {
    onConfirm(payment);
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
