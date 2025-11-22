import React, { useState, useEffect } from "react";

type NameInUsePayload = {
  gameId: string;
  playerName: string;
  options: Array<{ action: "reconnect" | "newName" | "cancel"; fixedPlayerId?: string }>;
  meta?: { isConnected?: boolean };
};

type Props = {
  open: boolean;
  payload?: NameInUsePayload | null;
  onClose: () => void;
  // Now includes optional seatToken so client can pass token to server for safe reattach.
  onReconnect: (fixedPlayerId: string, seatToken?: string) => void;
  onNewName: (newName: string) => void;
};

export default function NameInUseModal({ open, payload, onClose, onReconnect, onNewName }: Props) {
  const [newName, setNewName] = useState<string>(payload?.playerName || "");

  useEffect(() => {
    if (payload) setNewName(payload.playerName || "");
  }, [payload]);

  if (!open || !payload) return null;

  const hasReconnect = payload.options.some((o) => o.action === "reconnect");
  const reconnectOption = payload.options.find((o) => o.action === "reconnect");

  // Compute seatToken from sessionStorage if available (same key as App's seatTokenKey)
  const sessionKey = `mtgedh:seatToken:${payload.gameId}:${payload.playerName}`;
  const savedSeatToken = typeof window !== "undefined" ? sessionStorage.getItem(sessionKey) || undefined : undefined;

  const onChooseReconnect = () => {
    if (!reconnectOption || !reconnectOption.fixedPlayerId) return;
    // Prefer explicit seatToken saved in sessionStorage; pass it along to the server
    onReconnect(reconnectOption.fixedPlayerId, savedSeatToken);
    onClose();
  };

  const onChooseNewName = () => {
    if (!newName || !newName.trim()) return;
    onNewName(newName.trim());
    onClose();
  };

  const onChooseCancel = () => {
    onClose();
  };

  const isConnected = !!payload.meta?.isConnected;

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", zIndex: 2000
    }}>
      <div style={{ width: 420, background: "#fff", borderRadius: 8, padding: 18, boxShadow: "0 6px 24px rgba(0,0,0,0.3)" }}>
        <h3 style={{ marginTop: 0 }}>Name already in use</h3>
        <p>
          The name <strong>{payload.playerName}</strong> is already present in this game's roster.
        </p>

        {hasReconnect && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 8 }}>
              {isConnected
                ? `Someone is currently connected as ${payload.playerName}. If this is you, click Reconnect to reattach to the existing seat.`
                : `A disconnected seat exists for ${payload.playerName}. Reconnect will reattach your client to that seat if you own it.`}
            </div>
            <button onClick={onChooseReconnect} style={{ marginRight: 8 }}>
              Reconnect as {payload.playerName}
            </button>
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 6 }}>Or choose a new name:</div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New name"
            style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box", marginBottom: 8 }}
          />
          <div>
            <button onClick={onChooseNewName} style={{ marginRight: 8 }}>Use new name</button>
            <button onClick={onChooseCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}