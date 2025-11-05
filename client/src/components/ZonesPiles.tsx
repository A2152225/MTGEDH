import React from 'react';
import type { CommanderInfo, PlayerZones } from '../../../shared/src';

function pileHeightPx(count: number) {
  return Math.min(140, 14 + Math.ceil(count * 1.2));
}

export function ZonesPiles(props: {
  zones: PlayerZones;
  commander?: CommanderInfo;
  isCommanderFormat?: boolean;
}) {
  const { zones, commander, isCommanderFormat } = props;
  const libCount = zones.libraryCount ?? 0;
  const gyArr = (zones.graveyard as any[]) || [];
  const gyCount = zones.graveyardCount ?? gyArr.length ?? 0;
  const exArr = ((zones as any).exile as any[]) || [];
  const exCount = exArr.length ?? 0;

  const gyTop = gyArr.length > 0 ? gyArr[gyArr.length - 1] : null;
  const exTop = exArr.length > 0 ? exArr[exArr.length - 1] : null;

  const cmdNames = (isCommanderFormat ? (commander as any)?.commanderNames : undefined) as string[] | undefined;
  const cmdCount = isCommanderFormat ? ((commander?.commanderIds?.length ?? 0)) : 0;

  const PileStack = (p: { label: string; count: number; color: string; title?: string }) => {
    const h = pileHeightPx(p.count);
    const layers = Math.max(1, Math.min(8, Math.ceil(p.count / 12)));
    return (
      <div title={p.title || `${p.label}: ${p.count}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ position: 'relative', width: 72, height: h }}>
          {Array.from({ length: layers }).map((_, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: i * 2, bottom: i * 2,
              width: 60, height: Math.max(8, h - i * 2),
              border: '1px solid rgba(0,0,0,0.6)',
              borderRadius: 6,
              background: p.color,
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
            }} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#ddd' }}>{p.label}: {p.count}</div>
      </div>
    );
  };

  const ThumbOrPile = (p: { label: string; top: any | null; count: number; pileColor: string }) => {
    const img = p.top?.image_uris?.small || p.top?.image_uris?.normal || null;
    const name = p.top?.name || '';
    return (
      <div title={`${p.label}: ${p.count}${name ? ` • Top: ${name}` : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          position: 'relative', width: 72, height: 100, borderRadius: 6, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.2)', background: '#0f0f0f'
        }}>
          {img ? (
            <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 11 }}>
              {p.label}
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#ddd' }}>{p.label}: {p.count}</div>
      </div>
    );
  };

  const CommandSlots = () => {
    const slots = [0, 1];
    return (
      <div title="Command Zone" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {slots.map((i) => (
            <div key={i} style={{
              width: 60, height: 88, borderRadius: 6, border: '2px dashed rgba(255,255,255,0.3)',
              background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 10
            }}>
              {cmdNames && cmdNames[i] ? cmdNames[i] : 'Commander'}
            </div>
          ))}
        </div>
        {cmdNames && cmdNames.length > 0 && (
          <div style={{ maxWidth: 140, color: '#bbb', fontSize: 10, textAlign: 'center' }}>
            {cmdNames.join(' / ')}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      {isCommanderFormat && <CommandSlots />}
      <PileStack label="Library" count={libCount} color="linear-gradient(180deg,#047857,#064e3b)" />
      <ThumbOrPile label="Graveyard" top={gyTop} count={gyCount} pileColor="linear-gradient(180deg,#4b5563,#111827)" />
      <ThumbOrPile label="Exile" top={exTop} count={exCount} pileColor="linear-gradient(180deg,#f59e0b,#b45309)" />
    </div>
  );
}