import React, { useState, useCallback, useEffect } from 'react';
import type { TriggerShortcut, TriggerShortcutType } from '../../../shared/src/types';
import { SHORTCUT_ELIGIBLE_TRIGGERS } from '../../../shared/src/types';

interface TriggerShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  socket: any;
  gameId: string;
  playerId: string;
  /** Current shortcuts for this player */
  currentShortcuts: TriggerShortcut[];
  /** Card names currently on the battlefield that have shortcut-eligible triggers */
  activeCards?: string[];
}

/**
 * Panel for configuring trigger shortcuts.
 * Allows players to set automatic responses for "may" triggers
 * and "opponent may pay" triggers to speed up gameplay.
 */
export const TriggerShortcutsPanel: React.FC<TriggerShortcutsPanelProps> = ({
  isOpen,
  onClose,
  socket,
  gameId,
  playerId,
  currentShortcuts,
  activeCards = [],
}) => {
  // Local state for shortcuts being edited
  const [localShortcuts, setLocalShortcuts] = useState<Record<string, TriggerShortcutType>>({});

  // Initialize local state from current shortcuts
  useEffect(() => {
    const shortcuts: Record<string, TriggerShortcutType> = {};
    currentShortcuts.forEach(s => {
      shortcuts[s.cardName] = s.preference;
    });
    setLocalShortcuts(shortcuts);
  }, [currentShortcuts]);

  const handleShortcutChange = useCallback((cardName: string, preference: TriggerShortcutType) => {
    // Update local state
    setLocalShortcuts(prev => ({
      ...prev,
      [cardName]: preference,
    }));

    // Emit to server
    if (socket && gameId) {
      socket.emit('setTriggerShortcut', {
        gameId,
        cardName,
        preference,
      });
    }
  }, [socket, gameId]);

  if (!isOpen) return null;

  // Get all eligible triggers, prioritizing ones currently active in the game
  const allTriggers = Object.entries(SHORTCUT_ELIGIBLE_TRIGGERS);
  const activeTriggers = allTriggers.filter(([name]) => 
    activeCards.some(c => c.toLowerCase() === name)
  );
  const inactiveTriggers = allTriggers.filter(([name]) => 
    !activeCards.some(c => c.toLowerCase() === name)
  );

  const renderTriggerRow = ([cardName, info]: [string, typeof SHORTCUT_ELIGIBLE_TRIGGERS[string]]) => {
    const currentValue = localShortcuts[cardName] || 'ask_each_time';
    const isActive = activeCards.some(c => c.toLowerCase() === cardName);

    return (
      <div
        key={cardName}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #3a3a3a',
          backgroundColor: isActive ? 'rgba(0, 128, 255, 0.1)' : 'transparent',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
            {cardName}
            {isActive && (
              <span style={{ 
                marginLeft: '8px', 
                fontSize: '10px', 
                backgroundColor: '#0080ff',
                padding: '2px 6px',
                borderRadius: '4px',
              }}>
                ACTIVE
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            {info.description}
          </div>
        </div>
        <select
          value={currentValue}
          onChange={(e) => handleShortcutChange(cardName, e.target.value as TriggerShortcutType)}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: '1px solid #555',
            backgroundColor: '#2a2a2a',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <option value="ask_each_time">Ask Each Time</option>
          {info.type === 'opponent_pays' ? (
            <>
              <option value="always_pay">Always Pay</option>
              <option value="never_pay">Never Pay</option>
            </>
          ) : (
            <>
              <option value="always_yes">Always Yes</option>
              <option value="always_no">Always No</option>
            </>
          )}
        </select>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1a1a1a',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #333',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '16px',
        }}>
          <h2 style={{ margin: 0 }}>⚡ Trigger Shortcuts</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: '24px',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <p style={{ color: '#888', marginBottom: '16px', fontSize: '14px' }}>
          Set automatic responses for triggers to speed up gameplay. 
          For opponent-pays triggers (like Smothering Tithe), you can choose to always pay, never pay, or be asked each time.
        </p>

        <div style={{ 
          flex: 1, 
          overflowY: 'auto',
          border: '1px solid #333',
          borderRadius: '8px',
        }}>
          {/* Active triggers first */}
          {activeTriggers.length > 0 && (
            <>
              <div style={{ 
                padding: '8px 12px', 
                backgroundColor: '#2a2a3a',
                fontWeight: 'bold',
                fontSize: '12px',
                color: '#0080ff',
              }}>
                ACTIVE IN GAME
              </div>
              {activeTriggers.map(renderTriggerRow)}
            </>
          )}

          {/* All other triggers */}
          {inactiveTriggers.length > 0 && (
            <>
              <div style={{ 
                padding: '8px 12px', 
                backgroundColor: '#2a2a2a',
                fontWeight: 'bold',
                fontSize: '12px',
                color: '#888',
              }}>
                ALL TRIGGERS
              </div>
              {inactiveTriggers.map(renderTriggerRow)}
            </>
          )}
        </div>

        <div style={{ 
          marginTop: '16px', 
          display: 'flex', 
          justifyContent: 'flex-end',
          gap: '12px',
        }}>
          <button
            onClick={() => {
              // Reset all to default
              Object.keys(SHORTCUT_ELIGIBLE_TRIGGERS).forEach(cardName => {
                handleShortcutChange(cardName, 'ask_each_time');
              });
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #555',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Reset All
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 24px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#0080ff',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default TriggerShortcutsPanel;
