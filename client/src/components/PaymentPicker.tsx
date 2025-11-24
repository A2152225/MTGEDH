import React, { useMemo } from 'react';
import type { PaymentItem, ManaColor } from '../../../shared/src';

type Color = ManaColor;

function parseManaCost(manaCost?: string): { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } {
  const res: { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } =
    { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: 0, hybrids: [], hasX: false };
  if (!manaCost) return res;
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '').toUpperCase();
    if (sym === 'X') { res.hasX = true; continue; }
    if (/^\d+$/.test(sym)) { res.generic += parseInt(sym, 10); continue; }
    if (sym.includes('/')) {
      const parts = sym.split('/');
      if (parts.length === 2 && parts[1] === 'P') {
        const c = parts[0] as Color;
        if ((['W','U','B','R','G','C'] as const).includes(c)) res.colors[c] += 1;
        continue;
      }
      if (parts.length === 2 && (['W','U','B','R','G','C'] as const).includes(parts[0] as Color) && (['W','U','B','R','G','C'] as const).includes(parts[1] as Color)) {
        res.hybrids.push([parts[0] as Color, parts[1] as Color]);
        continue;
      }
      // two-brid fallback: treat numeric as generic
      const num = parseInt(parts[0], 10);
      if (!Number.isNaN(num)) { res.generic += num; continue; }
    }
    if ((['W','U','B','R','G','C'] as const).includes(sym as Color)) {
      res.colors[sym as Color] += 1;
      continue;
    }
  }
  return res;
}

function paymentToPool(payment: PaymentItem[]): Record<Color, number> {
  return payment.reduce<Record<Color, number>>((acc, p) => {
    acc[p.mana] = (acc[p.mana] || 0) + 1;
    return acc;
  }, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
}

function canPayEnhanced(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>): boolean {
  const left: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const c of (['W','U','B','R','G','C'] as const)) {
    if (left[c] < cost.colors[c]) return false;
    left[c] -= cost.colors[c];
  }
  for (const group of cost.hybrids) {
    let satisfied = false;
    for (const c of group) {
      if (left[c] > 0) { left[c] -= 1; satisfied = true; break; }
    }
    if (!satisfied) return false;
  }
  const total = (['W','U','B','R','G','C'] as const).reduce((a, c) => a + left[c], 0);
  return total >= cost.generic;
}

function remainingAfter(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>) {
  const leftColors: Record<Color, number> = { ...cost.colors };
  const leftPool: Record<Color, number> = { ...pool };
  // consume fixed colors
  for (const c of (['W','U','B','R','G','C'] as const)) {
    const use = Math.min(leftColors[c], leftPool[c]);
    leftColors[c] -= use;
    leftPool[c] -= use;
  }
  // consume hybrids
  const unsatisfiedHybrids: Color[][] = [];
  for (const g of cost.hybrids) {
    let ok = false;
    for (const c of g) {
      if (leftPool[c] > 0) { leftPool[c] -= 1; ok = true; break; }
    }
    if (!ok) unsatisfiedHybrids.push(g);
  }
  // generic
  const totalPool = (['W','U','B','R','G','C'] as const).reduce((a, c) => a + leftPool[c], 0);
  const leftGeneric = Math.max(0, cost.generic - totalPool);
  return { colors: leftColors, hybrids: unsatisfiedHybrids, generic: leftGeneric };
}

function costBadge(label: string, n: number) {
  if (n <= 0) return null;
  return (
    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', border: '1px solid #ddd', borderRadius: 12, fontSize: 12, background: '#fafafa' }}>
      {label} × {n}
    </span>
  );
}

export function PaymentPicker(props: {
  manaCost?: string;
  manaCostDisplay?: string;
  sources: Array<{ id: string; name: string; options: Color[] }>;
  chosen: PaymentItem[];
  xValue?: number;
  onChangeX?: (x: number) => void;
  onChange: (next: PaymentItem[]) => void;
}) {
  const { manaCost, manaCostDisplay, sources, chosen, xValue = 0, onChangeX, onChange } = props;

  const parsed = useMemo(() => parseManaCost(manaCost), [manaCost]);
  const cost = useMemo(() => ({ colors: parsed.colors, generic: parsed.generic + Math.max(0, Number(xValue || 0) | 0), hybrids: parsed.hybrids }), [parsed, xValue]);
  const pool = useMemo(() => paymentToPool(chosen), [chosen]);
  const satisfied = useMemo(() => canPayEnhanced(cost, pool), [cost, pool]);
  const remaining = useMemo(() => remainingAfter(cost, pool), [cost, pool]);

  const chosenById = useMemo(() => new Set(chosen.map(p => p.permanentId)), [chosen]);

  const add = (permanentId: string, mana: Color) => {
    if (chosenById.has(permanentId)) return; // one per source
    onChange([...chosen, { permanentId, mana }]);
  };
  const remove = (permanentId: string) => {
    onChange(chosen.filter(p => p.permanentId !== permanentId));
  };
  const clear = () => onChange([]);

  const doAutoSelect = () => {
    // client-only hint: prefer manual for hybrids
    alert('For hybrid costs, please select payment manually. Auto-select works for non-hybrid costs.');
  };

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 420 }}>
      {/* Raw cost display */}
      <div style={{ fontSize: 12, opacity: 0.8 }}>Cost: {manaCostDisplay || manaCost || '(none)'}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Cost breakdown:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, parsed.colors[c]))}
        {parsed.hybrids.length > 0 && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Hybrid: {parsed.hybrids.map((g, i) => <span key={i} style={{ border: '1px solid #ddd', borderRadius: 12, padding: '2px 6px', fontSize: 12 }}>{g.join('/')}</span>)}
        </span>}
        {costBadge('Generic', parsed.generic)}
        {parsed.hasX && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            X:
            <input
              type="number"
              min={0}
              value={xValue}
              onChange={e => onChangeX && onChangeX(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 64 }}
              title="Set X value"
            />
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Selected:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, pool[c]))}
        {Object.values(pool).every(v => v === 0) && <span style={{ fontSize: 12, opacity: 0.7 }}>None (leave empty to auto-pay)</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Remaining:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, remaining.colors[c]))}
        {remaining.hybrids.length > 0 && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Hybrid: {remaining.hybrids.map((g, i) => <span key={i} style={{ border: '1px solid #ddd', borderRadius: 12, padding: '2px 6px', fontSize: 12 }}>{g.join('/')}</span>)}
        </span>}
        {costBadge('Generic', remaining.generic)}
        {satisfied && <span style={{ fontSize: 12, color: '#2b6cb0' }}>Cost satisfied</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Sources:</b>
        <button onClick={clear} disabled={chosen.length === 0} title="Clear selected payment">Clear</button>
        <button onClick={doAutoSelect} disabled={sources.length === 0 || parsed.hybrids.length > 0 || satisfied} title="Auto-select (non-hybrid costs)">
          Auto-select
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Tip: leave empty to auto-pay on server</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, maxHeight: 220, overflow: 'auto', paddingRight: 2 }}>
        {sources.map(s => {
          const used = chosenById.has(s.id);
          return (
            <div key={s.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, background: used ? '#f6f6f6' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</div>
                {used ? (
                  <button onClick={() => remove(s.id)} style={{ fontSize: 11 }} title="Remove this payment">Remove</button>
                ) : (
                  <span style={{ fontSize: 11, opacity: 0.7 }}>untapped</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {s.options.map(opt => (
                  <button
                    key={`${s.id}:${opt}`}
                    onClick={() => add(s.id, opt)}
                    disabled={used}
                    style={{ padding: '2px 6px', fontSize: 12, borderRadius: 6, border: '1px solid #ccc' }}
                    title={used ? 'Already used' : `Add ${opt}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {sources.length === 0 && (
          <div style={{ opacity: 0.7, fontSize: 12 }}>No untapped mana sources available</div>
        )}
      </div>
    </div>
  );
}