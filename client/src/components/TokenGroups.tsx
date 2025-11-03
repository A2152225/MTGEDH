import React, { useMemo, useState } from 'react';
import type { BattlefieldPermanent } from '../../../shared/src';

function stringifyCounters(c?: Readonly<Record<string, number>>) {
  const entries = Object.entries(c || {}).filter(([, v]) => (v || 0) > 0).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v}`).join('|');
}

type GroupMode = 'name' | 'name+counters';

export function TokenGroups(props: {
  tokens: BattlefieldPermanent[];
  groupMode: GroupMode;
  onBulkCounter: (ids: string[], deltas: Record<string, number>) => void;
}) {
  const { tokens, groupMode, onBulkCounter } = props;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; countersSig: string; ids: string[] }>();
    for (const t of tokens) {
      const name = ((t.card as any)?.name as string) || 'Token';
      const countersSig = stringifyCounters(t.counters);
      const key = groupMode === 'name' ? name : `${name}::${countersSig}`;
      const g = map.get(key) || { key, name, countersSig, ids: [] };
      g.ids.push(t.id);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [tokens, groupMode]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
      {groups.map(g => (
        <div key={g.key} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, background: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{g.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{g.countersSig || 'no counters'}</div>
            </div>
            <div style={{ fontWeight: 700 }}>{g.ids.length}×</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onBulkCounter(g.ids, { '+1/+1': +1 })}>All +1/+1</button>
            <button onClick={() => onBulkCounter(g.ids, { '+1/+1': -1 })}>All -1/+1</button>
            <button onClick={() => onBulkCounter(g.ids, { '-1/-1': +1 })}>All -1/-1</button>
            <button onClick={() => onBulkCounter(g.ids, { '-1/-1': -1 })}>All +1/-1</button>
            <button onClick={() => setExpandedKey(expandedKey === g.key ? null : g.key)}>{expandedKey === g.key ? 'Hide' : 'Show'} list</button>
          </div>
          {expandedKey === g.key && (
            <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto', borderTop: '1px solid #eee', paddingTop: 8 }}>
              {g.ids.map(id => (
                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <span>{id.slice(0, 8)}…</span>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button onClick={() => onBulkCounter([id], { '+1/+1': +1 })}>+1</button>
                    <button onClick={() => onBulkCounter([id], { '+1/+1': -1 })}>-1</button>
                    <button onClick={() => onBulkCounter([id], { '-1/-1': +1 })}>-1/-1 +1</button>
                    <button onClick={() => onBulkCounter([id], { '-1/-1': -1 })}>-1/-1 -1</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}