import React, { useState, useCallback, useRef, useEffect, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * A draggable container for settings panels (Auto-Pass, Trigger Shortcuts, etc.)
 * positioned in the bottom-right corner by default but can be dragged anywhere.
 */
export function DraggableSettingsPanel({ children }: Props) {
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    // Try to restore saved position from localStorage
    try {
      const saved = localStorage.getItem('mtgedh:settingsPanelPos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          // Validate position is still visible
          return { x: parsed.x, y: parsed.y };
        }
      }
    } catch { /* ignore */ }
    // Default to bottom-right corner
    return { x: 0, y: 0 };
  });
  
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag from the header/drag handle area
    const target = e.target as HTMLElement;
    if (!target.closest('.settings-drag-handle')) return;
    
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
      
      // Clamp to window bounds (with some padding)
      const newX = dragRef.current.initialX + dx;
      const newY = dragRef.current.initialY + dy;
      
      setPosition({ x: newX, y: newY });
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      
      // Save position to localStorage
      try {
        localStorage.setItem('mtgedh:settingsPanelPos', JSON.stringify(position));
      } catch { /* ignore */ }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position]);
  
  // Save position when it changes
  useEffect(() => {
    if (!isDragging) {
      try {
        localStorage.setItem('mtgedh:settingsPanelPos', JSON.stringify(position));
      } catch { /* ignore */ }
    }
  }, [position, isDragging]);

  return (
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        bottom: 16 - position.y,
        right: 16 - position.x,
        zIndex: 50,
        maxWidth: 280,
        cursor: isDragging ? 'grabbing' : 'auto',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Drag handle at the top */}
      <div 
        className="settings-drag-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 8px',
          background: '#1a1a1a',
          borderRadius: '8px 8px 0 0',
          border: '1px solid #333',
          borderBottom: 'none',
          cursor: 'grab',
          color: '#666',
          fontSize: 10,
          gap: 4,
        }}
      >
        <span>⋮⋮</span>
        <span>Drag to move</span>
        <span>⋮⋮</span>
      </div>
      {children}
    </div>
  );
}

export default DraggableSettingsPanel;
