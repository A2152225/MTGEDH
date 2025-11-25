/**
 * CreatureTypeSelectModal.tsx
 * 
 * A modal for selecting a creature type.
 * Used for cards like Kindred Discovery, Coat of Arms, and other 
 * effects that require choosing a creature type.
 * 
 * Features:
 * - Searchable list of all creature types
 * - Quick filter by letter
 * - Supports custom type entry (for new cards)
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CREATURE_TYPES, searchCreatureTypes } from '../../../shared/src/creatureTypes';

interface CreatureTypeSelectModalProps {
  open: boolean;
  title?: string;
  description?: string;
  cardName?: string;
  onSelect: (creatureType: string) => void;
  onCancel: () => void;
  allowCustom?: boolean;
}

export function CreatureTypeSelectModal({
  open,
  title = 'Choose a Creature Type',
  description,
  cardName,
  onSelect,
  onCancel,
  allowCustom = true,
}: CreatureTypeSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [customType, setCustomType] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Filter creature types based on search
  const filteredTypes = useMemo(() => {
    return searchCreatureTypes(searchQuery);
  }, [searchQuery]);
  
  // Focus search input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);
  
  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedType(null);
      setCustomType('');
      setShowCustomInput(false);
    }
  }, [open]);
  
  if (!open) return null;
  
  const handleConfirm = () => {
    if (showCustomInput && customType.trim()) {
      onSelect(customType.trim());
    } else if (selectedType) {
      onSelect(selectedType);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // If only one result, auto-select it
      if (filteredTypes.length === 1 && !showCustomInput) {
        onSelect(filteredTypes[0]);
      } else if (selectedType || (showCustomInput && customType.trim())) {
        handleConfirm();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };
  
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {title}
          </h2>
          {cardName && (
            <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
              for {cardName}
            </div>
          )}
          {description && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#aaa' }}>
              {description}
            </div>
          )}
        </div>
        
        {/* Search Input */}
        <div style={{ marginBottom: 12 }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedType(null);
              setShowCustomInput(false);
            }}
            placeholder="Search creature types..."
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: '#252540',
              color: '#fff',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        
        {/* Type List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
            maxHeight: '300px',
          }}
        >
          {filteredTypes.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
              {filteredTypes.map((type) => (
                <div
                  key={type}
                  onClick={() => {
                    setSelectedType(type);
                    setShowCustomInput(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    backgroundColor: selectedType === type ? '#3b82f6' : 'transparent',
                    color: selectedType === type ? '#fff' : '#ddd',
                    fontSize: 13,
                    transition: 'background 0.1s',
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => {
                    if (selectedType !== type) {
                      (e.target as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedType !== type) {
                      (e.target as HTMLElement).style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {type}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>
              No creature types match "{searchQuery}"
            </div>
          )}
        </div>
        
        {/* Custom Type Option */}
        {allowCustom && (
          <div style={{ marginTop: 12 }}>
            {!showCustomInput ? (
              <button
                onClick={() => {
                  setShowCustomInput(true);
                  setSelectedType(null);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px dashed #4a4a6a',
                  backgroundColor: 'transparent',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 13,
                  width: '100%',
                }}
              >
                + Enter a custom creature type
              </button>
            ) : (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: '#888' }}>
                  Custom creature type (for new/unsupported cards):
                </div>
                <input
                  type="text"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  placeholder="e.g., Dragon, Merfolk, Wizard..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 6,
                    border: '1px solid #3b82f6',
                    backgroundColor: '#252540',
                    color: '#fff',
                    fontSize: 14,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  autoFocus
                />
              </div>
            )}
          </div>
        )}
        
        {/* Selected display */}
        {(selectedType || (showCustomInput && customType.trim())) && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              Selected: <strong>{showCustomInput ? customType.trim() : selectedType}</strong>
            </span>
          </div>
        )}
        
        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            marginTop: 16,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedType && (!showCustomInput || !customType.trim())}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: selectedType || (showCustomInput && customType.trim()) ? '#3b82f6' : '#4a4a6a',
              color: '#fff',
              cursor: selectedType || (showCustomInput && customType.trim()) ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreatureTypeSelectModal;
