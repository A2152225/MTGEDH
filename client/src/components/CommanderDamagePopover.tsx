import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CommanderInfo, PlayerID, PlayerRef } from '../../../shared/src';
import { useIsTouch } from '../hooks/useIsTouch';
import {
  buildCommanderDamageRows,
  commanderDamageRowColor,
  groupCommanderDamageRowsByOwner,
} from '../utils/commanderDamageDisplay';

type Props = {
  victimPlayerId: PlayerID;
  victimPlayerName?: string;
  players: readonly PlayerRef[];
  commanderDamage?: Record<PlayerID, Record<string, number>>;
  commandZone?: Record<PlayerID, CommanderInfo | undefined>;
  format?: string;
  children: React.ReactNode;
};

export function CommanderDamagePopover({
  victimPlayerId,
  victimPlayerName,
  players,
  commanderDamage,
  commandZone,
  format,
  children,
}: Props) {
  const isTouch = useIsTouch();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [showPopover, setShowPopover] = useState(false);

  const rows = useMemo(
    () => buildCommanderDamageRows(victimPlayerId, players, commanderDamage, commandZone, format),
    [victimPlayerId, players, commanderDamage, commandZone, format],
  );
  const ownerGroups = useMemo(
    () => (rows ? groupCommanderDamageRowsByOwner(rows) : []),
    [rows],
  );

  const isCommanderGame = rows !== null;
  const hasAnyDamage = rows?.some((row) => row.damage > 0) ?? false;
  const hasLethalDamage = rows?.some((row) => row.damage >= 21) ?? false;

  useEffect(() => {
    if (!showPopover || !isTouch) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setShowPopover(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showPopover, isTouch]);

  if (!isCommanderGame) {
    return <>{children}</>;
  }

  const openPopover = () => setShowPopover(true);
  const closePopover = () => setShowPopover(false);
  const togglePopover = () => setShowPopover((open) => !open);

  return (
    <span
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
      onMouseEnter={isTouch ? undefined : openPopover}
      onMouseLeave={isTouch ? undefined : closePopover}
      onClick={
        isTouch
          ? (event) => {
              event.stopPropagation();
              togglePopover();
            }
          : undefined
      }
    >
      <span
        aria-label={
          hasAnyDamage
            ? `Life total with commander damage taken from ${rows?.length ?? 0} commander(s)`
            : 'Life total'
        }
        title={isTouch ? undefined : 'Hover for commander damage'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'help',
          borderRadius: 4,
          padding: hasAnyDamage ? '0 2px' : undefined,
          boxShadow: hasLethalDamage
            ? '0 0 0 1px rgba(239,68,68,0.75)'
            : hasAnyDamage
              ? '0 0 0 1px rgba(251,191,36,0.45)'
              : undefined,
        }}
      >
        {children}
      </span>

      {showPopover && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            padding: '10px 12px',
            background: 'rgba(15,15,25,0.98)',
            borderRadius: 8,
            border: hasLethalDamage
              ? '1px solid rgba(239,68,68,0.55)'
              : '1px solid rgba(251,191,36,0.35)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            zIndex: 10000,
            minWidth: 220,
            maxWidth: 320,
            pointerEvents: isTouch ? 'auto' : 'none',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#fbbf24',
              marginBottom: 8,
              borderBottom: '1px solid rgba(255,255,255,0.15)',
              paddingBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>👑</span>
            <span>
              Commander damage
              {victimPlayerName ? ` to ${victimPlayerName}` : ''}
            </span>
          </div>

          {ownerGroups.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ownerGroups.map((group) => (
                <div key={group.ownerId || group.ownerName}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#9ca3af',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: 4,
                    }}
                  >
                    {group.ownerName}
                    {group.commanders.length > 1 ? ` (${group.commanders.length} commanders)` : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {group.commanders.map((row) => (
                      <div
                        key={`${row.ownerId}:${row.commanderId}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 12,
                          fontSize: 11,
                          color: commanderDamageRowColor(row.damage),
                          paddingLeft: group.commanders.length > 1 ? 8 : 0,
                        }}
                      >
                        <span style={{ minWidth: 0 }}>{row.commanderName}</span>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {row.damage}/21
                          {row.damage >= 21 ? ' ⚠' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(209,213,219,0.75)' }}>
              No commanders declared in this pod.
            </div>
          )}

          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: '1px solid rgba(255,255,255,0.1)',
              fontSize: 10,
              color: 'rgba(156,163,175,0.9)',
            }}
          >
            Lose at 21+ from a single commander (partners tracked separately).
          </div>
        </div>
      )}
    </span>
  );
}
