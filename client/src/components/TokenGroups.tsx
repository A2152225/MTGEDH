import React, { useMemo, useState } from 'react';
import type { BattlefieldPermanent } from '../../../shared/src';

function sigCounters(c?: Readonly<Record<string, number>>) {
  const entries = Object.entries(c || {}).filter(([, v]) => (v || 0) > 0).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v}`).join('|');
}
function sigPT(p?: number, t?: number) {
  return (p ?? '-') + '/' + (t ?? '-');
}

type GroupMode = 'name' | 'name+counters' | 'name+pt+attach' | 'name+counters+pt+attach';

export function TokenGroups(props: {
  tokens: BattlefieldPermanent[];
  groupMode: GroupMode;
  attachedToSet?: Set<string>;
  onBulkCounter: (ids: string[], deltas: Record<string, number>) => void;
  // Targeting support for tokens
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onTokenClick?: (id: string) => void;
}) {
  const { tokens, groupMode, attachedToSet, onBulkCounter, highlightTargets, selectedTargets, onTokenClick } = props;
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; countersSig: string; ptSig: string; attached: boolean; ids: string[] }>();
    for (const t of tokens) {
      const name = ((t.card as any)?.name as string) || 'Token';
      const countersSig = sigCounters(t.counters);
      const pt = sigPT(t.basePower, t.baseToughness);
      const attached = attachedToSet?.has(t.id) ?? false;

      let key = name;
      if (groupMode.includes('pt')) key += `|pt:${pt}`;
      if (groupMode.includes('counters')) key += `|c:${countersSig}`;
      if (groupMode.includes('attach')) key += `|attach:${attached ? 'y' : 'n'}`;

      const g = map.get(key) || { key, name, countersSig, ptSig: pt, attached, ids: [] };
      g.ids.push(t.id);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [tokens, groupMode, attachedToSet]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
      {groups.map(g => {
        const oneId = g.ids.length === 1 ? g.ids[0] : null;
        const canQuickTarget = !!oneId && (highlightTargets?.has(oneId!) ?? false);
        const isSelected = !!oneId && (selectedTargets?.has(oneId!) ?? false);

        return (
          <div key={g.key} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, background: '#111', color: '#eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {g.ptSig !== '-/-' ? g.ptSig : ''} {g.countersSig ? ` • ${g.countersSig}` : ''} {g.attached ? ' • attached' : ''}
                </div>
              </div>
              <div style={{ fontWeight: 700 }}>{g.ids.length}×</div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={() => onBulkCounter(g.ids, { '+1/+1': +1 })}>All +1/+1</button>
              <button onClick={() => onBulkCounter(g.ids, { '+1/+1': -1 })}>All -1/+1</button>
              <button onClick={() => onBulkCounter(g.ids, { '-1/-1': +1 })}>All -1/-1</button>
              <button onClick={() => onBulkCounter(g.ids, { '-1/-1': -1 })}>All +1/-1</button>
              <button onClick={() => setExpanded(expanded === g.key ? null : g.key)}>{expanded === g.key ? 'Hide' : 'Show'} list</button>
              {oneId && onTokenClick && (
                <button
                  onClick={() => onTokenClick(oneId)}
                  disabled={!canQuickTarget}
                  style={{
                    border: '1px solid',
                    borderColor: isSelected ? '#2b6cb0' : canQuickTarget ? '#38a169' : '#444',
                    color: isSelected ? '#2b6cb0' : canQuickTarget ? '#38a169' : '#888',
                    background: 'transparent'
                  }}
                  title={canQuickTarget ? 'Target this token' : 'Not a valid target'}
                >
                  {isSelected ? 'Selected' : 'Target'}
                </button>
              )}
            </div>
            {expanded === g.key && (
              <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', borderTop: '1px solid #333', paddingTop: 8 }}>
                {g.ids.map(id => {
                  const hl = highlightTargets?.has(id) ?? false;
                  const sel = selectedTargets?.has(id) ?? false;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                        border: '1px solid',
                        borderColor: sel ? '#2b6cb0' : hl ? '#38a169' : '#333',
                        padding: 6,
                        borderRadius: 6,
                        marginBottom: 6
                      }}
                    >
                      <span>{id.slice(0, 8)}…</span>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => onBulkCounter([id], { '+1/+1': +1 })}>+1</button>
                        <button onClick={() => onBulkCounter([id], { '+1/+1': -1 })}>-1</button>
                        <button onClick={() => onBulkCounter([id], { '-1/-1': +1 })}>-1/-1 +1</button>
                        <button onClick={() => onBulkCounter([id], { '-1/-1': -1 })}>-1/-1 -1</button>
                        {onTokenClick && (
                          <button
                            onClick={() => onTokenClick(id)}
                            disabled={!hl}
                            style={{
                              border: '1px solid',
                              borderColor: sel ? '#2b6cb0' : hl ? '#38a169' : '#444',
                              color: sel ? '#2b6cb0' : hl ? '#38a169' : '#888',
                              background: 'transparent'
                            }}
                            title={hl ? 'Target this token' : 'Not a valid target'}
                          >
                            {sel ? 'Selected' : 'Target'}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}