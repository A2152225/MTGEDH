/**
 * AssistRequestButton: Assist (CR 702.132) helper prompt for a cast waiting on payment.
 * Emits `requestAssist` { gameId, effectId, helperId }; the helper answers a NUMBER_CHOICE step.
 */
import React, { useState } from "react";
import { socket } from "../socket";
import { toast } from "./ToastHost";

export function oracleHasAssist(oracleText?: string): boolean {
  return /(^|\n)\s*assist\b/i.test(String(oracleText || ""));
}

export interface AssistRequestButtonProps {
  open: boolean;
  gameId?: string;
  effectId?: string;
  oracleText?: string;
  you?: string;
  players: Array<{ id: string; name?: string }>;
}

export function AssistRequestButton({ open, gameId, effectId, oracleText, you, players }: AssistRequestButtonProps) {
  const helpers = players.filter((p) => p?.id && p.id !== you);
  const [helperId, setHelperId] = useState<string>("");
  const [sent, setSent] = useState(false);
  if (!open || !gameId || !effectId || !oracleHasAssist(oracleText) || helpers.length === 0) return null;
  const chosen = helperId || helpers[0].id;
  return (
    <div
      data-testid="assist-request"
      title="Assist: another player may pay some of this spell's generic mana."
      style={{ position: "fixed", bottom: 16, left: 16, zIndex: 10001, background: "#1f2937", color: "#fff", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(59, 130, 246, 0.6)", boxShadow: "0 4px 12px rgba(0,0,0,0.4)", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
    >
      <span style={{ fontWeight: 600 }}>Assist: ask</span>
      <select value={chosen} disabled={sent} onChange={(e) => setHelperId(e.target.value)} style={{ background: "rgba(0,0,0,0.3)", color: "#fff", border: "1px solid #4b5563", borderRadius: 4, padding: "2px 4px" }}>
        {helpers.map((p) => (
          <option key={p.id} value={p.id}>{p.name || p.id}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={sent}
        style={{ backgroundColor: sent ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.85)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", cursor: sent ? "default" : "pointer" }}
        onClick={() => {
          socket.emit("requestAssist", { gameId, effectId, helperId: chosen });
          setSent(true);
          const helperName = helpers.find((p) => p.id === chosen)?.name || chosen;
          toast.info(`Asked ${helperName} to help pay for this spell. Wait for their answer, then finish paying.`);
        }}
      >
        {sent ? "Waiting for helper..." : "to help pay"}
      </button>
    </div>
  );
}

export default AssistRequestButton;