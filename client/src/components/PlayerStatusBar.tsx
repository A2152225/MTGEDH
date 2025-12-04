import React, { useState } from 'react';
import type { PlayerID, PlayerStatus, ManaPool, RestrictedManaEntry } from '../../../shared/src';

// Mana symbol colors for compact display
const MANA_COLORS_MAP: Record<string, { bg: string; text: string }> = {
  white: { bg: '#fffbd5', text: '#8a6d3b' },
  blue: { bg: '#0e68ab', text: '#fff' },
  black: { bg: '#150b00', text: '#c9c5c2' },
  red: { bg: '#d3202a', text: '#fff' },
  green: { bg: '#00733e', text: '#fff' },
  colorless: { bg: '#ccc2c0', text: '#333' },
};

const MANA_SYMBOLS_MAP: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

interface ManaPoolData {
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
  restricted?: RestrictedManaEntry[];
  doesNotEmpty?: boolean;
}

interface Props {
  playerId: PlayerID;
  status?: PlayerStatus;
  life?: number;
  isYou?: boolean;
  onAdjustLife?: (delta: number) => void;
  onAdjustPoison?: (delta: number) => void;
  onAdjustExperience?: (delta: number) => void;
  onAdjustEnergy?: (delta: number) => void;
  /** Current mana pool for this player */
  manaPool?: ManaPoolData;
  /** Callback when player adjusts mana manually */
  onAdjustMana?: (color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless', delta: number) => void;
  /** Callback to roll a die */
  onRollDie?: (sides: number) => void;
  /** Callback to flip a coin */
  onFlipCoin?: () => void;
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
  onAdjustEnergy,
  manaPool,
  onAdjustMana,
  onRollDie,
  onFlipCoin
}: Props) {
  const poison = status?.poison ?? 0;
  const exp = status?.experience ?? 0;
  const energy = status?.energy ?? 0;
  const hexproof = status?.hexproof;
  const shroud = status?.shroud;
  
  // State for showing/hiding dice dropdown
  const [showDiceMenu, setShowDiceMenu] = useState(false);
  
  // Life color based on value
  const lifeColor = (life ?? 40) <= 10 ? '#ef4444' : (life ?? 40) <= 20 ? '#fbbf24' : '#4ade80';
  // Poison warning at 7+
  const poisonCritical = poison >= 7;
  
  // Calculate total mana in pool
  const totalMana = manaPool 
    ? (manaPool.white || 0) + (manaPool.blue || 0) + (manaPool.black || 0) + 
      (manaPool.red || 0) + (manaPool.green || 0) + (manaPool.colorless || 0) +
      (manaPool.restricted?.reduce((sum, r) => sum + r.amount, 0) || 0)
    : 0;

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
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
      flexWrap: 'wrap'
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
      
      {/* Mana Pool - only show if there is mana or if isYou for adjustments */}
      {(totalMana > 0 || isYou) && (
        <>
          <div style={{ width:1, height:20, background:'rgba(255,255,255,0.15)' }} />
          <div 
            style={{ 
              display:'flex', 
              alignItems:'center', 
              gap:4,
              color: totalMana > 0 ? '#f59e0b' : 'rgba(136,136,136,0.6)',
              fontWeight: totalMana > 0 ? 600 : 400
            }}
            title={`Mana Pool${manaPool?.doesNotEmpty ? ' (doesn\'t empty)' : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              🔮 
              {manaPool?.doesNotEmpty && (
                <span style={{ color: '#10b981', fontSize: 10 }} title="Mana doesn't empty">∞</span>
              )}
            </span>
            {/* Show compact mana symbols */}
            <div style={{ display: 'flex', gap: 2 }}>
              {(['white', 'blue', 'black', 'red', 'green', 'colorless'] as const).map(color => {
                const amount = manaPool?.[color] || 0;
                const colors = MANA_COLORS_MAP[color];
                const symbol = MANA_SYMBOLS_MAP[color];
                
                if (amount === 0 && !isYou) return null;
                
                return (
                  <div 
                    key={color}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      padding: '1px 3px',
                      borderRadius: 4,
                      background: amount > 0 ? colors.bg : 'transparent',
                      border: amount > 0 ? `1px solid ${colors.bg}` : '1px solid rgba(255,255,255,0.1)',
                      opacity: amount > 0 ? 1 : 0.4,
                    }}
                    title={`${amount} ${color} mana${isYou ? ' - Click +/- to adjust' : ''}`}
                  >
                    <span style={{ 
                      fontSize: 9, 
                      fontWeight: 700, 
                      color: amount > 0 ? colors.text : '#888',
                      fontFamily: 'monospace',
                    }}>
                      {symbol}
                    </span>
                    <span style={{ 
                      fontSize: 9, 
                      color: amount > 0 ? colors.text : '#888' 
                    }}>
                      {amount}
                    </span>
                    {isYou && onAdjustMana && (
                      <span style={{ display: 'flex', marginLeft: 1 }}>
                        <button 
                          onClick={() => onAdjustMana(color, +1)} 
                          style={{
                            ...manaAdjustBtnStyle,
                            background: colors.bg,
                            color: colors.text,
                          }}
                          title={`Add 1 ${color} mana`}
                        >+</button>
                        <button 
                          onClick={() => onAdjustMana(color, -1)} 
                          disabled={amount === 0}
                          style={{
                            ...manaAdjustBtnStyle,
                            background: amount > 0 ? colors.bg : '#333',
                            color: amount > 0 ? colors.text : '#666',
                            opacity: amount > 0 ? 1 : 0.5,
                          }}
                          title={`Remove 1 ${color} mana`}
                        >−</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Show restricted mana count if any */}
            {manaPool?.restricted && manaPool.restricted.length > 0 && (
              <span 
                style={{ 
                  fontSize: 9, 
                  color: '#a855f7', 
                  marginLeft: 2,
                  padding: '1px 3px',
                  background: 'rgba(168, 85, 247, 0.2)',
                  borderRadius: 3,
                }} 
                title="Restricted mana (can only be spent on specific things)"
              >
                +{manaPool.restricted.reduce((sum, r) => sum + r.amount, 0)}🔒
              </span>
            )}
          </div>
        </>
      )}
      
      {/* Randomness Section - Dice & Coin Flip */}
      {isYou && (onRollDie || onFlipCoin) && (
        <>
          <div style={{ width:1, height:20, background:'rgba(255,255,255,0.15)' }} />
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 4,
              position: 'relative',
            }}
          >
            {/* Dice button with dropdown */}
            {onRollDie && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowDiceMenu(!showDiceMenu)}
                  style={{
                    ...randomnessBtnStyle,
                    background: showDiceMenu ? 'rgba(139, 92, 246, 0.4)' : 'rgba(139, 92, 246, 0.2)',
                  }}
                  title="Roll dice"
                >
                  🎲 Dice
                </button>
                {showDiceMenu && (
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: 4,
                      background: 'rgba(30, 30, 40, 0.98)',
                      border: '1px solid rgba(139, 92, 246, 0.5)',
                      borderRadius: 6,
                      padding: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      zIndex: 1000,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    {[
                      { sides: 6, label: 'D6' },
                      { sides: 20, label: 'D20' },
                      { sides: 100, label: 'D100' },
                    ].map(({ sides, label }) => (
                      <button
                        key={sides}
                        onClick={() => {
                          onRollDie(sides);
                          setShowDiceMenu(false);
                        }}
                        style={diceOptionBtnStyle}
                        title={`Roll a ${sides}-sided die`}
                      >
                        🎲 {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Coin flip button */}
            {onFlipCoin && (
              <button
                onClick={onFlipCoin}
                style={randomnessBtnStyle}
                title="Flip a coin"
              >
                🪙 Flip
              </button>
            )}
          </div>
        </>
      )}
      
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

const manaAdjustBtnStyle: React.CSSProperties = {
  padding: '0px 2px',
  fontSize: 8,
  border: 'none',
  borderRadius: 2,
  cursor: 'pointer',
  lineHeight: '10px',
  minWidth: 12,
};

const randomnessBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  background: 'rgba(139, 92, 246, 0.2)',
  border: '1px solid rgba(139, 92, 246, 0.4)',
  borderRadius: 4,
  color: '#c4b5fd',
  cursor: 'pointer',
  lineHeight: '14px',
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  transition: 'background 0.15s ease',
};

const diceOptionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  background: 'rgba(139, 92, 246, 0.15)',
  border: '1px solid rgba(139, 92, 246, 0.3)',
  borderRadius: 4,
  color: '#c4b5fd',
  cursor: 'pointer',
  lineHeight: '14px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const badgeStyle:React.CSSProperties={
  background:'rgba(255,255,255,0.15)',
  border:'1px solid #555',
  padding:'2px 4px',
  borderRadius:4,
  fontSize:11,
  lineHeight:'12px'
};