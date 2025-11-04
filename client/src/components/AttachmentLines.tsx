import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BattlefieldPermanent } from '../../../shared/src';

type Point = { x: number; y: number };

export function AttachmentLines(props: {
  containerRef: React.RefObject<HTMLElement>;
  permanents: BattlefieldPermanent[];
  stroke?: string;
  opacity?: number;
}) {
  const { containerRef, permanents, stroke = 'rgba(255,255,255,0.35)', opacity = 1 } = props;
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [lines, setLines] = useState<{ from: Point; to: Point }[]>([]);
  const raf = useRef<number>();

  const attachments = useMemo(() => permanents.filter(p => p.attachedTo), [permanents]);

  const measure = () => {
    const el = containerRef.current as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const items = el.querySelectorAll<HTMLElement>('[data-perm-id]');
    const centers = new Map<string, Point>();
    items.forEach(item => {
      const id = item.getAttribute('data-perm-id');
      if (!id) return;
      const r = item.getBoundingClientRect();
      centers.set(id, { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top });
    });
    const ls: { from: Point; to: Point }[] = [];
    for (const a of attachments) {
      const from = centers.get(a.id);
      const to = centers.get(a.attachedTo!);
      if (from && to) ls.push({ from, to });
    }
    setSize({ w: rect.width, h: rect.height });
    setLines(ls);
  };

  useEffect(() => {
    measure();
    const onResize = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, permanents]);

  return (
    <svg
      width={size.w}
      height={size.h}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity }}
    >
      {lines.map((l, i) => (
        <g key={i}>
          <line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke={stroke} strokeWidth={2} />
          {/* small endpoint dots */}
          <circle cx={l.from.x} cy={l.from.y} r={3} fill={stroke} />
          <circle cx={l.to.x} cy={l.to.y} r={3} fill={stroke} />
        </g>
      ))}
    </svg>
  );
}