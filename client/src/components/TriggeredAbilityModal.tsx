/**
 * TriggeredAbilityModal.tsx
 * 
 * Modal for handling triggered ability prompts.
 * Shows when a triggered ability needs player input (e.g., "may" abilities, 
 * target selection, or ordering multiple triggers).
 */

import React, { useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';

export interface TriggerPromptData {
  id: string;
  sourceId: string;
  sourceName: string;
  effect: string;
  type: 'may' | 'target' | 'order' | 'choice';
  options?: string[]; // For choice type
  targets?: { id: string; name: string; type: string }[]; // For target type
  imageUrl?: string;
}

export interface TriggeredAbilityModalProps {
  open: boolean;
  triggers: TriggerPromptData[];
  onResolve: (triggerId: string, choice: any) => void;
  onSkip: (triggerId: string) => void;
}

export function TriggeredAbilityModal({
  open,
  triggers,
  onResolve,
  onSkip,
}: TriggeredAbilityModalProps) {
  const [selectedTargets, setSelectedTargets] = useState<Map<string, string[]>>(new Map());
  const [selectedChoices, setSelectedChoices] = useState<Map<string, string>>(new Map());

  // Get current trigger (process one at a time)
  const currentTrigger = triggers[0];

  const handleMayChoice = (triggerId: string, doit: boolean) => {
    if (doit) {
      onResolve(triggerId, { accepted: true });
    } else {
      onSkip(triggerId);
    }
  };

  const handleTargetSelection = (triggerId: string, targetId: string) => {
    setSelectedTargets(prev => {
      const next = new Map(prev);
      const current = next.get(triggerId) || [];
      if (current.includes(targetId)) {
        next.set(triggerId, current.filter(id => id !== targetId));
      } else {
        next.set(triggerId, [...current, targetId]);
      }
      return next;
    });
  };

  const handleTargetConfirm = (triggerId: string) => {
    const targets = selectedTargets.get(triggerId) || [];
    onResolve(triggerId, { targets });
    setSelectedTargets(prev => {
      const next = new Map(prev);
      next.delete(triggerId);
      return next;
    });
  };

  const handleChoiceSelection = (triggerId: string, choice: string) => {
    setSelectedChoices(prev => {
      const next = new Map(prev);
      next.set(triggerId, choice);
      return next;
    });
  };

  const handleChoiceConfirm = (triggerId: string) => {
    const choice = selectedChoices.get(triggerId);
    if (choice) {
      onResolve(triggerId, { choice });
      setSelectedChoices(prev => {
        const next = new Map(prev);
        next.delete(triggerId);
        return next;
      });
    }
  };

  if (!open || !currentTrigger) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
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
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            ⚡ Triggered Ability
          </h2>
          {triggers.length > 1 && (
            <span style={{ fontSize: 12, color: '#888' }}>
              {triggers.length} triggers pending
            </span>
          )}
        </div>

        {/* Source info */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {currentTrigger.imageUrl && (
            <img
              src={currentTrigger.imageUrl}
              alt={currentTrigger.sourceName}
              style={{
                width: 120,
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {currentTrigger.sourceName}
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#ddd',
                padding: 12,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderRadius: 6,
                fontStyle: 'italic',
                lineHeight: 1.5,
              }}
            >
              {currentTrigger.effect}
            </div>
          </div>
        </div>

        {/* "May" type: Simple yes/no choice */}
        {currentTrigger.type === 'may' && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              marginTop: 16,
            }}
          >
            <button
              onClick={() => handleMayChoice(currentTrigger.id, true)}
              style={{
                padding: '12px 28px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: '#10b981',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Yes, do this
            </button>
            <button
              onClick={() => handleMayChoice(currentTrigger.id, false)}
              style={{
                padding: '12px 28px',
                borderRadius: 8,
                border: '1px solid #4a4a6a',
                backgroundColor: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              No, skip
            </button>
          </div>
        )}

        {/* "Target" type: Select from available targets */}
        {currentTrigger.type === 'target' && currentTrigger.targets && (
          <div>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
              Choose target(s):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {currentTrigger.targets.map(target => {
                const isSelected = (selectedTargets.get(currentTrigger.id) || []).includes(target.id);
                return (
                  <button
                    key={target.id}
                    onClick={() => handleTargetSelection(currentTrigger.id, target.id)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: isSelected ? '2px solid #10b981' : '1px solid #4a4a6a',
                      backgroundColor: isSelected ? 'rgba(16,185,129,0.2)' : 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {target.name}
                    <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>
                      ({target.type})
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => onSkip(currentTrigger.id)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid #4a4a6a',
                  backgroundColor: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleTargetConfirm(currentTrigger.id)}
                disabled={(selectedTargets.get(currentTrigger.id) || []).length === 0}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: (selectedTargets.get(currentTrigger.id) || []).length === 0 ? 0.5 : 1,
                }}
              >
                Confirm Target{(selectedTargets.get(currentTrigger.id) || []).length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {/* "Choice" type: Pick one option from a list */}
        {currentTrigger.type === 'choice' && currentTrigger.options && (
          <div>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
              Choose one:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {currentTrigger.options.map((option, idx) => {
                const isSelected = selectedChoices.get(currentTrigger.id) === option;
                return (
                  <button
                    key={idx}
                    onClick={() => handleChoiceSelection(currentTrigger.id, option)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 6,
                      border: isSelected ? '2px solid #10b981' : '1px solid #4a4a6a',
                      backgroundColor: isSelected ? 'rgba(16,185,129,0.2)' : 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 13,
                      textAlign: 'left',
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => onSkip(currentTrigger.id)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid #4a4a6a',
                  backgroundColor: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleChoiceConfirm(currentTrigger.id)}
                disabled={!selectedChoices.get(currentTrigger.id)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: !selectedChoices.get(currentTrigger.id) ? 0.5 : 1,
                }}
              >
                Confirm Choice
              </button>
            </div>
          </div>
        )}

        {/* "Order" type: For ordering multiple simultaneous triggers */}
        {currentTrigger.type === 'order' && (
          <div>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
              This trigger will go on the stack.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => onResolve(currentTrigger.id, { order: 'stack' })}
                style={{
                  padding: '12px 28px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TriggeredAbilityModal;
