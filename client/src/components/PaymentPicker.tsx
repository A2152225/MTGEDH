import React, { useMemo } from 'react';
import type { PaymentItem } from '../../../shared/src';

type Color = PaymentItem['mana'];

function parseManaCost(manaCost?: string): { colors: Record<Color, number>; generic: number } {
  const res: { colors: Record<Color, number>; generic: number } = { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: 0 };
  if (!manaCost) return res;
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '');
    if (/^\d+$/.test(sym)) { res.generic += parseInt(sym, 10); continue; }
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

function canPay(cost: { colors: Record<Color, number>; generic: number }, pool: Record<Color, number>): boolean {
  const left: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const c of (['W','U','B','R','G','C'] as const)) {
    if (left[c] < cost.colors[c]) return false;
    left[c] -= cost.colors[c];
  }
  const total = (['W','U','B','R','G','C'] as const).reduce((a, c) => a + left[c], 0);
  return total >= cost.generic;
}

function remainingCost(cost: { colors: Record<Color, number>; generic: number }, pool: Record<Color, number>) {
  const leftColors: Record<Color, number> = { ...cost.colors };
  const poolCopy: Record<Color, number> = { ...pool };
  // subtract colored
  for (const c of (['W','U','B','R','G','C'] as const)) {
    const use = Math.min(leftColors[c], poolCopy[c]);
    leftColors[c] -= use;
    poolCopy[c] -= use;
  }
  // now generic
  const totalPool = (['W','U','B','R','G','C'] as const).reduce((a, c) => a + poolCopy[c], 0);
  const leftGeneric = Math.max(0, cost.generic - totalPool);
  return { colors: leftColors, generic: leftGeneric };
}

// Client-side greedy auto-select to mirror server fallback:
// - satisfy colored requirements first (W,U,B,R,G,C), one mana per source
// - then generic with any remaining sources
function autoSelectPayment(
  sources: Array<{ id: string; options: Color[] }>,
  cost: { colors: Record<Color, number>; generic: number }
): PaymentItem[] | null {
  const remainingColors: Record<Color, number> = { W: cost.colors.W, U: cost.colors.U, B: cost.colors.B, R: cost.colors.R, G: cost.colors.G, C: cost.colors.C };
  let remainingGeneric = cost.generic;
  const unused = sources.slice();
  const payment: PaymentItem[] = [];

  // Colored first
  for (const c of (['W','U','B','R','G','C'] as const)) {
    while (remainingColors[c] > 0) {
      const idx = unused.findIndex(s => s.options.includes(c));
      if (idx < 0) return null;
      const src = unused.splice(idx, 1)[0];
      payment.push({ permanentId: src.id, mana: c });
      remainingColors[c] -= 1;
    }
  }

  // Generic
  const remainingNeeded = Math.max(0, remainingGeneric);
  for (let i = 0; i < remainingNeeded; i++) {
    if (unused.length === 0) return null;
    const src = unused.shift()!;
    const mana = src.options[0]; // any available
    payment.push({ permanentId: src.id, mana });
  }

  return payment;
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
  sources: Array<{ id: string; name: string; options: Color[] }>;
  chosen: PaymentItem[];
  onChange: (next: PaymentItem[]) => void;
}) {
  const { manaCost, sources, chosen, onChange } = props;

  const cost = useMemo(() => parseManaCost(manaCost), [manaCost]);
  const pool = useMemo(() => paymentToPool(chosen), [chosen]);
  const satisfied = useMemo(() => canPay(cost, pool), [cost, pool]);
  const remaining = useMemo(() => remainingCost(cost, pool), [cost, pool]);

  const chosenById = useMemo(() => new Set(chosen.map(p => p.permanentId)), [chosen]);

  const add = (permanentId: string, mana: Color) => {
    if (chosenById.has(permanentId)) return; // one mana per source
    onChange([...chosen, { permanentId, mana }]);
  };
  const remove = (permanentId: string) => {
    onChange(chosen.filter(p => p.permanentId !== permanentId));
  };
  const clear = () => onChange([]);

  const doAutoSelect = () => {
    const baseSources = sources.map(s => ({ id: s.id, options: s.options }));
    const auto = autoSelectPayment(baseSources, cost);
    if (auto) onChange(auto);
  };

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 420 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Cost:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, cost.colors[c]))}
        {costBadge('Generic', cost.generic)}
        {!manaCost && <span style={{ fontSize: 12, opacity: 0.7 }}>(no mana cost)</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Selected:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, pool[c]))}
        {Object.values(pool).every(v => v === 0) && <span style={{ fontSize: 12, opacity: 0.7 }}>None (leave empty to auto-pay)</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>Remaining:</b>
        {(['W','U','B','R','G','C'] as const).map(c => costBadge(c, remaining.colors[c]))}
        {costBadge('Generic', remaining.generic)}
        {satisfied && <span style={{ fontSize: 12, color: '#2b6cb0' }}>Cost satisfied</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Sources:</b>
        <button onClick={clear} disabled={chosen.length === 0} title="Clear selected payment">Clear</button>
        <button onClick={doAutoSelect} disabled={sources.length === 0 || satisfied} title="Auto-select payment from available sources">Auto-select</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Tip: leave selection empty to auto-pay on server</span>
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