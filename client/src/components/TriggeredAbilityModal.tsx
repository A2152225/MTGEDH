/**
 * TriggeredAbilityModal.tsx
 * 
 * Modal for handling triggered ability prompts.
 * Shows when a triggered ability needs player input (e.g., "may" abilities, 
 * target selection, or ordering multiple triggers).
 */

import React, { useState, useCallback, useEffect } from 'react';
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
  onOrderConfirm?: (orderedTriggerIds: string[]) => void; // New callback for batch ordering
}

export function TriggeredAbilityModal({
  open,
  triggers,
  onResolve,
  onSkip,
  onOrderConfirm,
}: TriggeredAbilityModalProps) {
  const [selectedTargets, setSelectedTargets] = useState<Map<string, string[]>>(new Map());
  const [selectedChoices, setSelectedChoices] = useState<Map<string, string>>(new Map());
  
  // For ordering mode: track the order of triggers
  const [orderedTriggers, setOrderedTriggers] = useState<TriggerPromptData[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Get only 'order' type triggers
  const orderTypeTriggers = triggers.filter(t => t.type === 'order');
  const nonOrderTriggers = triggers.filter(t => t.type !== 'order');
  
  // When we have multiple order-type triggers, show the ordering UI
  const showOrderingMode = orderTypeTriggers.length > 1;
  
  // Initialize ordered triggers when the list changes
  useEffect(() => {
    if (showOrderingMode) {
      setOrderedTriggers([...orderTypeTriggers]);
    }
  }, [triggers.length, showOrderingMode]);

  // Get current trigger (process one at a time for non-order types)
  const currentTrigger = showOrderingMode ? null : (nonOrderTriggers[0] || orderTypeTriggers[0]);

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

  // Drag and drop handlers for reordering
  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    setOrderedTriggers(prev => {
      const newList = [...prev];
      const draggedItem = newList[draggedIndex];
      newList.splice(draggedIndex, 1);
      newList.splice(index, 0, draggedItem);
      setDraggedIndex(index);
      return newList;
    });
  }, [draggedIndex]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  // Move trigger up in the order
  const moveTriggerUp = useCallback((index: number) => {
    if (index === 0) return;
    setOrderedTriggers(prev => {
      const newList = [...prev];
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
      return newList;
    });
  }, []);

  // Move trigger down in the order
  const moveTriggerDown = useCallback((index: number) => {
    if (index >= orderedTriggers.length - 1) return;
    setOrderedTriggers(prev => {
      const newList = [...prev];
      [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
      return newList;
    });
  }, [orderedTriggers.length]);

  // Confirm the order - triggers at the top of the list go on the stack first (resolve last)
  const handleOrderConfirm = useCallback(() => {
    if (onOrderConfirm) {
      // Send ordered trigger IDs - first in list goes on stack first (resolves last)
      onOrderConfirm(orderedTriggers.map(t => t.id));
    } else {
      // Fallback: resolve each trigger in order
      for (const trigger of orderedTriggers) {
        onResolve(trigger.id, { order: orderedTriggers.indexOf(trigger) });
      }
    }
  }, [orderedTriggers, onOrderConfirm, onResolve]);

  if (!open) return null;
  
  // Show ordering UI when we have multiple order-type triggers
  if (showOrderingMode) {
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
            maxWidth: 600,
            width: '90%',
            maxHeight: '85vh',
            overflow: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#fff',
          }}
        >
          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              ⚡ Order Triggered Abilities
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
              You control {orderedTriggers.length} triggers that happen at the same time.
              Drag to reorder them, or use the arrows. 
              <strong style={{ color: '#f59e0b' }}> Top trigger goes on stack first (resolves last).</strong>
            </p>
          </div>

          {/* Trigger list with drag handles */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 8, 
            marginBottom: 20,
            maxHeight: '50vh',
            overflowY: 'auto',
          }}>
            {orderedTriggers.map((trigger, index) => (
              <div
                key={trigger.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  backgroundColor: draggedIndex === index ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid',
                  borderColor: draggedIndex === index ? '#6366f1' : 'rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  cursor: 'grab',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Order number */}
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: index === 0 ? '#f59e0b' : '#4b5563',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 'bold',
                  flexShrink: 0,
                }}>
                  {index + 1}
                </div>

                {/* Card image */}
                {trigger.imageUrl && (
                  <img
                    src={trigger.imageUrl}
                    alt={trigger.sourceName}
                    style={{
                      width: 50,
                      height: 70,
                      borderRadius: 4,
                      objectFit: 'cover',
                      flexShrink: 0,
                    }}
                  />
                )}

                {/* Trigger info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    {trigger.sourceName}
                  </div>
                  <div style={{ 
                    fontSize: 11, 
                    color: '#aaa',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {trigger.effect}
                  </div>
                </div>

                {/* Reorder buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button
                    onClick={() => moveTriggerUp(index)}
                    disabled={index === 0}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: index === 0 ? '#374151' : '#4b5563',
                      color: index === 0 ? '#6b7280' : '#fff',
                      cursor: index === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                    title="Move up (resolve later)"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveTriggerDown(index)}
                    disabled={index === orderedTriggers.length - 1}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: index === orderedTriggers.length - 1 ? '#374151' : '#4b5563',
                      color: index === orderedTriggers.length - 1 ? '#6b7280' : '#fff',
                      cursor: index === orderedTriggers.length - 1 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                    title="Move down (resolve sooner)"
                  >
                    ▼
                  </button>
                </div>

                {/* Drag handle indicator */}
                <div style={{ 
                  color: '#6b7280', 
                  fontSize: 14,
                  letterSpacing: 2,
                  opacity: 0.6,
                }}>
                  ⋮⋮
                </div>
              </div>
            ))}
          </div>

          {/* Resolution order explanation */}
          <div style={{
            padding: 12,
            backgroundColor: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 8,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, color: '#fcd34d' }}>
              <strong>Resolution order:</strong> {orderedTriggers.slice().reverse().map((t, i) => 
                `${i + 1}. ${t.sourceName}`
              ).join(' → ')}
            </div>
          </div>

          {/* Confirm button */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={handleOrderConfirm}
              style={{
                padding: '14px 40px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: '#10b981',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Confirm Order & Put on Stack
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Regular single-trigger handling
  if (!currentTrigger) return null;

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

        {/* "Order" type: Single trigger - just confirm it */}
        {currentTrigger.type === 'order' && (
          <div>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
              This triggered ability will go on the stack.
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
