import React from 'react';
import type { PlayerID, PlayerStatus } from '../../../shared/src';

interface Props {
  playerId: PlayerID;
  status?: PlayerStatus;
  life?: number;
  isYou?: boolean;
  onAdjustLife?: (delta: number) => void;
  onAdjustPoison?: (delta: number) => void;
  onAdjustExperience?: (delta: number) => void;
  onAdjustEnergy?: (delta: number) => void;
}

const abilityIconMap: Record<string,string> = {
  flying:'F',
  indestructible:'I',
  vigilance:'V',
  trample:'T',
  hexproof:'H',
  shroud:'S'
};

export function PlayerStatusBar({ 
  playerId, 
  status, 
  life, 
  isYou, 
  onAdjustLife,
  onAdjustPoison,
  onAdjustExperience,
  onAdjustEnergy
}: Props) {
  const poison = status?.poison ?? 0;
  const exp = status?.experience ?? 0;
  const energy = status?.energy ?? 0;
  const hexproof = status?.hexproof;
  const shroud = status?.shroud;
  
  // Life color based on value
  const lifeColor = (life ?? 40) <= 10 ? '#ef4444' : (life ?? 40) <= 20 ? '#fbbf24' : '#4ade80';
  // Poison warning at 7+
  const poisonCritical = poison >= 7;

  return (
    <div style={{
      display:'flex',
      alignItems:'center',
      gap:12,
      fontSize:12,
      color:'#ddd',
      background:'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,30,0.6) 100%)',
      padding:'6px 12px',
      border:'1px solid rgba(255,255,255,0.12)',
      borderRadius:8,
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)'
    }}>
      {/* Life Counter */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span 
          style={{ 
            fontSize:16, 
            fontWeight:700, 
            color: lifeColor,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
          }}
          title="Life Total"
        >
          ❤️ {life ?? '--'}
        </span>
        {isYou && (
          <span style={{ display:'flex', gap:3 }}>
            <button 
              onClick={()=>onAdjustLife && onAdjustLife(+1)}
              style={counterBtnStyle}
              title="Gain 1 life"
            >+</button>
            <button 
              onClick={()=>onAdjustLife && onAdjustLife(-1)}
              style={counterBtnStyle}
              title="Lose 1 life"
            >−</button>
          </span>
        )}
      </div>
      
      {/* Separator */}
      <div style={{ width:1, height:20, background:'rgba(255,255,255,0.15)' }} />
      
      {/* Poison Counter */}
      <div 
        style={{ 
          display:'flex', 
          alignItems:'center', 
          gap:6,
          color: poisonCritical ? '#dc2626' : poison > 0 ? '#f87171' : 'rgba(136,136,136,0.6)',
          fontWeight: poison > 0 ? 600 : 400
        }}
        title={`Poison Counters (${poison}/10 - Lose at 10)`}
      >
        <span>☠️ {poison}</span>
        {poisonCritical && <span style={{ fontSize:10, animation:'pulse 1.5s infinite' }}>⚠</span>}
        {isYou && onAdjustPoison && (
          <span style={{ display:'flex', gap:3 }}>
            <button onClick={()=>onAdjustPoison(+1)} style={counterBtnStyleSmall} title="Add poison">+</button>
            <button onClick={()=>onAdjustPoison(-1)} style={counterBtnStyleSmall} title="Remove poison">−</button>
          </span>
        )}
      </div>
      
      {/* Experience Counter */}
      <div 
        style={{ 
          display:'flex', 
          alignItems:'center', 
          gap:6,
          color: exp > 0 ? '#60a5fa' : 'rgba(136,136,136,0.6)',
          fontWeight: exp > 0 ? 600 : 400
        }}
        title="Experience Counters"
      >
        <span>⭐ {exp}</span>
        {isYou && onAdjustExperience && (
          <span style={{ display:'flex', gap:3 }}>
            <button onClick={()=>onAdjustExperience(+1)} style={counterBtnStyleSmall} title="Gain experience">+</button>
            <button onClick={()=>onAdjustExperience(-1)} style={counterBtnStyleSmall} title="Lose experience">−</button>
          </span>
        )}
      </div>
      
      {/* Energy Counter */}
      <div 
        style={{ 
          display:'flex', 
          alignItems:'center', 
          gap:6,
          color: energy > 0 ? '#fbbf24' : 'rgba(136,136,136,0.6)',
          fontWeight: energy > 0 ? 600 : 400
        }}
        title="Energy Counters (Resource to spend)"
      >
        <span>⚡ {energy}</span>
        {isYou && onAdjustEnergy && (
          <span style={{ display:'flex', gap:3 }}>
            <button onClick={()=>onAdjustEnergy(+1)} style={counterBtnStyleSmall} title="Gain energy">+</button>
            <button onClick={()=>onAdjustEnergy(-1)} style={counterBtnStyleSmall} title="Pay/lose energy">−</button>
          </span>
        )}
      </div>
      
      {/* Player protection badges */}
      {(hexproof || shroud) && (
        <div style={{ display:'flex', gap:4, marginLeft:4 }}>
          {hexproof && <span title="Hexproof - Can't be targeted by opponents" style={badgeStyle}>H</span>}
          {shroud && <span title="Shroud - Can't be targeted" style={badgeStyle}>S</span>}
        </div>
      )}
    </div>
  );
}

const counterBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 12,
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 4,
  color: '#ddd',
  cursor: 'pointer',
  lineHeight: '14px'
};

const counterBtnStyleSmall: React.CSSProperties = {
  padding: '1px 4px',
  fontSize: 10,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 3,
  color: '#aaa',
  cursor: 'pointer',
  lineHeight: '12px'
};

const badgeStyle:React.CSSProperties={
  background:'rgba(255,255,255,0.15)',
  border:'1px solid #555',
  padding:'2px 4px',
  borderRadius:4,
  fontSize:11,
  lineHeight:'12px'
};