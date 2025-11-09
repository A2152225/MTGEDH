import React from 'react';
import type { PlayerID, PlayerStatus } from '../../../shared/src';

interface Props {
  playerId: PlayerID;
  status?: PlayerStatus;
  life?: number;
  isYou?: boolean;
  onAdjustLife?: (delta: number) => void;
}

const abilityIconMap: Record<string,string> = {
  flying:'F',
  indestructible:'I',
  vigilance:'V',
  trample:'T',
  hexproof:'H',
  shroud:'S'
};

export function PlayerStatusBar({ playerId, status, life, isYou, onAdjustLife }: Props) {
  const poison = status?.poison ?? 0;
  const exp = status?.experience ?? 0;
  const hexproof = status?.hexproof;
  const shroud = status?.shroud;

  return (
    <div style={{
      display:'flex',
      alignItems:'center',
      gap:10,
      fontSize:12,
      color:'#ddd',
      background:'rgba(0,0,0,0.4)',
      padding:'4px 8px',
      border:'1px solid #333',
      borderRadius:6
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <strong style={{ fontSize:14 }}>{life ?? '--'}</strong>
        {isYou && (
          <span style={{ display:'flex', gap:4 }}>
            <button onClick={()=>onAdjustLife && onAdjustLife(+1)}>+1</button>
            <button onClick={()=>onAdjustLife && onAdjustLife(-1)}>-1</button>
          </span>
        )}
      </div>
      {poison > 0 && <div style={{ color:'#38a169' }}>Poison: {poison}</div>}
      {exp > 0 && <div style={{ color:'#ecc94b' }}>Exp: {exp}</div>}
      {(hexproof || shroud) && (
        <div style={{ display:'flex', gap:4 }}>
          {hexproof && <span title="Hexproof" style={badgeStyle}>H</span>}
          {shroud && <span title="Shroud" style={badgeStyle}>S</span>}
        </div>
      )}
    </div>
  );
}

const badgeStyle:React.CSSProperties={
  background:'rgba(255,255,255,0.15)',
  border:'1px solid #555',
  padding:'2px 4px',
  borderRadius:4,
  fontSize:11,
  lineHeight:'12px'
};