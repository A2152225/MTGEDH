import React, { useEffect, useMemo, useState } from 'react';

export interface LifeRedistributionPlayer {
  id: string;
  name: string;
  life: number;
}

export interface LifeRedistributionModalProps {
  open: boolean;
  sourceName: string;
  imageUrl?: string;
  players: LifeRedistributionPlayer[];
  onConfirm: (payload: { lifeByPlayerId: Record<string, number> }) => void;
  onCancel?: () => void;
}

export function LifeRedistributionModal({
  open,
  sourceName,
  imageUrl,
  players,
  onConfirm,
  onCancel,
}: LifeRedistributionModalProps) {
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [assignedLife, setAssignedLife] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    const nextIncluded: Record<string, boolean> = {};
    const nextAssigned: Record<string, number> = {};
    for (const player of players) {
      nextIncluded[player.id] = true;
      nextAssigned[player.id] = player.life;
    }
    setIncluded(nextIncluded);
    setAssignedLife(nextAssigned);
  }, [open, players]);

  const participantIds = useMemo(
    () => players.map((player) => player.id).filter((id) => included[id]),
    [players, included],
  );

  const poolTotal = useMemo(
    () => participantIds.reduce((sum, id) => {
      const player = players.find((entry) => entry.id === id);
      return sum + (player?.life ?? 0);
    }, 0),
    [participantIds, players],
  );

  const assignedTotal = useMemo(
    () => participantIds.reduce((sum, id) => sum + Math.max(0, Number(assignedLife[id] ?? 0)), 0),
    [participantIds, assignedLife],
  );

  const remaining = poolTotal - assignedTotal;
  const canConfirm = participantIds.length === 0 || remaining === 0;

  if (!open) return null;

  const handleConfirm = () => {
    const lifeByPlayerId: Record<string, number> = {};
    for (const id of participantIds) {
      lifeByPlayerId[id] = Math.max(0, Math.floor(Number(assignedLife[id] ?? 0)));
    }
    onConfirm({ lifeByPlayerId });
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10050 }}>
      <div className="modal-content" style={{ maxWidth: 520, width: '92vw' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={sourceName}
              style={{ width: 72, borderRadius: 6, flexShrink: 0 }}
            />
          ) : null}
          <div>
            <h3 style={{ margin: 0 }}>Redistribute Life Totals</h3>
            <p style={{ margin: '6px 0 0', opacity: 0.85 }}>
              {sourceName}: choose any number of players and assign life totals. The total life among
              selected players must stay the same.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {players.map((player) => {
            const isIncluded = Boolean(included[player.id]);
            return (
              <div
                key={player.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={isIncluded}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setIncluded((prev) => ({ ...prev, [player.id]: checked }));
                    if (checked && assignedLife[player.id] == null) {
                      setAssignedLife((prev) => ({ ...prev, [player.id]: player.life }));
                    }
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{player.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Current life: {player.life}</div>
                </div>
                <label style={{ fontSize: 12, opacity: 0.8 }}>New life</label>
                <input
                  type="number"
                  min={0}
                  disabled={!isIncluded}
                  value={isIncluded ? assignedLife[player.id] ?? player.life : ''}
                  onChange={(event) => {
                    const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                    setAssignedLife((prev) => ({ ...prev, [player.id]: next }));
                  }}
                  style={{ width: 80 }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.9 }}>
          {participantIds.length === 0 ? (
            <span>No players selected — life totals will not change.</span>
          ) : (
            <span>
              Pool total: {poolTotal} · Assigned: {assignedTotal}
              {remaining !== 0 ? ` · Remaining to assign: ${remaining}` : ' · Ready to confirm'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {onCancel ? (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Confirm Redistribution
          </button>
        </div>
      </div>
    </div>
  );
}

export default LifeRedistributionModal;
