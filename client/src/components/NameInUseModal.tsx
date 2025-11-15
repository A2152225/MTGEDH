import React, { useState } from "react";

type NameInUsePayload = {
  gameId: string;
  playerName: string;
  options: Array<{ action: "reconnect" | "newName" | "cancel"; fixedPlayerId?: string }>;
};

type Props = {
  open: boolean;
  payload?: NameInUsePayload | null;
  onClose: () => void;
  onReconnect: (fixedPlayerId: string) => void;
  onNewName: (newName: string) => void;
};

export default function NameInUseModal({ open, payload, onClose, onReconnect, onNewName }: Props) {
  const [newName, setNewName] = useState<string>(payload?.playerName || "");

  React.useEffect(() => {
    if (payload) setNewName(payload.playerName || "");
  }, [payload]);

  if (!open || !payload) return null;

  const hasReconnect = payload.options.some((o) => o.action === "reconnect");
  const reconnectOption = payload.options.find((o) => o.action === "reconnect");
  const onChooseReconnect = () => {
    if (!reconnectOption || !reconnectOption.fixedPlayerId) return;
    onReconnect(reconnectOption.fixedPlayerId);
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

  // Simple, unstyled modal UI — adapt to your app's modal system / styling
  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", zIndex: 2000
    }}>
      <div style={{ width: 420, background: "#fff", borderRadius: 8, padding: 18, boxShadow: "0 6px 24px rgba(0,0,0,0.3)" }}>
        <h3 style={{ marginTop: 0 }}>Name already in use</h3>
        <p>
          The name <strong>{payload.playerName}</strong> is currently connected in this game.
        </p>

        {hasReconnect && (
          <div style={{ marginBottom: 12 }}>
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