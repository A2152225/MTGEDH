/**
 * CardSelectionModal.tsx
 * 
 * A generic modal for selecting one or more cards/options from a list.
 * Can be used for:
 * - Bounce lands (select 1 land to return)
 * - Modal spells (choose one/two modes)
 * - Sacrifice effects (choose creatures to sacrifice)
 * - Search effects (choose cards from library)
 * - Any other card selection scenario
 */

import React, { useState, useEffect } from 'react';

export interface SelectionOption {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface CardSelectionModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  sourceCardName?: string;
  sourceCardImageUrl?: string;
  oracleText?: string;
  options: SelectionOption[];
  minSelections?: number; // Minimum number of selections required (default: 1)
  maxSelections?: number; // Maximum number of selections allowed (default: 1)
  confirmButtonText?: string;
  cancelButtonText?: string;
  canCancel?: boolean;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
}

export function CardSelectionModal({
  open,
  title,
  subtitle,
  sourceCardName,
  sourceCardImageUrl,
  oracleText,
  options,
  minSelections = 1,
  maxSelections = 1,
  confirmButtonText = 'Confirm',
  cancelButtonText = 'Cancel',
  canCancel = false,
  onConfirm,
  onCancel,
}: CardSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens/closes or options change
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open, options]);

  if (!open) return null;

  const toggleSelection = (id: string) => {
    const option = options.find(o => o.id === id);
    if (option?.disabled) return;

    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      if (maxSelections === 1) {
        // Single selection mode - replace
        newSelected.clear();
        newSelected.add(id);
      } else if (newSelected.size < maxSelections) {
        // Multi-selection mode - add if under limit
        newSelected.add(id);
      }
    }
    setSelectedIds(newSelected);
  };

  const canConfirm = selectedIds.size >= minSelections && selectedIds.size <= maxSelections;
  const selectionText = minSelections === maxSelections
    ? `Select ${minSelections}`
    : `Select ${minSelections}-${maxSelections}`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 700,
          width: '90%',
          maxHeight: '85vh',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {title}
          </h2>
          {subtitle && (
            <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
              {subtitle}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
            {selectionText} ({selectedIds.size} selected)
          </div>
        </div>

        {/* Source card (if provided) */}
        {sourceCardImageUrl && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={sourceCardImageUrl}
              alt={sourceCardName || 'Source card'}
              style={{
                width: 120,
                height: 'auto',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        )}

        {/* Oracle text explanation */}
        {oracleText && (
          <div
            style={{
              fontSize: 13,
              color: '#aaa',
              textAlign: 'center',
              fontStyle: 'italic',
              padding: '8px 16px',
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: 6,
            }}
          >
            {oracleText}
          </div>
        )}

        {/* Selection grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 12,
            maxHeight: 350,
            overflowY: 'auto',
            padding: 8,
          }}
        >
          {options.map((option) => {
            const isSelected = selectedIds.has(option.id);
            const isDisabled = option.disabled;
            
            return (
              <div
                key={option.id}
                onClick={() => toggleSelection(option.id)}
                title={isDisabled ? option.disabledReason : option.name}
                style={{
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  borderRadius: 8,
                  border: isSelected 
                    ? '3px solid #3b82f6' 
                    : '3px solid transparent',
                  padding: 4,
                  backgroundColor: isSelected 
                    ? 'rgba(59, 130, 246, 0.2)' 
                    : isDisabled
                      ? 'rgba(100, 100, 100, 0.2)'
                      : 'rgba(255, 255, 255, 0.05)',
                  opacity: isDisabled ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {option.imageUrl ? (
                  <img
                    src={option.imageUrl}
                    alt={option.name}
                    style={{
                      width: '100%',
                      height: 'auto',
                      borderRadius: 6,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '0.72',
                      backgroundColor: '#2a2a4a',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      textAlign: 'center',
                      padding: 6,
                    }}
                  >
                    {option.name}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 11,
                    textAlign: 'center',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {option.name}
                </div>
                {option.description && (
                  <div
                    style={{
                      fontSize: 9,
                      textAlign: 'center',
                      color: '#888',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {option.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          {canCancel && onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: '1px solid #4a4a6a',
                backgroundColor: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {cancelButtonText}
            </button>
          )}
          <button
            onClick={() => onConfirm(Array.from(selectedIds))}
            disabled={!canConfirm}
            style={{
              padding: '12px 32px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#3b82f6' : '#4a4a6a',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: canConfirm ? 1 : 0.5,
              transition: 'all 0.15s ease',
            }}
          >
            {confirmButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CardSelectionModal;
