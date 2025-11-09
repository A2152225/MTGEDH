import React from 'react';
import type { PlayerID, PlayerZones, CommanderInfo, KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

interface InlineZonesProps {
  playerId: PlayerID;
  zones: PlayerZones;
  commander?: CommanderInfo;
  isCommanderFormat?: boolean;
  imagePref: 'small' | 'normal' | 'art_crop';
  onHoverCard?: (card: KnownCardRef) => void;
}

export function InlineZones(props: InlineZonesProps) {
  const { zones, commander, isCommanderFormat, imagePref } = props;

  const graveTop = zones.graveyard[zones.graveyard.length - 1];
  const exileTop = zones.exile && zones.exile.length ? (zones.exile[zones.exile.length - 1] as any as KnownCardRef) : undefined;
  const libraryTop = zones.libraryTop;

  function renderPile(label: string, count: number, topCard?: KnownCardRef) {
    return (
      <div
        style={{
          minWidth: 70,
          padding: '4px 6px',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid #333',
          borderRadius: 6,
          color: '#ddd',
          fontSize: 11,
          position: 'relative',
          cursor: topCard ? 'pointer' : 'default'
        }}
        onMouseEnter={(e) => {
          if (topCard) showCardPreview(e.currentTarget as HTMLElement, topCard, { prefer: 'above', anchorPadding: 0 });
        }}
        onMouseLeave={(e) => {
          if (topCard) hideCardPreview(e.currentTarget as HTMLElement);
        }}
        title={topCard ? topCard.name : `${label} (${count})`}
      >
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ opacity: 0.75 }}>Count: {count}</div>
        {topCard && (
          <div style={{
            marginTop: 4,
            fontSize: 10,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.9
          }}>{topCard.name}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {renderPile('Library', zones.libraryCount, libraryTop)}
      {renderPile('Graveyard', zones.graveyardCount, graveTop)}
      {renderPile('Exile', zones.exile?.length || 0, exileTop)}
      {isCommanderFormat && commander && (
        <div style={{
          minWidth: 70,
          padding: '4px 6px',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid #333',
          borderRadius: 6,
          color: '#ddd',
          fontSize: 11
        }}>
          <div style={{ fontWeight: 600 }}>Command</div>
          <div style={{ opacity: 0.75 }}>Tax: {commander.tax ?? 0}</div>
          {commander.commanderNames && commander.commanderNames.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10 }}>
              {commander.commanderNames.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}