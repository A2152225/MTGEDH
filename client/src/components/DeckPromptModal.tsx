import React, { useState } from 'react';

interface Props {
  open: boolean;
  onImport: (list: string, cacheCards?: boolean) => void;
  onSpectate: () => void;
}

export function DeckPromptModal({ open, onImport, onSpectate }: Props) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [cacheCards, setCacheCards] = useState(true);

  if (!open) return null;
  return (
    <div style={backdrop}>
      <div style={modal}>
        <h4 style={{ margin:'0 0 8px', fontSize:14 }}>Import Deck or Spectate</h4>
        <p style={{ fontSize:12, margin:'0 0 10px' }}>Provide a plain text decklist (e.g. "4 Lightning Bolt").</p>
        <textarea
          value={text}
          onChange={e=>setText(e.target.value)}
          placeholder="Paste decklist here"
          style={{ width:'100%', height:120, resize:'vertical', fontSize:11 }}
        />
        <div style={{ display:'flex', gap:8, marginTop:8 }}>
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={e=>{
              const file=e.target.files?.[0];
              if(!file){ setFileError('No file'); return; }
              if(file.size>200_000){ setFileError('File too large'); return; }
              file.text().then(content=>{
                setText(content);
                setFileError(null);
              }).catch(()=> setFileError('Read error'));
            }}
          />
          {fileError && <div style={{ color:'#f87171', fontSize:11 }}>{fileError}</div>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
          <input
            id="cache-cards-prompt"
            type="checkbox"
            checked={cacheCards}
            onChange={e => setCacheCards(e.target.checked)}
          />
          <label htmlFor="cache-cards-prompt" style={{ fontSize:12, color:'#ddd' }}>
            Cache card data (faster loading next time)
          </label>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <button disabled={!text.trim()} onClick={()=>onImport(text, cacheCards)}>Import Deck</button>
          <button onClick={onSpectate}>Spectate</button>
        </div>
      </div>
    </div>
  );
}
const backdrop:React.CSSProperties={
  position:'fixed', inset:0,
  background:'rgba(0,0,0,0.45)',
  display:'flex', alignItems:'center', justifyContent:'center',
  zIndex:120
};
const modal:React.CSSProperties={
  background:'#202225',
  border:'1px solid #444',
  borderRadius:8,
  padding:'14px 16px',
  width:360,
  boxShadow:'0 4px 18px rgba(0,0,0,0.65)',
  color:'#eee'
};