import React from 'react';

interface Props {
  autoPassSteps: Set<string>;
  onToggleAutoPass: (step: string, enabled: boolean) => void;
  onClearAll: () => void;
}

/**
 * List of steps that can have auto-pass configured
 */
const CONFIGURABLE_STEPS = [
  { key: 'upkeep', label: 'Upkeep Step' },
  { key: 'draw', label: 'Draw Step' },
  { key: 'begincombat', label: 'Beginning of Combat' },
  { key: 'declareattackers', label: 'Declare Attackers (after)' },
  { key: 'declareblockers', label: 'Declare Blockers (after)' },
  { key: 'damage', label: 'Combat Damage' },
  { key: 'endcombat', label: 'End of Combat' },
  { key: 'end', label: 'End Step' },
];

export function AutoPassSettingsPanel({ autoPassSteps, onToggleAutoPass, onClearAll }: Props) {
  const hasAnyAutoPass = autoPassSteps.size > 0;
  
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 10,
      }}>
        <h4 style={{ margin: 0, fontSize: 13, color: '#ddd' }}>
          ⚡ Auto-Pass Priority Settings
        </h4>
        {hasAnyAutoPass && (
          <button
            onClick={onClearAll}
            style={{
              padding: '4px 8px',
              background: '#dc2626',
              border: 'none',
              borderRadius: 4,
              color: 'white',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            Clear All
          </button>
        )}
      </div>
      
      <p style={{ fontSize: 11, color: '#888', margin: '0 0 10px' }}>
        When enabled, you'll automatically pass priority during these steps (unless you have cards to play).
      </p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CONFIGURABLE_STEPS.map(({ key, label }) => (
          <label 
            key={key}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              fontSize: 12, 
              color: '#ccc',
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            <input
              type="checkbox"
              checked={autoPassSteps.has(key)}
              onChange={e => onToggleAutoPass(key, e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            {label}
            {autoPassSteps.has(key) && (
              <span style={{ 
                fontSize: 9, 
                color: '#10b981',
                marginLeft: 'auto',
              }}>
                ✓ Auto-pass
              </span>
            )}
          </label>
        ))}
      </div>
      
      {!hasAnyAutoPass && (
        <p style={{ 
          fontSize: 10, 
          color: '#666', 
          margin: '10px 0 0',
          fontStyle: 'italic',
        }}>
          No auto-pass steps configured. Priority popups will appear on step changes.
        </p>
      )}
    </div>
  );
}

export default AutoPassSettingsPanel;
