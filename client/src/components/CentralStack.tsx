import React from 'react';
import type { StackItem, KnownCardRef, PlayerID } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

interface Props {
  stack: StackItem[];
  you?: PlayerID;
  priorityPlayer?: PlayerID;
  onPass?: () => void;
}

export function CentralStack({ stack, you, priorityPlayer, onPass }: Props) {
  // Don't render if stack is empty
  if (stack.length === 0) {
    return null;
  }

  return (
    <div style={{
      position:'absolute',
      left:'50%',
      top:'50%',
      transform:'translate(-50%, -50%)',
      background:'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(40,40,60,0.95))',
      border:'2px solid #6366f1',
      borderRadius:12,
      padding:16,
      minWidth:280,
      maxWidth:400,
      pointerEvents:'auto',
      zIndex:100,
      boxShadow:'0 8px 32px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.2)',
      backdropFilter:'blur(8px)'
    }}>
      {/* Header */}
      <div style={{ 
        display:'flex', 
        justifyContent:'space-between', 
        alignItems:'center', 
        marginBottom:12,
        paddingBottom:8,
        borderBottom:'1px solid rgba(99,102,241,0.3)'
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ 
            fontSize:20, 
            fontWeight:'bold',
            background:'linear-gradient(90deg, #818cf8, #c084fc)',
            WebkitBackgroundClip:'text',
            WebkitTextFillColor:'transparent'
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
          const name = kc?.name || it.id;
          const imageUrl = kc?.image_uris?.small || kc?.image_uris?.normal || null;
          const isTopOfStack = idx === 0;
          
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
                <div style={{ 
                  fontSize:11, 
                  color:'#9ca3af',
                  marginTop:2
                }}>
                  {it.controller ? `by ${it.controller}` : ''}
                  {isTopOfStack && ' • Resolving next'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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