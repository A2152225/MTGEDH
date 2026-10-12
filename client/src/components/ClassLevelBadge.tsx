// ClassLevelBadge.tsx
// Class enchantments (CR 716): the printed card image shows every level, so battlefield tiles get
// a small "Lv N/M" badge and the hover preview lists the level sections with inactive ones dimmed.
// Public entry symbols: ClassLevelBadge, ClassLevelSectionsList, getClassLevelView.

import React from 'react';
import { splitClassLevelSections, type ClassLevelSection } from '../../../shared/src/classLevelText';

export interface ClassLevelView {
  level: number;
  maxLevel: number;
  sections: ClassLevelSection[];
}

/** Level view for a battlefield Class (server stamps classFullOracleText/classLevel), else null. */
export function getClassLevelView(card: any, permLevel?: unknown): ClassLevelView | null {
  const full = typeof card?.classFullOracleText === 'string' ? card.classFullOracleText : '';
  if (!full) return null;
  const raw = Number(permLevel ?? card?.classLevel);
  const level = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const sections = splitClassLevelSections(full, level);
  if (sections.length < 2) return null;
  const maxLevel = Math.max(...sections.map((s) => s.level));
  return { level, maxLevel, sections };
}

function sectionTitle(view: ClassLevelView): string {
  return view.sections
    .map((s) => `${s.active ? '\u2713' : '\u2717'} Level ${s.level}${s.active ? '' : ' (inactive)'}: ${s.text.replace(/\s+/g, ' ')}`)
    .join('\n');
}

export function ClassLevelBadge(props: { card: any; level?: unknown; scale: number }) {
  const view = getClassLevelView(props.card, props.level);
  if (!view) return null;
  const { scale } = props;
  const maxed = view.level >= view.maxLevel;
  return (
    <div
      title={`Class level ${view.level} of ${view.maxLevel}\n${sectionTitle(view)}`}
      style={{
        position: 'absolute',
        top: Math.round(4 * scale),
        left: Math.round(4 * scale),
        padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
        borderRadius: Math.round(6 * scale),
        background: maxed
          ? 'linear-gradient(135deg, rgba(234,179,8,0.95), rgba(202,138,4,0.95))'
          : 'linear-gradient(135deg, rgba(124,58,237,0.95), rgba(109,40,217,0.95))',
        border: '1px solid rgba(255,255,255,0.6)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        color: '#fff',
        fontSize: Math.round(11 * scale),
        fontWeight: 700,
        lineHeight: 1.1,
        zIndex: 18,
        pointerEvents: 'auto',
      }}
    >
      Lv {view.level}/{view.maxLevel}
    </div>
  );
}

/** Level sections for the hover preview: active ones normal, inactive dimmed and marked. */
export function ClassLevelSectionsList(props: { view: ClassLevelView }) {
  const { view } = props;
  return (
    <div style={{ marginTop: 4, maxHeight: 140, overflowY: 'auto', fontSize: 11, lineHeight: 1.3 }}>
      <div style={{ fontWeight: 700 }}>Class level {view.level} of {view.maxLevel}</div>
      {view.sections.map((s) => (
        <div
          key={s.level}
          style={{ opacity: s.active ? 1 : 0.45, textDecoration: s.active ? 'none' : 'line-through', marginTop: 2 }}
        >
          <span style={{ fontWeight: 600 }}>{s.active ? '\u2713' : '\u2717'} Level {s.level}{s.active ? '' : ' (inactive)'}:</span>{' '}
          {s.text.replace(/\s+/g, ' ')}
        </div>
      ))}
    </div>
  );
}
