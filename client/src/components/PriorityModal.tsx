import React from 'react';

interface Props {
  open: boolean;
  step?: string;
  phase?: string;
  onTake: () => void;
  onPass: () => void;
  autoPassSteps: Set<string>;
  onToggleAutoPass: (step: string, enabled: boolean) => void;
}

/**
 * Get a human-readable name for a step
 */
function getStepDisplayName(step: string): string {
  const stepNames: Record<string, string> = {
    'untap': 'Untap Step',
    'upkeep': 'Upkeep Step',
    'draw': 'Draw Step',
    'main1': 'First Main Phase',
    'main': 'Main Phase',
    'begincombat': 'Beginning of Combat',
    'begin_combat': 'Beginning of Combat',
    'declareattackers': 'Declare Attackers',
    'declare_attackers': 'Declare Attackers',
    'declareblockers': 'Declare Blockers',
    'declare_blockers': 'Declare Blockers',
    'damage': 'Combat Damage',
    'combat_damage': 'Combat Damage',
    'endcombat': 'End of Combat',
    'end_combat': 'End of Combat',
    'main2': 'Second Main Phase',
    'postcombat_main': 'Second Main Phase',
    'end': 'End Step',
    'end_step': 'End Step',
    'cleanup': 'Cleanup Step',
  };
  return stepNames[step.toLowerCase()] || step;
}

export function PriorityModal({ open, step, phase, onTake, onPass, autoPassSteps, onToggleAutoPass }: Props) {
  if (!open) return null;
  
  const stepKey = step?.toLowerCase() || '';
  const displayStep = getStepDisplayName(stepKey);
  const isAutoPassEnabled = autoPassSteps.has(stepKey);
  
  return (
    <div style={backdrop}>
      <div style={modal}>
        <h4 style={{ margin:'0 0 8px', fontSize:14 }}>⚡ Priority - {displayStep}</h4>
        <p style={{ fontSize:12, margin:'0 0 10px', color: '#aaa' }}>
          You have priority. Cast instants, activate abilities, or pass.
        </p>
        <div style={{ display:'flex', gap:8, marginBottom: 12 }}>
          <button 
            onClick={onTake}
            style={{
              padding: '8px 16px',
              background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
              border: 'none',
              borderRadius: 4,
              color: 'white',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Take Action
          </button>
          <button 
            onClick={onPass}
            style={{
              padding: '8px 16px',
              background: 'linear-gradient(90deg, #10b981, #059669)',
              border: 'none',
              borderRadius: 4,
              color: 'white',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Pass Priority
          </button>
        </div>
        <div style={{ 
          borderTop: '1px solid #333', 
          paddingTop: 10,
          marginTop: 4,
        }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color: '#aaa', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isAutoPassEnabled}
              onChange={e => onToggleAutoPass(stepKey, e.target.checked)}
              style={{ cursor: 'pointer' }}
            /> 
            Auto-pass priority during {displayStep}
          </label>
          <p style={{ fontSize: 10, color: '#666', margin: '4px 0 0 20px' }}>
            You can manage auto-pass settings in the settings panel
          </p>
        </div>
      </div>
    </div>
  );
}

const backdrop:React.CSSProperties={
  position:'fixed', left:0, top:0, right:0, bottom:0,
  background:'rgba(0,0,0,0.4)',
  display:'flex', alignItems:'center', justifyContent:'center',
  zIndex:100
};

const modal:React.CSSProperties={
  background:'#1d1f21',
  border:'1px solid #444',
  borderRadius:8,
  padding:'16px 20px',
  width:300,
  boxShadow:'0 4px 16px rgba(0,0,0,0.6)',
  color:'#eee'
};
