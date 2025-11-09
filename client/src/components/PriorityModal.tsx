import React from 'react';

interface Props {
  open: boolean;
  onTake: () => void;
  onPass: () => void;
  suppressChecked: boolean;
  onToggleSuppress: (v: boolean) => void;
}

export function PriorityModal({ open, onTake, onPass, suppressChecked, onToggleSuppress }: Props) {
  if (!open) return null;
  return (
    <div style={backdrop}>
      <div style={modal}>
        <h4 style={{ margin:'0 0 8px', fontSize:14 }}>Priority</h4>
        <p style={{ fontSize:12, margin:'0 0 10px' }}>You have priority. Take an action or pass.</p>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onTake}>Take Action</button>
          <button onClick={onPass}>Pass</button>
        </div>
        <label style={{ marginTop:10, display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
          <input
            type="checkbox"
            checked={suppressChecked}
            onChange={e=>onToggleSuppress(e.target.checked)}
          /> Don’t show again this turn
        </label>
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
  padding:'12px 16px',
  width:260,
  boxShadow:'0 4px 16px rgba(0,0,0,0.6)',
  color:'#eee'
};