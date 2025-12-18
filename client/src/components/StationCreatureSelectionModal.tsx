/**
 * StationCreatureSelectionModal.tsx
 * 
 * Modal for selecting a creature to tap for Station ability (Rule 702.184a).
 * Station: "Tap another untapped creature you control: Put a number of charge counters
 * on this permanent equal to the tapped creature's power."
 */

import React, { useState, useEffect } from 'react';

export interface StationCreature {
  id: string;
  name: string;
  power: number;
  toughness: number;
  imageUrl?: string;
}

export interface StationInfo {
  id: string;
  name: string;
  imageUrl?: string;
  threshold: number;
  currentCounters: number;
}

export interface StationCreatureSelectionProps {
  open: boolean;
  gameId: string;
  activationId: string;
  station: StationInfo;
  creatures: StationCreature[];
  title: string;
  description: string;
  onConfirm: (creatureId: string) => void;
  onCancel?: () => void;
}

export function StationCreatureSelectionModal({
  open,
  gameId,
  activationId,
  station,
  creatures,
  title,
  description,
  onConfirm,
  onCancel,
}: StationCreatureSelectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (open) {
      setSelectedId(null);
    }
  }, [open]);

  const handleSelect = (id: string) => {
    setSelectedId(id === selectedId ? null : id);
  };

  const handleConfirm = () => {
    if (selectedId) {
      onConfirm(selectedId);
    }
  };

  const selectedCreature = creatures.find(c => c.id === selectedId);
  const projectedCounters = station.currentCounters + (selectedCreature?.power || 0);
  const willStation = projectedCounters >= station.threshold;

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
          borderRadius: 16,
          padding: 24,
          width: '90%',
          maxWidth: 700,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.2)',
          border: '2px solid rgba(59,130,246,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          {station.imageUrl && (
            <img
              src={station.imageUrl}
              alt={station.name}
              style={{
                width: 80,
                height: 112,
                objectFit: 'cover',
                borderRadius: 8,
                border: '2px solid rgba(59,130,246,0.5)',
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#60a5fa', fontSize: 20 }}>
              🚀 {title}
            </h2>
            <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 14 }}>
              {description}
            </p>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ color: '#fbbf24', fontSize: 13 }}>
                ⚡ Current: {station.currentCounters}/{station.threshold} charge counters
              </span>
              {selectedCreature && (
                <span style={{ 
                  color: willStation ? '#22c55e' : '#60a5fa', 
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  → {projectedCounters}/{station.threshold} {willStation && '(will station!)'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Creature Selection */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto',
          marginBottom: 16,
        }}>
          <div style={{ 
            fontSize: 13, 
            color: '#9ca3af', 
            marginBottom: 12,
            fontWeight: 500,
          }}>
            Select a creature to tap (counters added = creature's power):
          </div>
          
          {creatures.length === 0 ? (
            <div style={{ 
              padding: 24, 
              textAlign: 'center', 
              color: '#6b7280',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 8,
            }}>
              No untapped creatures available
            </div>
          ) : (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}>
              {creatures.map((creature) => {
                const isSelected = creature.id === selectedId;
                return (
                  <div
                    key={creature.id}
                    onClick={() => handleSelect(creature.id)}
                    style={{
                      background: isSelected 
                        ? 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(59,130,246,0.15))'
                        : 'rgba(0,0,0,0.3)',
                      borderRadius: 12,
                      padding: 8,
                      cursor: 'pointer',
                      border: isSelected 
                        ? '2px solid #3b82f6' 
                        : '2px solid rgba(255,255,255,0.1)',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)';
                        e.currentTarget.style.background = 'rgba(59,130,246,0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.background = 'rgba(0,0,0,0.3)';
                      }
                    }}
                  >
                    {creature.imageUrl ? (
                      <img
                        src={creature.imageUrl}
                        alt={creature.name}
                        style={{
                          width: 100,
                          height: 140,
                          objectFit: 'cover',
                          borderRadius: 6,
                          marginBottom: 8,
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 100,
                        height: 140,
                        background: 'rgba(0,0,0,0.4)',
                        borderRadius: 6,
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        fontSize: 12,
                      }}>
                        No Image
                      </div>
                    )}
                    <div style={{ 
                      fontSize: 12, 
                      color: '#e5e7eb', 
                      textAlign: 'center',
                      fontWeight: 500,
                      lineHeight: 1.2,
                      marginBottom: 4,
                    }}>
                      {creature.name}
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 8,
                    }}>
                      <span style={{
                        background: creature.power > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 700,
                        color: creature.power > 0 ? '#22c55e' : '#ef4444',
                      }}>
                        Power: {creature.power}
                      </span>
                    </div>
                    {isSelected && (
                      <div style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: '#60a5fa',
                        fontWeight: 600,
                      }}>
                        +{creature.power} counters
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #4b5563',
                background: 'rgba(0,0,0,0.3)',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: selectedId 
                ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                : 'rgba(59,130,246,0.3)',
              color: '#fff',
              cursor: selectedId ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: selectedId ? 1 : 0.6,
            }}
          >
            {selectedId 
              ? `Tap ${selectedCreature?.name} (+${selectedCreature?.power} counters)`
              : 'Select a creature'
            }
          </button>
        </div>
      </div>
    </div>
  );
}
