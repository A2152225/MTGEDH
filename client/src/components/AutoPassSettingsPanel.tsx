import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  autoPassSteps: Set<string>;
  onToggleAutoPass: (step: string, enabled: boolean) => void;
  onClearAll: () => void;
  onSelectAll: () => void;
  isSinglePlayer?: boolean;
  onToggleAutoPassForTurn?: () => void;
  autoPassForTurnEnabled?: boolean;
}

/**
 * List of steps that can have auto-pass configured
 * Used internally for enable/disable all functionality
 */
const CONFIGURABLE_STEPS = [
  { key: 'upkeep', label: 'Upkeep Step' },
  { key: 'draw', label: 'Draw Step' },
  { key: 'main1', label: 'Main Phase 1 (end)' },
  { key: 'begincombat', label: 'Beginning of Combat' },
  { key: 'declareattackers', label: 'Declare Attackers (after)' },
  { key: 'declareblockers', label: 'Declare Blockers (after)' },
  { key: 'damage', label: 'Combat Damage' },
  { key: 'endcombat', label: 'End of Combat' },
  { key: 'main2', label: 'Main Phase 2 (end)' },
  { key: 'end', label: 'End Step' },
];

export function AutoPassSettingsPanel({ 
  autoPassSteps, 
  onToggleAutoPass, 
  onClearAll, 
  onSelectAll, 
  isSinglePlayer,
  onToggleAutoPassForTurn,
  autoPassForTurnEnabled
}: Props) {
  const hasAnyAutoPass = autoPassSteps.size > 0;
  const hasAllAutoPass = autoPassSteps.size >= CONFIGURABLE_STEPS.length;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasAutoEnabledRef = useRef(false);
  
  // Auto-enable all auto-pass for single player mode (only once)
  // Note: autoPassSteps is intentionally NOT in the dependency array because:
  // 1. We use hasAutoEnabledRef to ensure this only runs once per single player session
  // 2. Adding it would cause unnecessary re-runs when user manually toggles steps
  // 3. The ref pattern prevents the stale closure issue
  useEffect(() => {
    // Only auto-enable once when entering single player mode
    if (isSinglePlayer && !hasAutoEnabledRef.current) {
      hasAutoEnabledRef.current = true;
      // Enable all auto-pass settings for single player mode
      for (const { key } of CONFIGURABLE_STEPS) {
        if (!autoPassSteps.has(key)) {
          onToggleAutoPass(key, true);
        }
      }
    }
    // Reset the flag when leaving single player mode
    if (!isSinglePlayer) {
      hasAutoEnabledRef.current = false;
    }
  }, [isSinglePlayer, onToggleAutoPass]);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag from the header area
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.closest('.drag-handle')) return;
    
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
    e.preventDefault();
  }, [position]);
  
  useEffect(() => {
    if (!isDragging) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      
      setPosition({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy,
      });
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);
  
  // Handler for main toggle - enables/disables all steps
  const handleMainToggle = useCallback(() => {
    if (hasAllAutoPass) {
      onClearAll();
    } else {
      onSelectAll();
    }
  }, [hasAllAutoPass, onClearAll, onSelectAll]);
  
  return (
    <div 
      ref={panelRef}
      style={{
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 0,
        marginTop: 8,
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'auto',
        userSelect: isDragging ? 'none' : 'auto',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header - draggable and clickable to collapse */}
      <div 
        className="drag-handle"
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: isCollapsed ? 'none' : '1px solid #333',
          cursor: 'grab',
          background: '#222',
          borderRadius: isCollapsed ? 8 : '8px 8px 0 0',
        }}
      >
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            margin: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 10, color: '#888' }}>
            {isCollapsed ? '▶' : '▼'}
          </span>
          <span style={{ fontSize: 13, color: '#ddd', fontWeight: 500 }}>
            ⚡ Auto-Pass {isSinglePlayer && <span style={{ fontSize: 10, color: '#10b981' }}>(Solo)</span>}
          </span>
        </button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#666' }}>⋮⋮</span>
        </div>
      </div>
      
      {/* Collapsible content - Simplified UI */}
      {!isCollapsed && (
        <div style={{ padding: '12px' }}>
          <p style={{ fontSize: 11, color: '#888', margin: '0 0 12px', lineHeight: 1.4 }}>
            Automatically pass priority when you have no legal actions available.
            {isSinglePlayer && <span style={{ color: '#10b981' }}> (auto-enabled for solo play)</span>}
          </p>
          
          {/* Main Auto-Pass Toggle */}
          <div style={{ 
            background: '#252525',
            border: '1px solid #333',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 10,
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}>
              <span style={{ fontSize: 12, color: '#ddd', fontWeight: 500 }}>
                Enable Smart Auto-Pass
              </span>
              <div style={{ position: 'relative' }}>
                <input
                  type="checkbox"
                  checked={hasAllAutoPass}
                  onChange={handleMainToggle}
                  style={{ 
                    cursor: 'pointer',
                    width: 40,
                    height: 20,
                    appearance: 'none',
                    background: hasAllAutoPass ? '#10b981' : '#444',
                    borderRadius: 10,
                    position: 'relative',
                    transition: 'background 0.2s',
                    outline: 'none',
                  }}
                />
                <span style={{
                  position: 'absolute',
                  top: 2,
                  left: hasAllAutoPass ? 22 : 2,
                  width: 16,
                  height: 16,
                  background: 'white',
                  borderRadius: '50%',
                  transition: 'left 0.2s',
                  pointerEvents: 'none',
                }} />
              </div>
            </label>
            <p style={{ fontSize: 9, color: '#666', margin: '6px 0 0', lineHeight: 1.3 }}>
              Auto-passes when you can't: cast spells, play lands, activate abilities, attack, or block
            </p>
          </div>
          
          {/* Auto-Pass for Rest of Turn Button */}
          {onToggleAutoPassForTurn && (
            <button
              onClick={onToggleAutoPassForTurn}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: autoPassForTurnEnabled 
                  ? 'linear-gradient(90deg, #dc2626, #b91c1c)' 
                  : 'linear-gradient(90deg, #3b82f6, #2563eb)',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginBottom: 10,
              }}
            >
              {autoPassForTurnEnabled ? (
                <>
                  <span>⏸</span>
                  <span>Stop Auto-Passing Turn</span>
                </>
              ) : (
                <>
                  <span>⏩</span>
                  <span>Auto-Pass Rest of Turn</span>
                </>
              )}
            </button>
          )}
          
          {/* Advanced Options - Collapsible */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ 
              fontSize: 10, 
              color: '#888', 
              cursor: 'pointer',
              padding: '4px 0',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{ fontSize: 8 }}>▶</span>
              Advanced Settings
            </summary>
            <div style={{ 
              marginTop: 8,
              padding: '8px',
              background: '#1e1e1e',
              borderRadius: 4,
              border: '1px solid #2a2a2a',
            }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button
                  onClick={onSelectAll}
                  disabled={hasAllAutoPass}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    background: hasAllAutoPass ? '#333' : '#10b981',
                    border: 'none',
                    borderRadius: 4,
                    color: hasAllAutoPass ? '#666' : 'white',
                    cursor: hasAllAutoPass ? 'not-allowed' : 'pointer',
                    fontSize: 9,
                  }}
                >
                  Enable All
                </button>
                <button
                  onClick={onClearAll}
                  disabled={!hasAnyAutoPass}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    background: !hasAnyAutoPass ? '#333' : '#dc2626',
                    border: 'none',
                    borderRadius: 4,
                    color: !hasAnyAutoPass ? '#666' : 'white',
                    cursor: !hasAnyAutoPass ? 'not-allowed' : 'pointer',
                    fontSize: 9,
                  }}
                >
                  Disable All
                </button>
              </div>
              <p style={{ fontSize: 9, color: '#666', margin: '0 0 6px' }}>
                Fine-tune auto-pass for specific steps:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {CONFIGURABLE_STEPS.map(({ key, label }) => (
                  <label 
                    key={key}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 6, 
                      fontSize: 10, 
                      color: '#aaa',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: 3,
                      background: autoPassSteps.has(key) ? '#1a3a1a' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={autoPassSteps.has(key)}
                      onChange={e => onToggleAutoPass(key, e.target.checked)}
                      style={{ cursor: 'pointer', width: 11, height: 11 }}
                    />
                    {label}
                    {autoPassSteps.has(key) && (
                      <span style={{ 
                        fontSize: 7, 
                        color: '#10b981',
                        marginLeft: 'auto',
                      }}>
                        ✓
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export default AutoPassSettingsPanel;
