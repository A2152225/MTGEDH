import React, { useState, useEffect, useCallback } from 'react';
import { socket } from '../socket';

export interface ReplacementEffectSettingsProps {
  gameId: string;
  playerId: string;
  open: boolean;
  onClose: () => void;
}

interface EffectPreference {
  useCustomOrder: boolean;
  customOrder: string[];
  updatedAt?: number;
}

interface Preferences {
  damage?: EffectPreference;
  life_gain?: EffectPreference;
  counters?: EffectPreference;
  tokens?: EffectPreference;
}

/**
 * Settings panel for replacement effect ordering preferences.
 * Allows players to configure their default behavior for how
 * replacement effects are ordered.
 */
export function ReplacementEffectSettingsPanel({
  gameId,
  playerId,
  open,
  onClose,
}: ReplacementEffectSettingsProps) {
  const [preferences, setPreferences] = useState<Preferences>({});
  const [loading, setLoading] = useState(false);

  // Fetch current preferences when panel opens
  useEffect(() => {
    if (open && gameId) {
      setLoading(true);
      socket.emit('getReplacementEffectOrder', { gameId });
    }
  }, [open, gameId]);

  // Listen for preference responses
  useEffect(() => {
    const handleResponse = (data: {
      gameId: string;
      preferences?: Preferences;
      effectType?: string;
      preference?: EffectPreference;
    }) => {
      if (data.gameId !== gameId) return;
      
      setLoading(false);
      if (data.preferences) {
        setPreferences(data.preferences);
      } else if (data.effectType && data.preference) {
        setPreferences(prev => ({
          ...prev,
          [data.effectType as keyof Preferences]: data.preference,
        }));
      }
    };

    socket.on('replacementEffectOrderResponse', handleResponse);
    return () => {
      socket.off('replacementEffectOrderResponse', handleResponse);
    };
  }, [gameId]);

  const handleToggle = useCallback((effectType: keyof Preferences, useCustom: boolean) => {
    socket.emit('setReplacementEffectOrder', {
      gameId,
      effectType,
      useCustomOrder: useCustom,
      customOrder: [],
    });

    setPreferences(prev => ({
      ...prev,
      [effectType]: {
        ...prev[effectType],
        useCustomOrder: useCustom,
      },
    }));
  }, [gameId]);

  const effectTypes: { key: keyof Preferences; label: string; description: string }[] = [
    { 
      key: 'damage', 
      label: 'Damage Received',
      description: 'When you receive damage with multiple modifiers (Gisela, Furnace of Rath, etc.)',
    },
    { 
      key: 'life_gain', 
      label: 'Life Gain',
      description: 'When gaining life with modifiers (Boon Reflection, Rhox Faithmender, etc.)',
    },
    { 
      key: 'counters', 
      label: 'Counter Placement',
      description: 'When placing counters with modifiers (Doubling Season, Hardened Scales, etc.)',
    },
    { 
      key: 'tokens', 
      label: 'Token Creation',
      description: 'When creating tokens with modifiers (Parallel Lives, Anointed Procession, etc.)',
    },
  ];

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 8500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: 12,
          width: 500,
          maxWidth: '95vw',
          maxHeight: '90vh',
          padding: 24,
          color: '#fff',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#63b3ed' }}>
            Replacement Effect Settings
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a0aec0',
              fontSize: 24,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: 13, color: '#a0aec0', marginBottom: 20 }}>
          Configure how replacement effects are ordered. By default, the game applies effects
          in the optimal order (maximizing beneficial effects, minimizing harmful ones).
          Enable custom ordering if you want to choose the order yourself each time.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#a0aec0' }}>
            Loading preferences...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {effectTypes.map(({ key, label, description }) => (
              <div
                key={key}
                style={{
                  padding: '16px',
                  background: '#252538',
                  borderRadius: 8,
                  border: '1px solid #3d3d5c',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 12, color: '#a0aec0' }}>
                      {description}
                    </div>
                  </div>
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    cursor: 'pointer',
                    marginLeft: 16,
                  }}>
                    <span style={{ fontSize: 12, color: '#a0aec0' }}>
                      {preferences[key]?.useCustomOrder ? 'Custom' : 'Auto'}
                    </span>
                    <div
                      style={{
                        width: 44,
                        height: 24,
                        borderRadius: 12,
                        background: preferences[key]?.useCustomOrder ? '#3182ce' : '#4a5568',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onClick={() => handleToggle(key, !preferences[key]?.useCustomOrder)}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: preferences[key]?.useCustomOrder ? 22 : 2,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left 0.2s',
                        }}
                      />
                    </div>
                  </label>
                </div>
                
                {preferences[key]?.useCustomOrder && (
                  <div style={{ 
                    marginTop: 12, 
                    padding: '8px 12px', 
                    background: '#1a1a2e', 
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#f6ad55',
                  }}>
                    ⚠️ You will be prompted to choose the order each time multiple effects apply.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ 
          marginTop: 20, 
          padding: '12px 16px', 
          background: '#2d2d44', 
          borderRadius: 8,
          fontSize: 12,
          color: '#a0aec0',
        }}>
          <strong style={{ color: '#68d391' }}>Tip:</strong> Enable custom ordering for damage if you have cards 
          like Selfless Squire that benefit from taking more damage, or redirect effects 
          where you want to maximize the redirected amount.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              background: '#3182ce',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 24px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReplacementEffectSettingsPanel;
