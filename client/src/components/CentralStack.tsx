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
  return (
    <div style={{
      position:'absolute',
      left:'50%',
      top:'50%',
      transform:'translate(-50%, -50%)',
      background:'rgba(0,0,0,0.55)',
      border:'1px solid #444',
      borderRadius:8,
      padding:8,
      minWidth:180,
      pointerEvents:'auto',
      zIndex:50
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <strong style={{ fontSize:13 }}>Stack ({stack.length})</strong>
        <button onClick={onPass} disabled={priorityPlayer!==you} style={{ fontSize:11 }}>
          Pass
        </button>
      </div>
      {stack.length === 0 && <div style={{ fontSize:11, opacity:0.7 }}>Empty</div>}
      {stack.slice().reverse().map((it, idx) => {
        const kc = it.card as KnownCardRef | undefined;
        const name = kc?.name || it.id;
        return (
          <div
            key={it.id}
            onMouseEnter={(e)=> kc && showCardPreview(e.currentTarget as HTMLElement, kc, { prefer:'above', anchorPadding:0 })}
            onMouseLeave={(e)=> kc && hideCardPreview(e.currentTarget as HTMLElement)}
            style={{
              fontSize:11,
              padding:'4px 6px',
              border:'1px solid #333',
              borderRadius:4,
              marginBottom:4,
              background:'rgba(30,30,30,0.6)',
              cursor: kc ? 'pointer' : 'default'
            }}
          >
            <span style={{ opacity:0.8 }}>#{stack.length - idx}</span> {name}
          </div>
        );
      })}
      {priorityPlayer===you && stack.length>0 && (
        <div style={{ fontSize:10, marginTop:6, color:'#a0aec0' }}>You have priority.</div>
      )}
    </div>
  );
}