import React, { useEffect, useState } from "react";
import { socket } from "../socket";
import { z } from "../theme";

type RebuildProgress = {
  current: number;
  total: number;
  percent: number;
  reason?: "resume" | "undo";
};

export function GameRebuildProgressOverlay({ gameId }: { gameId?: string | null }) {
  const [progress, setProgress] = useState<RebuildProgress | null>(null);

  useEffect(() => {
    if (!gameId) {
      setProgress(null);
      return;
    }

    const handleResumeProgress = (payload: {
      gameId?: string;
      current?: number;
      total?: number;
      percent?: number;
      isRestoring?: boolean;
      reason?: "resume" | "undo";
    }) => {
      if (!payload?.gameId || payload.gameId !== gameId) return;
      if (!payload.isRestoring) {
        setProgress(null);
        return;
      }
      setProgress({
        current: Number(payload.current) || 0,
        total: Number(payload.total) || 0,
        percent: Math.max(0, Math.min(100, Number(payload.percent) || 0)),
        reason: payload.reason === "undo" ? "undo" : "resume",
      });
    };

    socket.on("gameResumeProgress", handleResumeProgress);
    return () => {
      socket.off("gameResumeProgress", handleResumeProgress);
    };
  }, [gameId]);

  if (!gameId || !progress) return null;

  const pct = progress.percent;
  const verb = progress.reason === "undo" ? "Undoing" : "Restoring";
  const label =
    progress.total > 0
      ? `${verb} ${progress.current}/${progress.total}`
      : `${verb}…`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: z.modal,
      }}
    >
      <div
        style={{
          minWidth: 280,
          maxWidth: 420,
          width: "min(70vw, 420px)",
          padding: "18px 28px 20px",
          borderRadius: 16,
          background: "linear-gradient(180deg, rgba(6, 78, 59, 0.94), rgba(4, 47, 46, 0.96))",
          border: "1px solid rgba(52, 211, 153, 0.7)",
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.45), 0 0 28px rgba(52, 211, 153, 0.28)",
          color: "#ecfdf5",
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          {progress.reason === "undo" ? "Undoing" : "Restoring"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              flex: 1,
              height: 8,
              borderRadius: 4,
              background: "rgba(236, 253, 245, 0.18)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "linear-gradient(90deg, #34d399, #6ee7b7)",
                transition: "width 120ms linear",
              }}
            />
          </div>
          <span
            style={{
              color: "#a7f3d0",
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {pct}%
          </span>
        </div>
        <div
          style={{
            color: "#a7f3d0",
            fontSize: 12,
            marginTop: 8,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

export default GameRebuildProgressOverlay;
