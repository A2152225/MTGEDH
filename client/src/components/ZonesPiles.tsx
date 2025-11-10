import React from 'react';
import type { CommanderInfo, PlayerZones } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

function pileHeightPx(count: number) {
  return Math.min(140, 14 + Math.ceil(count * 1.2));
}

export function ZonesPiles(props: {
  zones: PlayerZones;
  commander?: CommanderInfo;
  isCommanderFormat?: boolean;
  showHandCount?: number;
  hideHandDetails?: boolean;
  // Casting support
  canCastCommander?: boolean;
  onCastCommander?: (commanderIdOrName: string) => void;
}) {
  const {
    zones, commander, isCommanderFormat, showHandCount, hideHandDetails,
    canCastCommander = false, onCastCommander
  } = props;

  const libCount = zones.libraryCount ?? 0;
  const gyArr = ((zones as any).graveyard as any[]) || [];
  const gyCount = (zones as any).graveyardCount ?? gyArr.length ?? 0;
  const exArr = ((zones as any).exile as any[]) || [];
  const exCount = exArr.length ?? 0;

  const gyTop = gyArr.length > 0 ? gyArr[gyArr.length - 1] : null;
  const exTop = exArr.length > 0 ? exArr[exArr.length - 1] : null;

  const cmdNames = (isCommanderFormat ? (commander as any)?.commanderNames : undefined) as string[] | undefined;
  const cmdCards = (isCommanderFormat ? (commander as any)?.commanderCards : undefined) as any[] | undefined;
  const cmdIds = (isCommanderFormat ? (commander as any)?.commanderIds : undefined) as string[] | undefined;

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

  const ThumbOrPile = (p: { label: string; top: any | null; count: number }) => {
    const name = p.top?.name || '';
    const img = p.top?.image_uris?.small || p.top?.image_uris?.normal || null;
    const body = (
      <div style={{
        position: 'relative', width: 72, height: 100, borderRadius: 6, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.2)', background: '#0f0f0f',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 11, padding: 4, textAlign: 'center'
      }}>
        {img ? <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }} /> : null}
        <span style={{ position: 'relative', zIndex: 1 }}>{name || p.label}</span>
      </div>
    );
    return (
      <div
        title={`${p.label}: ${p.count}${name ? ` • Top: ${name}` : ''}`}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
        onMouseEnter={(e) => { if (p.top) showCardPreview(e.currentTarget as HTMLElement, p.top, { prefer: 'above', anchorPadding: 0 }); }}
        onMouseLeave={(e) => { hideCardPreview(e.currentTarget as HTMLElement); }}
      >
        {body}
        <div style={{ fontSize: 11, color: '#ddd' }}>{p.label}: {p.count}</div>
      </div>
    );
  };

  const CommandSlots = () => {
    const slotsCount = Math.max(1, Math.min(2, (cmdNames?.length || cmdIds?.length || 0) || 2));
    const slots = Array.from({ length: slotsCount }).map((_, i) => ({
      name: cmdNames?.[i] || 'Commander',
      card: cmdCards?.[i],
      id: cmdIds?.[i]
    }));
    return (
      <div title="Command Zone" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {slots.map((slot, i) => {
            const name = slot.name || 'Commander';
            const hasCard = !!slot.card || !!slot.id || !!name;
            const previewCard = slot.card || cmdCards?.[i];
            const commanderId = slot.id || previewCard?.id || name;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                {/* Name-only tile; no image per request, but keep hover preview if we have a card snapshot */}
                <div
                  style={{
                    width: 76, height: 54, borderRadius: 6,
                    border: hasCard ? '2px solid rgba(255,255,255,0.5)' : '2px dashed rgba(255,255,255,0.3)',
                    background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', color: '#ddd', fontSize: 10, padding: '2px 4px', textAlign: 'center',
                    cursor: previewCard ? 'pointer' : 'default'
                  }}
                  onMouseEnter={(e) => { if (previewCard) showCardPreview(e.currentTarget as HTMLElement, previewCard, { prefer: 'above', anchorPadding: 0 }); }}
                  onMouseLeave={(e) => { hideCardPreview(e.currentTarget as HTMLElement); }}
                >
                  {name}
                </div>
                {canCastCommander && hasCard && onCastCommander && (
                  <button
                    type="button"
                    onClick={() => commanderId && onCastCommander(commanderId)}
                    style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6 }}
                    title={`Cast ${name}`}
                  >
                    Cast
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {cmdNames && cmdNames.length > 0 && (
          <div style={{ maxWidth: 160, color: '#bbb', fontSize: 10, textAlign: 'center' }}>
            {cmdNames.join(' / ')}
          </div>
        )}
      </div>
    );
  };

  const HandPile = () => {
    if (showHandCount == null) return null;
    return <PileStack label="Hand" count={showHandCount} color="linear-gradient(180deg,#1f2937,#111827)" />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      {isCommanderFormat && <CommandSlots />}
      <PileStack label="Library" count={libCount} color="linear-gradient(180deg,#047857,#064e3b)" />
      <ThumbOrPile label="Graveyard" top={gyTop} count={gyCount} />
      <ThumbOrPile label="Exile" top={exTop} count={exCount} />
      {hideHandDetails && <HandPile />}
    </div>
  );
}