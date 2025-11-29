import React, { useState, useCallback, useRef } from 'react';
import type { StackItem, KnownCardRef, PlayerID, BattlefieldPermanent } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

interface Props {
  stack: StackItem[];
  battlefield?: BattlefieldPermanent[];
  you?: PlayerID;
  priorityPlayer?: PlayerID;
  onPass?: () => void;
  onIgnoreTriggerSource?: (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => void;
  ignoredSources?: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }>;
  onStopIgnoring?: (sourceKey: string) => void;
}

export function CentralStack({ 
  stack, 
  battlefield, 
  you, 
  priorityPlayer, 
  onPass,
  onIgnoreTriggerSource,
  ignoredSources,
  onStopIgnoring,
}: Props) {
  // Position state for dragging
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  
  // Don't render if stack is empty
  if (stack.length === 0) {
    return null;
  }
  
  // Helper to find a permanent's card data by ID for hover preview
  const findTargetCard = (targetId: string): KnownCardRef | undefined => {
    if (!battlefield) return undefined;
    const perm = battlefield.find(p => p.id === targetId);
    return perm?.card as KnownCardRef | undefined;
  };
  
  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start drag on the header area
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      e.preventDefault();
      const currentX = position?.x ?? 0;
      const currentY = position?.y ?? 0;
      dragStartRef.current = { x: e.clientX, y: e.clientY, posX: currentX, posY: currentY };
      setIsDragging(true);
      
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (dragStartRef.current) {
          const deltaX = moveEvent.clientX - dragStartRef.current.x;
          const deltaY = moveEvent.clientY - dragStartRef.current.y;
          setPosition({
            x: dragStartRef.current.posX + deltaX,
            y: dragStartRef.current.posY + deltaY,
          });
        }
      };
      
      const handleMouseUp = () => {
        setIsDragging(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };
  
  // Calculate transform based on position
  const transform = position 
    ? `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`
    : 'translate(-50%, -50%)';

  return (
    <div 
      onMouseDown={handleMouseDown}
      style={{
        position:'absolute',
        left:'50%',
        top:'50%',
        transform,
        background:'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(40,40,60,0.95))',
        border:'2px solid #6366f1',
        borderRadius:12,
        padding:16,
        minWidth:280,
        maxWidth:400,
        pointerEvents:'auto',
        zIndex:100,
        boxShadow:'0 8px 32px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.2)',
        backdropFilter:'blur(8px)',
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: isDragging ? 'none' : 'auto',
      }}>
      {/* Header - drag handle */}
      <div 
        data-drag-handle
        style={{ 
          display:'flex', 
          justifyContent:'space-between', 
          alignItems:'center', 
          marginBottom:12,
          paddingBottom:8,
          borderBottom:'1px solid rgba(99,102,241,0.3)',
          cursor: 'grab',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Drag grip indicator */}
          <span style={{ 
            color:'#6b7280', 
            fontSize:14,
            letterSpacing:2,
            marginRight:4,
            opacity:0.6
          }}>⋮⋮</span>
          <span style={{ 
            fontSize:20, 
            fontWeight:'bold',
            background:'linear-gradient(90deg, #818cf8, #c084fc)',
            backgroundClip:'text',
            WebkitBackgroundClip:'text',
            WebkitTextFillColor:'transparent',
            color:'transparent'
          }}>
            ⚡ Stack
          </span>
          <span style={{
            background:'#6366f1',
            color:'white',
            padding:'2px 8px',
            borderRadius:12,
            fontSize:12,
            fontWeight:'bold'
          }}>
            {stack.length}
          </span>
        </div>
        <button 
          onClick={onPass} 
          disabled={priorityPlayer!==you} 
          style={{ 
            fontSize:12,
            padding:'6px 16px',
            borderRadius:6,
            border:'none',
            background: priorityPlayer===you ? 'linear-gradient(90deg, #10b981, #059669)' : '#374151',
            color: priorityPlayer===you ? 'white' : '#9ca3af',
            cursor: priorityPlayer===you ? 'pointer' : 'not-allowed',
            fontWeight:'bold',
            transition:'all 0.2s'
          }}
        >
          Pass Priority
        </button>
      </div>

      {/* Stack items - show most recent first (top of stack) */}
      <div style={{ 
        display:'flex', 
        flexDirection:'column', 
        gap:8,
        maxHeight:400,
        overflowY:'auto'
      }}>
        {stack.slice().reverse().map((it, idx) => {
          const kc = it.card as KnownCardRef | undefined;
          // For triggered abilities, use sourceName; for spells, use card.name; fallback to ID
          const name = kc?.name || (it as any).sourceName || it.id;
          const imageUrl = kc?.image_uris?.small || kc?.image_uris?.normal || null;
          const isTopOfStack = idx === 0;
          // For triggered abilities, show the description
          const description = (it as any).description || null;
          // Check if this is a triggered ability that can be auto-resolved
          const isTriggeredAbility = (it as any).type === 'triggered_ability';
          const sourceId = (it as any).source || (it as any).sourceId;
          const sourceName = (it as any).sourceName || name;
          
          return (
            <div
              key={it.id}
              onMouseEnter={(e)=> kc && showCardPreview(e.currentTarget as HTMLElement, kc, { prefer:'right', anchorPadding:8 })}
              onMouseLeave={(e)=> kc && hideCardPreview(e.currentTarget as HTMLElement)}
              style={{
                display:'flex',
                alignItems:'center',
                gap:12,
                padding:'10px 12px',
                border: isTopOfStack ? '2px solid #f59e0b' : '1px solid rgba(99,102,241,0.4)',
                borderRadius:8,
                background: isTopOfStack 
                  ? 'linear-gradient(90deg, rgba(245,158,11,0.2), rgba(217,119,6,0.1))' 
                  : 'rgba(30,30,50,0.6)',
                cursor: kc ? 'pointer' : 'default',
                transition:'all 0.2s',
                boxShadow: isTopOfStack ? '0 0 12px rgba(245,158,11,0.3)' : 'none'
              }}
            >
              {/* Stack position indicator */}
              <div style={{
                width:28,
                height:28,
                borderRadius:'50%',
                background: isTopOfStack ? '#f59e0b' : '#4b5563',
                display:'flex',
                alignItems:'center',
                justifyContent:'center',
                fontSize:12,
                fontWeight:'bold',
                color:'white',
                flexShrink:0
              }}>
                {stack.length - idx}
              </div>

              {/* Card thumbnail */}
              {imageUrl && (
                <img 
                  src={imageUrl} 
                  alt={name}
                  style={{
                    width:40,
                    height:56,
                    borderRadius:4,
                    objectFit:'cover',
                    border:'1px solid rgba(255,255,255,0.2)',
                    flexShrink:0
                  }}
                />
              )}

              {/* Card info */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ 
                  fontSize:14, 
                  fontWeight:'bold',
                  color: isTopOfStack ? '#fcd34d' : '#e5e7eb',
                  whiteSpace:'nowrap',
                  overflow:'hidden',
                  textOverflow:'ellipsis'
                }}>
                  {name}
                </div>
                {/* For triggered abilities, show description */}
                {description && (
                  <div style={{ 
                    fontSize:11, 
                    color:'#a78bfa',
                    marginTop:2,
                    fontStyle:'italic',
                    whiteSpace:'nowrap',
                    overflow:'hidden',
                    textOverflow:'ellipsis'
                  }}>
                    {description}
                  </div>
                )}
                <div style={{ 
                  fontSize:11, 
                  color:'#9ca3af',
                  marginTop:2
                }}>
                  {it.controller ? `by ${it.controller}` : ''}
                  {isTopOfStack && ' • Resolving next'}
                </div>
                {/* Display targets if any */}
                {(it.targetDetails && it.targetDetails.length > 0) ? (
                  <div style={{ 
                    fontSize:11, 
                    color:'#f87171',
                    marginTop:4,
                    display:'flex',
                    alignItems:'center',
                    gap:4,
                    flexWrap:'wrap'
                  }}>
                    <span style={{ color:'#9ca3af' }}>→</span>
                    <span style={{ fontWeight:'500' }}>
                      {it.targetDetails.map((t, i) => {
                        const targetCard = t.type === 'permanent' ? findTargetCard(t.id) : undefined;
                        
                        if (t.type === 'player') {
                          // Player target - just show name (like declare attackers)
                          return (
                            <span key={t.id}>
                              {i > 0 && ', '}
                              <span style={{ 
                                color: '#60a5fa',
                                fontWeight:'600'
                              }}>
                                {t.name || t.id}
                              </span>
                            </span>
                          );
                        } else {
                          // Permanent target - add hover preview
                          return (
                            <span 
                              key={t.id}
                              onMouseEnter={(e) => {
                                e.stopPropagation();
                                if (targetCard) {
                                  showCardPreview(e.currentTarget as HTMLElement, targetCard, { prefer:'right', anchorPadding:8 });
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.stopPropagation();
                                if (targetCard) {
                                  hideCardPreview(e.currentTarget as HTMLElement);
                                }
                              }}
                              style={{ cursor: targetCard ? 'pointer' : 'default' }}
                            >
                              {i > 0 && ', '}
                              <span style={{ 
                                color: '#f87171',
                                fontWeight:'600',
                                textDecoration: targetCard ? 'underline dotted' : 'none',
                                textUnderlineOffset: '2px'
                              }}>
                                {t.name || t.id}
                              </span>
                            </span>
                          );
                        }
                      })}
                    </span>
                  </div>
                ) : (it.targets && it.targets.length > 0) ? (
                  <div style={{ 
                    fontSize:11, 
                    color:'#f87171',
                    marginTop:4,
                    display:'flex',
                    alignItems:'center',
                    gap:4
                  }}>
                    <span style={{ color:'#9ca3af' }}>→</span>
                    <span style={{ fontWeight:'500' }}>
                      {it.targets.join(', ')}
                    </span>
                  </div>
                ) : null}
              </div>
              
              {/* Auto-resolve button for triggered abilities */}
              {isTriggeredAbility && onIgnoreTriggerSource && it.controller === you && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onIgnoreTriggerSource(sourceId, sourceName, description || '', imageUrl || undefined);
                  }}
                  title="Auto-resolve all future triggers from this source"
                  style={{
                    padding: '4px 8px',
                    fontSize: 10,
                    borderRadius: 4,
                    border: '1px solid #6366f1',
                    background: 'rgba(99,102,241,0.2)',
                    color: '#a5b4fc',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  🔄 Auto
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Ignored sources panel */}
      {ignoredSources && ignoredSources.size > 0 && (
        <div style={{
          marginTop: 12,
          padding: '8px 10px',
          background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 6,
        }}>
          <div style={{ 
            fontSize: 11, 
            color: '#a5b4fc', 
            marginBottom: 6,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            🔄 Auto-resolving
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Array.from(ignoredSources.entries()).map(([key, data]) => (
              <div 
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '4px 6px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  {data.imageUrl && (
                    <img 
                      src={data.imageUrl} 
                      alt={data.sourceName}
                      style={{ width: 24, height: 34, borderRadius: 2, objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontSize: 11, 
                      color: '#e5e7eb',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {data.sourceName}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>
                      {data.count}× resolved
                    </div>
                  </div>
                </div>
                {onStopIgnoring && (
                  <button
                    onClick={() => onStopIgnoring(key)}
                    title="Stop auto-resolving this source"
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      borderRadius: 3,
                      border: '1px solid #ef4444',
                      background: 'rgba(239,68,68,0.2)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Priority indicator */}
      {priorityPlayer===you && (
        <div style={{ 
          fontSize:12, 
          marginTop:12, 
          padding:'8px 12px',
          background:'rgba(16,185,129,0.2)',
          border:'1px solid rgba(16,185,129,0.4)',
          borderRadius:6,
          color:'#34d399',
          textAlign:'center',
          fontWeight:'500'
        }}>
          ✓ You have priority - Respond or Pass
        </div>
      )}
    </div>
  );
}