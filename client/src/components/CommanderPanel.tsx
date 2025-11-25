import React, { useMemo, useState } from 'react';
import type { ClientGameView, PlayerID, PaymentItem } from '../../../shared/src';
import { socket } from '../socket';

export function CommanderPanel(props: {
  view: ClientGameView;
  you: PlayerID;
  isYouPlayer: boolean;
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
}) {
  const { view, you, isYouPlayer, onCastCommander } = props;

  const info = useMemo(() => (view.commandZone?.[you] as any) || { commanderNames: [], commanderIds: [], taxById: {}, tax: 0, inCommandZone: [], commanderCards: [] }, [view, you]);
  const [namesInput, setNamesInput] = useState<string>(() => {
    const arr = Array.isArray(info.commanderNames) ? info.commanderNames as string[] : [];
    return arr.join(', ');
  });

  // Track which commanders are currently in the command zone
  const inCommandZone: string[] = useMemo(() => {
    // If inCommandZone is set, use it; otherwise assume all commanders are in CZ
    return Array.isArray(info.inCommandZone) ? info.inCommandZone : (info.commanderIds || []);
  }, [info]);

  const commanderPairs = useMemo(() => {
    const names: string[] = Array.isArray(info.commanderNames) ? info.commanderNames : [];
    const ids: string[] = Array.isArray(info.commanderIds) ? info.commanderIds : [];
    const taxById: Record<string, number> = (info.taxById || {}) as Record<string, number>;
    const cards: any[] = Array.isArray(info.commanderCards) ? info.commanderCards : [];
    const res: Array<{ name: string; id?: string; tax?: number; manaCost?: string; inCZ: boolean }> = [];
    const n = Math.max(names.length, ids.length);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const card = cards.find((c: any) => c?.id === id);
      res.push({ 
        name: names[i] || (id ? id.slice(0, 8) : `Commander ${i + 1}`), 
        id, 
        tax: id ? taxById[id] || 0 : undefined,
        manaCost: card?.mana_cost,
        inCZ: id ? inCommandZone.includes(id) : false,
      });
    }
    return res;
  }, [info, inCommandZone]);

  const totalTax = Number(info.tax || 0) || commanderPairs.reduce((a, p) => a + (p.tax || 0), 0);

  const disabledReason = !isYouPlayer ? 'Only players (not spectators) can change their commander' : undefined;

  const setCommander = () => {
    if (!isYouPlayer) return;
    const parts = namesInput.split(',').map(s => s.trim()).filter(Boolean);
    socket.emit('setCommander', { gameId: view.id, commanderNames: parts });
  };

  const castCommander = (c: { id?: string; name: string; manaCost?: string; tax?: number; inCZ: boolean }) => {
    if (!isYouPlayer) return;
    if (!c.inCZ) return; // Can't cast if not in command zone
    
    if (onCastCommander && c.id) {
      // Use callback to open payment modal
      onCastCommander(c.id, c.name, c.manaCost, c.tax);
    } else {
      // Fallback: emit directly (no payment)
      socket.emit('castCommander', { gameId: view.id, commanderNameOrId: c.id || c.name });
    }
  };

  const moveToCZ = (nameOrId: string) => {
    if (!isYouPlayer) return;
    socket.emit('moveCommanderToCommandZone', { gameId: view.id, commanderNameOrId: nameOrId });
  };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Commander</h3>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Total tax: {totalTax}</div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <label style={{ fontSize: 12, opacity: 0.85 }}>Names (comma-separated for partners)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={namesInput}
            onChange={e => setNamesInput(e.target.value)}
            placeholder="e.g., Atraxa, Voice of Praetors"
            style={{ flex: 1 }}
            disabled={!isYouPlayer}
            title={disabledReason}
          />
          <button onClick={setCommander} disabled={!isYouPlayer} title={disabledReason}>Set</button>
        </div>

        {commanderPairs.length > 0 ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {commanderPairs.map((c, i) => {
              const key = `${c.id || c.name || i}`;
              const canCast = isYouPlayer && c.inCZ;
              const castDisabledReason = !isYouPlayer 
                ? disabledReason 
                : !c.inCZ 
                  ? 'Commander is not in command zone' 
                  : undefined;
              return (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name} 
                    {typeof c.tax === 'number' && c.tax > 0 ? <span style={{ fontSize: 12, opacity: 0.7 }}> (tax {c.tax})</span> : null}
                    {c.manaCost ? <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{c.manaCost}</span> : null}
                    {!c.inCZ && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>(not in CZ)</span>}
                  </div>
                  <button 
                    onClick={() => castCommander(c)} 
                    disabled={!canCast} 
                    title={castDisabledReason}
                    style={{ opacity: canCast ? 1 : 0.5 }}
                  >
                    Cast
                  </button>
                  <button onClick={() => moveToCZ(c.id || c.name)} disabled={!isYouPlayer} title={disabledReason}>Move to CZ</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>No commander set</div>
        )}
      </div>
    </div>
  );
}