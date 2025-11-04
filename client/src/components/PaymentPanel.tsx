import React from 'react';

type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
const COLORS: Color[] = ['W','U','B','R','G','C'];

export type PaymentSource = { id: string; name: string; options: Color[] };
export type PaymentItem = { permanentId: string; mana: Color };

function parseManaCost(manaCost?: string): { colors: Record<Color, number>; generic: number } {
  const res: { colors: Record<Color, number>; generic: number } = { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: 0 };
  if (!manaCost) return res;
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '');
    if (/^\d+$/.test(sym)) { res.generic += parseInt(sym, 10); continue; }
    if ((COLORS as readonly string[]).includes(sym)) res.colors[sym as Color] += 1;
  }
  return res;
}

export function PaymentPanel(props: {
  manaCost?: string;
  sources: PaymentSource[];
  chosen: PaymentItem[];
  onChoose: (item: PaymentItem) => void;
  onUnchoose: (index: number) => void;
}) {
  const { manaCost, sources, chosen, onChoose, onUnchoose } = props;
  const cost = parseManaCost(manaCost);
  const pool = chosen.reduce<Record<Color, number>>((acc, it) => { acc[it.mana] = (acc[it.mana] || 0) + 1; return acc; }, { W:0,U:0,B:0,R:0,G:0,C:0 });

  const remaining: { colors: Record<Color, number>; generic: number } = {
    colors: { ...cost.colors },
    generic: cost.generic
  };
  for (const c of COLORS) {
    const pay = Math.min(remaining.colors[c], pool[c] || 0);
    remaining.colors[c] -= pay;
  }
  const leftoverPool = COLORS.reduce((a, c) => a + Math.max(0, (pool[c] || 0) - (cost.colors[c] - remaining.colors[c])), 0);
  const genericRem = Math.max(0, remaining.generic - leftoverPool);

  return (
    <div style={{ borderTop: '1px dashed #ccc', paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>Cost: {manaCost || '—'}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Remaining: W:{remaining.colors.W} U:{remaining.colors.U} B:{remaining.colors.B} R:{remaining.colors.R} G:{remaining.colors.G} C:{remaining.colors.C} gen:{genericRem}
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
        {sources.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: '1px solid #eee', borderRadius: 6, padding: '4px 8px' }}>
            <div style={{ minWidth: 0 }}>{s.name}</div>
            <div style={{ display: 'inline-flex', gap: 6 }}>
              {s.options.map(o => (
                <button key={`${s.id}-${o}`} onClick={() => onChoose({ permanentId: s.id, mana: o })}>{o}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Chosen payment:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {chosen.map((c, i) => (
            <span key={`${c.permanentId}-${i}`} style={{ border: '1px solid #ccc', borderRadius: 6, padding: '2px 6px' }}>
              {c.mana} from {c.permanentId.slice(0,6)} <button onClick={() => onUnchoose(i)} style={{ marginLeft: 6 }}>✕</button>
            </span>
          ))}
          {chosen.length === 0 && <span style={{ opacity: 0.6 }}>None</span>}
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
        Tip: select colored mana first; generic can be paid by any remaining source.
      </div>
    </div>
  );
}