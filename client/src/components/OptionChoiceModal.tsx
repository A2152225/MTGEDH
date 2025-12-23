/**
 * OptionChoiceModal.tsx
 * 
 * Generic modal for option choice resolution steps.
 * Used by Agitator Ant and similar effects that let players choose from a list of options.
 */

import React, { useState } from 'react';

export interface OptionChoiceOption {
  id: string;
  label: string;
  description?: string;
  imageUrl?: string;
  disabled?: boolean;
}

export interface OptionChoiceRequest {
  gameId: string;
  stepId: string;
  sourceId?: string;
  sourceName?: string;
  sourceImage?: string;
  description: string;
  options: OptionChoiceOption[];
  minSelections?: number;
  maxSelections?: number;
  mandatory: boolean;
}

export interface OptionChoiceModalProps {
  open: boolean;
  request: OptionChoiceRequest | null;
  onRespond: (selections: string[]) => void;
}

export function OptionChoiceModal({
  open,
  request,
  onRespond,
}: OptionChoiceModalProps) {
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());

  if (!open || !request) return null;

  const { sourceName, sourceImage, description, options, minSelections = 0, maxSelections = 1, mandatory } = request;

  const canSubmit = selectedOptions.size >= minSelections && selectedOptions.size <= maxSelections;

  const handleToggleOption = (optionId: string) => {
    const newSelected = new Set(selectedOptions);
    if (newSelected.has(optionId)) {
      newSelected.delete(optionId);
    } else {
      // If we've hit the max, replace the first selection (for single-select)
      if (maxSelections === 1) {
        newSelected.clear();
      } else if (newSelected.size >= maxSelections) {
        return; // Don't allow more than max
      }
      newSelected.add(optionId);
    }
    setSelectedOptions(newSelected);
  };

  const handleSubmit = () => {
    if (canSubmit) {
      onRespond(Array.from(selectedOptions));
      setSelectedOptions(new Set()); // Reset for next time
    }
  };

  const handleDecline = () => {
    onRespond(['decline']);
    setSelectedOptions(new Set());
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        padding: 24,
        maxWidth: 600,
        maxHeight: '80vh',
        width: '90%',
        border: '2px solid #3b82f6',
        boxShadow: '0 8px 32px rgba(59,130,246,0.3)',
        overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {sourceImage && (
            <img 
              src={sourceImage} 
              alt={sourceName || 'Card'} 
              style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>{sourceName || 'Make a Choice'}</h2>
            <div style={{ color: '#60a5fa', fontSize: 14, marginTop: 4 }}>
              {description}
            </div>
          </div>
        </div>

        {/* Options List */}
        <div style={{ marginBottom: 16 }}>
          {options.map((option) => {
            const isSelected = selectedOptions.has(option.id);
            const isDisabled = option.disabled || false;
            
            return (
              <button
                key={option.id}
                onClick={() => !isDisabled && handleToggleOption(option.id)}
                disabled={isDisabled}
                style={{
                  width: '100%',
                  padding: 12,
                  marginBottom: 8,
                  backgroundColor: isSelected ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${isSelected ? '#3b82f6' : isDisabled ? '#444' : '#666'}`,
                  borderRadius: 8,
                  color: isDisabled ? '#666' : '#fff',
                  fontSize: 16,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled && !isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.borderColor = '#888';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDisabled && !isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = '#666';
                  }
                }}
              >
                {option.imageUrl && (
                  <img 
                    src={option.imageUrl} 
                    alt={option.label} 
                    style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: isSelected ? 600 : 400 }}>{option.label}</div>
                  {option.description && (
                    <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <div style={{ color: '#3b82f6', fontSize: 20 }}>✓</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Help Text */}
        {minSelections > 0 || maxSelections > 1 ? (
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
            {minSelections === maxSelections
              ? `Select exactly ${minSelections} option${minSelections !== 1 ? 's' : ''}`
              : `Select ${minSelections} to ${maxSelections} option${maxSelections !== 1 ? 's' : ''}`}
          </div>
        ) : null}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          {!mandatory && (
            <button
              onClick={handleDecline}
              style={{
                flex: 1,
                padding: 12,
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid #666',
                borderRadius: 8,
                color: '#fff',
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
            >
              Decline
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              flex: 2,
              padding: 12,
              backgroundColor: canSubmit ? '#3b82f6' : 'rgba(59,130,246,0.3)',
              border: 'none',
              borderRadius: 8,
              color: canSubmit ? '#fff' : '#aaa',
              fontSize: 16,
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (canSubmit) {
                e.currentTarget.style.backgroundColor = '#2563eb';
              }
            }}
            onMouseLeave={(e) => {
              if (canSubmit) {
                e.currentTarget.style.backgroundColor = '#3b82f6';
              }
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
