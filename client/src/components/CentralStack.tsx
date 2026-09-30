import React, { useState, useCallback, useRef } from 'react';
import type { StackItem, KnownCardRef, PlayerID, BattlefieldPermanent, PlayerRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { openReportIssueMenu } from '../utils/reportIssueStore';

interface Props {
  stack: StackItem[];
  battlefield?: BattlefieldPermanent[];
  players?: PlayerRef[]; // For looking up player names from IDs
  you?: PlayerID;
  priorityPlayer?: PlayerID;
  onPass?: () => void;
  onResolveAll?: () => void; // Batch resolve all triggers with a single pass
  onIgnoreTriggerSource?: (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => void;
  ignoredSources?: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }>;
  onStopIgnoring?: (sourceKey: string) => void;
  /** When true, renders in normal flow (e.g. inside a bottom sheet) instead of floating. */
  embedded?: boolean;
}

export function formatStackTargetControllerLabel(
  controllerId: string | undefined,
  controllerName: string | undefined,
  resolvePlayerName: (playerId: string) => string,
): string | undefined {
  if (controllerName) return controllerName;
  if (!controllerId) return undefined;
  return resolvePlayerName(controllerId) || controllerId;
}

export function CentralStack({ 
  stack, 
  battlefield, 
  players,
  you, 
  priorityPlayer, 
  onPass,
  onResolveAll,
  onIgnoreTriggerSource,
  ignoredSources,
  onStopIgnoring,
  embedded = false,
}: Props) {
  // Position state for dragging
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  
  // Don't render if stack is empty
  if (stack.length === 0) {
    return null;
  }
  
  // Helper to look up player name from ID
  const getPlayerName = (playerId: string | undefined): string => {
    if (!playerId) return '';
    if (!players) return playerId;
    const player = players.find(p => p.id === playerId);
    return player?.name || playerId;
  };
  
  // Helper to find a permanent's card data by ID for hover preview
  const findTargetCard = (targetId: string): KnownCardRef | undefined => {
    // First check battlefield
    if (battlefield) {
      const perm = battlefield.find(p => p.id === targetId);
      if (perm?.card) return perm.card as KnownCardRef;
    }
    // Then check stack (for countering spells targeting other spells)
    const stackItem = stack.find(s => s.id === targetId);
    if (stackItem?.card) return stackItem.card as KnownCardRef;
    return undefined;
  };
  
  // Helper to find target name from either battlefield or stack
  const findPermanentName = (targetId: string): { name: string; controllerName?: string } | undefined => {
    // Check battlefield first
    if (battlefield) {
      const perm = battlefield.find(p => p.id === targetId);
      if (perm) {
        // Try to get name from card or card_faces
        let name = (perm.card as KnownCardRef)?.name;
        if (!name) {
          const faces = (perm.card as any)?.card_faces;
          if (faces && faces[0]?.name) {
            name = faces[0].name;
          }
        }
        if (name) {
          const controllerName = perm.controller ? getPlayerName(perm.controller) : undefined;
          return { name, controllerName };
        }
      }
    }
    
    // Check stack for spell targets (e.g., countering a spell on the stack)
    const stackItem = stack.find(s => s.id === targetId);
    if (stackItem) {
      const kc = stackItem.card as KnownCardRef | undefined;
      const name = kc?.name || (stackItem as any).sourceName;
      if (name) {
        const controllerName = stackItem.controller ? getPlayerName(stackItem.controller) : undefined;
        return { name, controllerName };
      }
    }
    
    return undefined;
  };
  
  // Helper to format target display with controller info
  const formatTargetDisplay = (
    name: string | undefined, 
    controllerId: string | undefined, 
    controllerName: string | undefined,
    targetId: string
  ): string => {
    // If name is missing or looks like a perm_ ID, try to look up from battlefield
    let displayName = name;
    let displayControllerName = controllerName;
    
    if (!displayName || displayName.startsWith('perm_') || displayName.startsWith('stack_')) {
      const lookup = findPermanentName(targetId);
      if (lookup) {
        displayName = lookup.name;
        displayControllerName = displayControllerName || lookup.controllerName;
      }
    }
    
    // If still no name, use a fallback
    if (!displayName) {
      displayName = 'Unknown target';
    }
    
    // Add controller info if available
    if (displayControllerName) {
      return `${displayName} (${displayControllerName}'s)`;
    } else if (controllerId) {
      // Try to look up controller name from players
      const ctrlName = getPlayerName(controllerId);
      if (ctrlName && ctrlName !== controllerId) {
        return `${displayName} (${ctrlName}'s)`;
      }
    }
    
    return displayName;
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
      onMouseDown={embedded ? undefined : handleMouseDown}
      style={{
        position: embedded ? 'relative' : 'absolute',
        left: embedded ? undefined : '50%',
        top: embedded ? undefined : '50%',
        transform: embedded ? undefined : transform,
        width: embedded ? '100%' : undefined,
        background:'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(40,40,60,0.95))',
        border:'2px solid #6366f1',
        borderRadius:12,
        padding:16,
        minWidth: embedded ? undefined : 280,
        maxWidth: embedded ? undefined : 400,
        pointerEvents:'auto',
        zIndex: embedded ? undefined : 100,
        boxShadow: embedded
          ? '0 4px 16px rgba(99,102,241,0.25)'
          : '0 8px 32px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.2)',
        backdropFilter:'blur(8px)',
        cursor: embedded ? 'default' : (isDragging ? 'grabbing' : 'default'),
        userSelect: embedded ? 'auto' : (isDragging ? 'none' : 'auto'),
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
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Resolve All button - only show if multiple items and all are your triggers */}
          {onResolveAll && stack.length > 1 && stack.every(it => 
            (it as any).type === 'triggered_ability' && it.controller === you
          ) && (
            <button 
              onClick={onResolveAll} 
              disabled={priorityPlayer!==you} 
              style={{ 
                fontSize:12,
                padding:'6px 12px',
                borderRadius:6,
                border:'none',
                background: priorityPlayer===you ? 'linear-gradient(90deg, #8b5cf6, #6366f1)' : '#374151',
                color: priorityPlayer===you ? 'white' : '#9ca3af',
                cursor: priorityPlayer===you ? 'pointer' : 'not-allowed',
                fontWeight:'bold',
                transition:'all 0.2s'
              }}
              title="Resolve all your triggers without pausing for priority"
            >
              ⚡ Resolve All ({stack.length})
            </button>
          )}
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
          const rawTargetDetails = Array.isArray(it.targetDetails) && it.targetDetails.length > 0
            ? it.targetDetails
            : (Array.isArray(it.targets) ? it.targets : []).map((rawTarget: any) => {
                const targetId = String(typeof rawTarget === 'string' ? rawTarget : rawTarget?.id || '');
                const targetPlayer = players?.find((player) => String(player.id) === targetId);
                if (targetPlayer) {
                  return { id: targetId, type: 'player' as const, name: targetPlayer.name || targetId };
                }
                const targetStackItem = stack.find((entry) => String(entry.id) === targetId);
                if (targetStackItem) {
                  const ability = targetStackItem.type === 'ability' || targetStackItem.type === 'triggered_ability';
                  return {
                    id: targetId,
                    type: ability ? 'ability' as const : 'spell' as const,
                    name: targetStackItem.card?.name || targetStackItem.sourceName || targetId,
                    controllerId: targetStackItem.controller,
                    controllerName: getPlayerName(targetStackItem.controller),
                  };
                }
                const permanent = battlefield?.find((entry) => String(entry.id) === targetId);
                return {
                  id: targetId,
                  type: 'permanent' as const,
                  name: permanent?.card?.name || (typeof rawTarget === 'object' ? rawTarget?.name : undefined),
                  controllerId: permanent?.controller || (typeof rawTarget === 'object' ? rawTarget?.controllerId || rawTarget?.controller : undefined),
                  controllerName: permanent?.controller ? getPlayerName(permanent.controller) : rawTarget?.controllerName,
                };
              });
          const targetDisplayDetails = rawTargetDetails.map((target: any) => {
            if (target.type !== 'permanent') return target;
            const currentPermanent = battlefield?.find((entry) => String(entry.id) === String(target.id));
            const controllerId = currentPermanent?.controller || target.controllerId;
            return {
              ...target,
              name: currentPermanent?.card?.name || target.name,
              controllerId,
              controllerName: formatStackTargetControllerLabel(controllerId, undefined, getPlayerName),
            };
          });
          
          return (
            <div
              key={it.id}
              onContextMenu={(e) => {
                e.preventDefault();
                openReportIssueMenu({ cardId: String(kc?.id || it.id), cardName: String(name), zone: 'stack' }, e.clientX, e.clientY);
              }}
              onMouseEnter={(e)=> kc && showCardPreview(e.currentTarget as HTMLElement, kc, { prefer:'right', anchorPadding:8 })}
              onMouseLeave={(e)=> kc && hideCardPreview(e.currentTarget as HTMLElement)}
              title={description}
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
                  display:'flex',
                  alignItems:'center',
                  gap:6,
                  minWidth:0
                }}>
                  <span style={{
                    whiteSpace:'nowrap',
                    overflow:'hidden',
                    textOverflow:'ellipsis'
                  }}>{name}</span>
                  {description && (
                    <span 
                      style={{
                        fontSize:10,
                        padding:'2px 6px',
                        borderRadius:4,
                        background:'#8b5cf6',
                        color:'white',
                        fontWeight:'bold',
                        flexShrink:0,
                        cursor:'help',
                        fontFamily:'monospace'
                      }}
                      title={description}
                    >
                      i
                    </span>
                  )}
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
                  {it.controller ? `by ${getPlayerName(it.controller)}` : ''}
                  {isTopOfStack && ' • Resolving next'}
                </div>
                {/* Display targets if any */}
                {targetDisplayDetails.length > 0 ? (
                  <div style={{ 
                    fontSize:11, 
                    color:'#f87171',
                    marginTop:4,
                    display:'flex',
                    alignItems:'flex-start',
                    gap:4,
                    flexWrap:'wrap'
                  }}>
                    <span style={{ color:'#9ca3af', fontWeight: 600 }}>Targeting</span>
                    <span style={{ color:'#9ca3af' }}>→</span>
                    <span style={{ fontWeight:'500', display:'flex', flexWrap:'wrap', gap:4 }}>
                      {targetDisplayDetails.map((t: any) => {
                        const targetCard = (t.type === 'permanent' || t.type === 'spell' || t.type === 'ability')
                          ? findTargetCard(t.id)
                          : undefined;
                        // Access extended target info properties
                        const extendedTarget = t as { id: string; type: string; name?: string; controllerId?: string; controllerName?: string };
                        
                        if (t.type === 'player') {
                          // Player target - just show name (like declare attackers)
                          return (
                            <span key={t.id} style={{ padding:'2px 6px', borderRadius:4, background:'rgba(96,165,250,0.14)' }}>
                              <span style={{ 
                                color: '#60a5fa',
                                fontWeight:'600'
                              }}>
                                {t.name || t.id}
                              </span>
                            </span>
                          );
                        } else if (t.type === 'spell' || t.type === 'ability') {
                          const displayText = formatTargetDisplay(
                            extendedTarget.name,
                            undefined,
                            undefined,
                            t.id
                          );
                          const kindLabel = t.type === 'ability' ? 'ability' : 'spell';
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
                              <span style={{
                                color: '#fbbf24',
                                fontWeight:'600',
                                textDecoration: targetCard ? 'underline dotted' : 'none',
                                textUnderlineOffset: '2px'
                              }}>
                                {displayText}
                              </span>
                              <span style={{ color: '#9ca3af', marginLeft: 4 }}>
                                — controlled by {formatStackTargetControllerLabel(extendedTarget.controllerId, extendedTarget.controllerName, getPlayerName) || 'unknown'}
                                {' '}({kindLabel})
                              </span>
                            </span>
                          );
                        } else {
                          // Permanent target - format with controller info and add hover preview
                          const displayText = formatTargetDisplay(extendedTarget.name, undefined, undefined, t.id);
                          const controllerLabel = formatStackTargetControllerLabel(
                            extendedTarget.controllerId,
                            extendedTarget.controllerName,
                            getPlayerName,
                          );
                          const targetsYou = Boolean(you && extendedTarget.controllerId === you);
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
                              style={{
                                cursor: targetCard ? 'pointer' : 'default',
                                padding:'2px 6px',
                                borderRadius:4,
                                background: targetsYou ? 'rgba(239,68,68,0.22)' : 'rgba(248,113,113,0.10)',
                                border: targetsYou ? '1px solid rgba(248,113,113,0.55)' : '1px solid rgba(248,113,113,0.18)',
                              }}
                            >
                              <span style={{ 
                                color: '#f87171',
                                fontWeight:'600',
                                textDecoration: targetCard ? 'underline dotted' : 'none',
                                textUnderlineOffset: '2px'
                              }}>
                                {displayText}
                              </span>
                              <span style={{ color: targetsYou ? '#fecaca' : '#cbd5e1', marginLeft:4 }}>
                                — controlled by {controllerLabel || 'unknown'}
                              </span>
                            </span>
                          );
                        }
                      })}
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