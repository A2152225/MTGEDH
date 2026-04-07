import React, { useDeferredValue, useEffect, useRef, useState } from 'react';

interface CardNameChoiceModalProps {
  open: boolean;
  title?: string;
  description?: string;
  cardName?: string;
  sourceImageUrl?: string;
  mandatory?: boolean;
  restrictionText?: string;
  candidateNames?: string[];
  onConfirm: (cardName: string) => void;
  onCancel: () => void;
}

function normalizeCardNameChoiceValue(value: string): string {
  return String(value || '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function CardNameChoiceModal({
  open,
  title = 'Choose a Card Name',
  description,
  cardName,
  sourceImageUrl,
  mandatory = true,
  restrictionText,
  candidateNames,
  onConfirm,
  onCancel,
}: CardNameChoiceModalProps) {
  const [value, setValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredValue = useDeferredValue(value);

  useEffect(() => {
    if (open) {
      setValue('');
      setHighlightedIndex(0);
      setSelectedCandidate(null);
      // Focus after mount
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const trimmed = value.trim();
  const normalizedQuery = normalizeCardNameChoiceValue(deferredValue);
  const availableCandidates = Array.isArray(candidateNames) ? candidateNames : [];
  const filteredCandidates = availableCandidates
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return normalizeCardNameChoiceValue(candidate).includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftNormalized = normalizeCardNameChoiceValue(left);
      const rightNormalized = normalizeCardNameChoiceValue(right);
      const leftStartsWith = normalizedQuery ? leftNormalized.startsWith(normalizedQuery) : true;
      const rightStartsWith = normalizedQuery ? rightNormalized.startsWith(normalizedQuery) : true;
      if (leftStartsWith !== rightStartsWith) {
        return leftStartsWith ? -1 : 1;
      }
      if (left.length !== right.length) {
        return left.length - right.length;
      }
      return left.localeCompare(right);
    })
    .slice(0, 60);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [normalizedQuery, open]);

  if (!open) return null;

  const canonicalCandidate = availableCandidates.find(
    (candidate) => normalizeCardNameChoiceValue(candidate) === normalizeCardNameChoiceValue(trimmed)
  );
  const highlightedCandidate = filteredCandidates[highlightedIndex];
  const normalizedSelectedCandidate = selectedCandidate
    ? availableCandidates.find(
        (candidate) => normalizeCardNameChoiceValue(candidate) === normalizeCardNameChoiceValue(selectedCandidate)
      )
    : undefined;
  const resolvedSelection = canonicalCandidate
    || normalizedSelectedCandidate
    || (availableCandidates.length === 0 ? trimmed : undefined);
  const canConfirm = Boolean(resolvedSelection && String(resolvedSelection).trim());

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(String(resolvedSelection).trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && filteredCandidates.length > 0) {
      e.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredCandidates.length - 1));
    } else if (e.key === 'ArrowUp' && filteredCandidates.length > 0) {
      e.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (availableCandidates.length > 0 && highlightedCandidate && !canonicalCandidate && !normalizedSelectedCandidate) {
        setValue(highlightedCandidate);
        setSelectedCandidate(highlightedCandidate);
        return;
      }
      handleConfirm();
    } else if (e.key === 'Escape') {
      if (!mandatory) onCancel();
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
        if (!mandatory && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 520,
          width: '92%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {sourceImageUrl && (
            <img
              src={sourceImageUrl}
              alt={cardName || 'source'}
              style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
            {cardName && (
              <div style={{ marginTop: 4, fontSize: 14, color: '#888' }}>
                for {cardName}
              </div>
            )}
            {description && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#aaa' }}>{description}</div>
            )}
          </div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSelectedCandidate(null);
            }}
            placeholder="Type a card name…"
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
          <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
            {availableCandidates.length > 0
              ? `Search ${availableCandidates.length.toLocaleString()} ${restrictionText || 'card'} names. Select an exact match, then confirm.`
              : 'Enter the exact name you want to choose.'}
          </div>
        </div>

        {availableCandidates.length > 0 && (
          <div
            style={{
              border: '1px solid #2f2f4d',
              borderRadius: 8,
              backgroundColor: '#141428',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {filteredCandidates.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 13, color: '#888' }}>
                No {restrictionText || 'card'} names match "{trimmed}".
              </div>
            ) : (
              filteredCandidates.map((candidate, index) => {
                const selected = index === highlightedIndex;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => {
                      setValue(candidate);
                      setSelectedCandidate(candidate);
                      setHighlightedIndex(index);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      borderBottom: index < filteredCandidates.length - 1 ? '1px solid #20203a' : 'none',
                      backgroundColor: selected ? '#21314e' : 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    {candidate}
                  </button>
                );
              })
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          {!mandatory && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #3a3a5a',
                background: 'transparent',
                color: '#ddd',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: canConfirm ? '#3b82f6' : 'rgba(59, 130, 246, 0.4)',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontWeight: 700,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
