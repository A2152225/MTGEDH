// Origin parent: card/zone context menus.
// Cluster: extra Move-to rows shown only while Manual Mode is on.
// Public entry symbols: ManualModeMenuItems, useManualModeEnabled.

import React, { useEffect, useState } from 'react';
import { socket } from '../../socket';
import { getReportIssueContext } from '../../utils/reportIssueStore';
import {
  isManualModeEnabled,
  subscribeManualMode,
} from '../../utils/manualModeStore';
import type { ManualZone } from '../../../../shared/src/manualAction';
import { colors, fontSize } from '../../theme';

export function useManualModeEnabled(): boolean {
  const [enabled, setEnabled] = useState(isManualModeEnabled);
  useEffect(() => subscribeManualMode(() => setEnabled(isManualModeEnabled())), []);
  return enabled;
}

const DESTINATIONS: Array<{ zone: ManualZone; label: string }> = [
  { zone: 'hand', label: 'Move to hand' },
  { zone: 'graveyard', label: 'Move to graveyard' },
  { zone: 'exile', label: 'Move to exile' },
  { zone: 'library', label: 'Put on top of library' },
  { zone: 'battlefield', label: 'Put onto battlefield' },
];

export function ManualModeMenuItems(props: {
  gameId?: string | null;
  objectId: string;
  fromZone: ManualZone;
  itemStyle: React.CSSProperties;
  onClose: () => void;
  extraBattlefield?: boolean;
}): React.ReactElement | null {
  const enabled = useManualModeEnabled();
  const gameId = props.gameId || getReportIssueContext().gameId;
  if (!enabled || !gameId || !props.objectId) return null;

  const emitMove = (toZone: ManualZone, extra?: Record<string, unknown>) => {
    socket.emit('manualAction', {
      gameId,
      verb: toZone === 'library' ? 'put_on_top' : 'move_object',
      objectIds: [props.objectId],
      toZone,
      ...extra,
    });
    props.onClose();
  };

  return (
    <>
      <div
        style={{
          padding: '6px 12px',
          backgroundColor: '#1e1e35',
          color: colors.accentStrong,
          fontSize: fontSize.xxs,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Manual
      </div>
      {DESTINATIONS.filter((d) => d.zone !== props.fromZone).map((dest) => (
        <div
          key={dest.zone}
          style={props.itemStyle}
          onClick={() => emitMove(dest.zone)}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212,169,94,0.18)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ width: 20, textAlign: 'center' }}>✎</span>
          <span>{dest.label}</span>
        </div>
      ))}
      {props.extraBattlefield && (
        <>
          <div
            style={props.itemStyle}
            onClick={() => {
              socket.emit('manualAction', {
                gameId,
                verb: 'tap_untap',
                objectIds: [props.objectId],
                tapped: true,
              });
              props.onClose();
            }}
          >
            <span style={{ width: 20, textAlign: 'center' }}>↪️</span>
            <span>Force tap</span>
          </div>
          <div
            style={props.itemStyle}
            onClick={() => {
              socket.emit('manualAction', {
                gameId,
                verb: 'tap_untap',
                objectIds: [props.objectId],
                tapped: false,
              });
              props.onClose();
            }}
          >
            <span style={{ width: 20, textAlign: 'center' }}>🔄</span>
            <span>Force untap</span>
          </div>
          <div
            style={{
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              color: colors.textPrimary,
              fontSize: fontSize.xs,
            }}
          >
            <span style={{ width: 20, textAlign: 'center' }}>💥</span>
            <span>Deal dmg</span>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  socket.emit('manualAction', {
                    gameId,
                    verb: 'deal_damage',
                    objectIds: [props.objectId],
                    amount: n,
                  });
                  props.onClose();
                }}
                style={{
                  minWidth: 28,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.accent}`,
                  background: colors.accentSoft,
                  color: colors.accentStrong,
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: fontSize.xs,
                }}
                title={`Mark ${n} damage. The creature stays unless this makes it lethal.`}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
