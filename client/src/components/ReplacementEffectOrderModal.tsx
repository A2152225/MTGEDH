import React, { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Interface for a replacement effect that can be reordered
 */
export interface ReplacementEffectItem {
  id: string;
  source: string;
  type: 'add_flat' | 'double' | 'triple' | 'halve' | 'halve_round_up' | 'prevent';
  value?: number;
  description: string;
}

/** Ordering mode for replacement effects */
export type OrderingMode = 'minimize' | 'maximize' | 'custom';

export interface ReplacementEffectOrderModalProps {
  open: boolean;
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
  effects: ReplacementEffectItem[];
  baseAmount: number;
  initialMode?: OrderingMode;
  onConfirm: (orderedEffects: ReplacementEffectItem[], mode: OrderingMode) => void;
  onCancel: () => void;
}

function calculateResult(baseAmount: number, effects: ReplacementEffectItem[]): number {
  let amount = baseAmount;
  for (const effect of effects) {
    switch (effect.type) {
      case 'add_flat': amount += effect.value ?? 1; break;
      case 'double': amount *= 2; break;
      case 'triple': amount *= 3; break;
      case 'halve': amount = Math.floor(amount / 2); break;
      case 'halve_round_up': amount = Math.ceil(amount / 2); break;
      case 'prevent': amount = 0; break;
    }
  }
  return Math.max(0, amount);
}

function getMaximizeOrder(effects: ReplacementEffectItem[]): ReplacementEffectItem[] {
  const order: Record<string, number> = { 'add_flat': 1, 'halve': 2, 'halve_round_up': 2, 'double': 3, 'triple': 4, 'prevent': 5 };
  return [...effects].sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
}

function getMinimizeOrder(effects: ReplacementEffectItem[]): ReplacementEffectItem[] {
  const order: Record<string, number> = { 'prevent': 0, 'halve_round_up': 1, 'halve': 2, 'double': 3, 'triple': 4, 'add_flat': 5 };
  return [...effects].sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
}

export function ReplacementEffectOrderModal({
  open, effectType, effects, baseAmount, initialMode, onConfirm, onCancel,
}: ReplacementEffectOrderModalProps) {
  const defaultMode: OrderingMode = initialMode ?? (effectType === 'damage' ? 'minimize' : 'maximize');
  const [mode, setMode] = useState<OrderingMode>(defaultMode);
  const [orderedEffects, setOrderedEffects] = useState<ReplacementEffectItem[]>([]);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const minimizeResult = useMemo(() => calculateResult(baseAmount, getMinimizeOrder(effects)), [baseAmount, effects]);
  const maximizeResult = useMemo(() => calculateResult(baseAmount, getMaximizeOrder(effects)), [baseAmount, effects]);
  const currentResult = useMemo(() => calculateResult(baseAmount, orderedEffects), [baseAmount, orderedEffects]);

  useEffect(() => {
    if (open && effects.length > 0) {
      if (mode === 'minimize') setOrderedEffects(getMinimizeOrder(effects));
      else if (mode === 'maximize') setOrderedEffects(getMaximizeOrder(effects));
    }
  }, [open, effects, mode]);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setOverrideEnabled(false);
      setOrderedEffects(defaultMode === 'minimize' ? getMinimizeOrder(effects) : getMaximizeOrder(effects));
    }
  }, [open, defaultMode, effects]);

  const handleModeChange = useCallback((newMode: OrderingMode) => {
    setMode(newMode);
    if (newMode === 'minimize') setOrderedEffects(getMinimizeOrder(effects));
    else if (newMode === 'maximize') setOrderedEffects(getMaximizeOrder(effects));
  }, [effects]);

  const handleDragStart = useCallback((index: number) => { if (mode === 'custom') setDraggedIndex(index); }, [mode]);
  const handleDragEnd = useCallback(() => { setDraggedIndex(null); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (mode !== 'custom' || draggedIndex === null || draggedIndex === index) return;
    const newEffects = [...orderedEffects];
    const [draggedItem] = newEffects.splice(draggedIndex, 1);
    newEffects.splice(index, 0, draggedItem);
    setOrderedEffects(newEffects);
    setDraggedIndex(index);
  }, [mode, draggedIndex, orderedEffects]);

  const moveEffect = useCallback((fromIndex: number, direction: 'up' | 'down') => {
    if (mode !== 'custom') return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= orderedEffects.length) return;
    const newEffects = [...orderedEffects];
    [newEffects[fromIndex], newEffects[toIndex]] = [newEffects[toIndex], newEffects[fromIndex]];
    setOrderedEffects(newEffects);
  }, [mode, orderedEffects]);

  const getEffectColor = (type: string) => {
    const colors: Record<string, string> = { add_flat: '#68d391', double: '#63b3ed', triple: '#9f7aea', halve: '#f6ad55', halve_round_up: '#ed8936', prevent: '#fc8181' };
    return colors[type] ?? '#a0aec0';
  };

  const getEffectLabel = (type: string, value?: number) => {
    const labels: Record<string, string> = { add_flat: `+${value ?? 1}`, double: '×2', triple: '×3', halve: '÷2↓', halve_round_up: '÷2↑', prevent: 'Prevent' };
    return labels[type] ?? type;
  };

  const titles: Record<string, string> = { damage: 'Damage Replacement Effects', life_gain: 'Life Gain Replacement Effects', counters: 'Counter Replacement Effects', tokens: 'Token Creation Replacement Effects' };

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1a2e', borderRadius: 12, width: 580, maxWidth: '95vw', maxHeight: '90vh', padding: 24, color: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <h3 style={{ margin: '0 0 8px 0', color: '#63b3ed', fontSize: 18 }}>{titles[effectType] ?? 'Replacement Effects'}</h3>
        <p style={{ fontSize: 13, color: '#a0aec0', marginBottom: 16, lineHeight: 1.5 }}>
          {effectType === 'damage' ? 'As the player receiving damage, you choose the order replacement effects apply.' : 'Choose how replacement effects are ordered to optimize the outcome.'}
        </p>

        {/* Override Checkbox */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: overrideEnabled ? '#2d3a4d' : '#252538', borderRadius: 8, border: overrideEnabled ? '1px solid #4a90d9' : '1px solid #3d3d5c' }}>
          <input type="checkbox" id="override-checkbox" checked={overrideEnabled} onChange={(e) => setOverrideEnabled(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#4a90d9' }} />
          <label htmlFor="override-checkbox" style={{ cursor: 'pointer', fontWeight: 500, flex: 1 }}>Override default ordering</label>
          {!overrideEnabled && <span style={{ fontSize: 12, color: '#68d391' }}>Using optimal: {effectType === 'damage' ? 'Minimize' : 'Maximize'}</span>}
        </div>

        {/* Mode Selection Buttons */}
        {overrideEnabled && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => handleModeChange('minimize')} style={{ flex: 1, padding: '12px 16px', background: mode === 'minimize' ? '#2d5a3d' : '#252538', border: mode === 'minimize' ? '2px solid #68d391' : '1px solid #3d3d5c', borderRadius: 8, color: mode === 'minimize' ? '#68d391' : '#a0aec0', cursor: 'pointer', fontWeight: mode === 'minimize' ? 600 : 400 }}>
              <div style={{ fontSize: 14 }}>Minimize</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{minimizeResult}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Reduce final value</div>
            </button>
            <button onClick={() => handleModeChange('maximize')} style={{ flex: 1, padding: '12px 16px', background: mode === 'maximize' ? '#3d2d5a' : '#252538', border: mode === 'maximize' ? '2px solid #9f7aea' : '1px solid #3d3d5c', borderRadius: 8, color: mode === 'maximize' ? '#9f7aea' : '#a0aec0', cursor: 'pointer', fontWeight: mode === 'maximize' ? 600 : 400 }}>
              <div style={{ fontSize: 14 }}>Maximize</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{maximizeResult}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Increase final value</div>
            </button>
            <button onClick={() => handleModeChange('custom')} style={{ flex: 1, padding: '12px 16px', background: mode === 'custom' ? '#5a3d2d' : '#252538', border: mode === 'custom' ? '2px solid #f6ad55' : '1px solid #3d3d5c', borderRadius: 8, color: mode === 'custom' ? '#f6ad55' : '#a0aec0', cursor: 'pointer', fontWeight: mode === 'custom' ? 600 : 400 }}>
              <div style={{ fontSize: 14 }}>Custom</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{currentResult}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Manual ordering</div>
            </button>
          </div>
        )}

        {/* Base Amount */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: '#2d2d44', borderRadius: 6, marginBottom: 12, fontSize: 14 }}>
          <span style={{ color: '#a0aec0' }}>Base Amount:</span>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{baseAmount}</span>
        </div>

        {/* Effects List */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, border: '1px solid #3d3d5c', borderRadius: 8, minHeight: 120, maxHeight: 280 }}>
          {orderedEffects.map((effect, index) => (
            <div key={effect.id} draggable={mode === 'custom' && overrideEnabled} onDragStart={() => handleDragStart(index)} onDragOver={(e) => handleDragOver(e, index)} onDragEnd={handleDragEnd}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: draggedIndex === index ? '#3d3d5c' : index % 2 === 0 ? '#252538' : '#2a2a40', borderBottom: index < orderedEffects.length - 1 ? '1px solid #3d3d5c' : 'none', cursor: mode === 'custom' && overrideEnabled ? 'grab' : 'default', opacity: draggedIndex === index ? 0.5 : 1 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#4a5568', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{index + 1}</div>
              <div style={{ padding: '3px 8px', borderRadius: 4, background: getEffectColor(effect.type), color: '#000', fontWeight: 600, fontSize: 11, minWidth: 50, textAlign: 'center', flexShrink: 0 }}>{getEffectLabel(effect.type, effect.value)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{effect.source}</div>
                <div style={{ fontSize: 11, color: '#a0aec0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{effect.description}</div>
              </div>
              {mode === 'custom' && overrideEnabled && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => moveEffect(index, 'up')} disabled={index === 0} style={{ background: index === 0 ? '#2d3748' : '#4a5568', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: index === 0 ? 'not-allowed' : 'pointer', fontSize: 12 }}>▲</button>
                  <button onClick={() => moveEffect(index, 'down')} disabled={index === orderedEffects.length - 1} style={{ background: index === orderedEffects.length - 1 ? '#2d3748' : '#4a5568', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: index === orderedEffects.length - 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}>▼</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Result Preview */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#283838', borderRadius: 8, marginBottom: 16, border: '1px solid #3d5c5c' }}>
          <div>
            <div style={{ fontSize: 12, color: '#a0aec0' }}>Final Result</div>
            <div style={{ fontWeight: 700, fontSize: 28, color: '#68d391' }}>{currentResult}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#a0aec0' }}>Mode</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: mode === 'minimize' ? '#68d391' : mode === 'maximize' ? '#9f7aea' : '#f6ad55', textTransform: 'capitalize' }}>
              {overrideEnabled ? mode : (effectType === 'damage' ? 'Minimize (Default)' : 'Maximize (Default)')}
            </div>
          </div>
        </div>

        {/* Tip */}
        {effectType === 'damage' && (
          <div style={{ padding: '10px 14px', background: '#2d2d44', borderRadius: 6, marginBottom: 16, fontSize: 12, color: '#a0aec0' }}>
            <strong style={{ color: '#f6ad55' }}>💡 Tip:</strong> Use <strong>Maximize</strong> for cards like Selfless Squire, Stuffy Doll, or redirect effects.
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ background: '#4a5568', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
          <button onClick={() => onConfirm(orderedEffects, overrideEnabled ? mode : (effectType === 'damage' ? 'minimize' : 'maximize'))} style={{ background: '#3182ce', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

export default ReplacementEffectOrderModal;
