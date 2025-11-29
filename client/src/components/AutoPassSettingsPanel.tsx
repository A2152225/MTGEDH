import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  autoPassSteps: Set<string>;
  onToggleAutoPass: (step: string, enabled: boolean) => void;
  onClearAll: () => void;
  isSinglePlayer?: boolean;
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

export function AutoPassSettingsPanel({ autoPassSteps, onToggleAutoPass, onClearAll, isSinglePlayer }: Props) {
  const hasAnyAutoPass = autoPassSteps.size > 0;
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
          {hasAnyAutoPass && !isCollapsed && (
            <button
              onClick={onClearAll}
              style={{
                padding: '3px 6px',
                background: '#dc2626',
                border: 'none',
                borderRadius: 4,
                color: 'white',
                cursor: 'pointer',
                fontSize: 9,
              }}
            >
              Clear All
            </button>
          )}
          <span style={{ fontSize: 9, color: '#666' }}>⋮⋮</span>
        </div>
      </div>
      
      {/* Collapsible content */}
      {!isCollapsed && (
        <div style={{ padding: '10px 12px' }}>
          <p style={{ fontSize: 10, color: '#888', margin: '0 0 8px' }}>
            Auto-pass priority during these steps
            {isSinglePlayer && <span style={{ color: '#10b981' }}> (auto-enabled for solo play)</span>}
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {CONFIGURABLE_STEPS.map(({ key, label }) => (
              <label 
                key={key}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 6, 
                  fontSize: 11, 
                  color: '#ccc',
                  cursor: 'pointer',
                  padding: '2px 0',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoPassSteps.has(key)}
                  onChange={e => onToggleAutoPass(key, e.target.checked)}
                  style={{ cursor: 'pointer', width: 12, height: 12 }}
                />
                {label}
                {autoPassSteps.has(key) && (
                  <span style={{ 
                    fontSize: 8, 
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
      )}
    </div>
  );
}

export default AutoPassSettingsPanel;
