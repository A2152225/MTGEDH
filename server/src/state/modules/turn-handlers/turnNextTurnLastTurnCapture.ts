// server/src/state/modules/turn-handlers/turnNextTurnLastTurnCapture.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: nextTurn intervening-if last-turn capture (lands, creatures,
// attacked players, monarch/spell-cast trackers for the turn that just ended).
// Public entry symbols: captureNextTurnLastTurnInterveningIfState.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";

/**
 * Snapshot last-turn intervening-if state when leaving the previous turn player.
 * nextTurn remains the dispatcher and supplies `current`.
 */
export function captureNextTurnLastTurnInterveningIfState(
  ctx: GameContext,
  current: string,
): void {
    // Intervening-if support: capture last-turn attack targets for the turn that just ended,
    // and initialize the "since your last turn ended" opponent spell-cast tracker.
    try {
      const stateAny = (ctx as any).state as any;
      const ended = String(current || '').trim();
      if (ended) {
        // Persist how many lands entered under this player's control during their last turn.
        // Used by intervening-if templates like:
        // "if more lands entered the battlefield under your control this turn than an opponent had enter during their last turn".
        const landsThisTurn = stateAny.landsEnteredBattlefieldThisTurn;
        {
          const v = landsThisTurn && typeof landsThisTurn === 'object' ? (landsThisTurn as any)[ended] : undefined;
          const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0;
          stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts = stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts || {};
          stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[ended] = n;
        }

        // Persist how many creatures entered under this player's control during their last turn.
        // Used by intervening-if templates like:
        // "if you had another creature enter the battlefield under your control last turn".
        const creaturesThisTurn = stateAny.creaturesEnteredBattlefieldThisTurnByController;
        {
          const v = creaturesThisTurn && typeof creaturesThisTurn === 'object' ? (creaturesThisTurn as any)[ended] : undefined;
          const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0;
          stateAny.creaturesEnteredBattlefieldLastTurnByController = stateAny.creaturesEnteredBattlefieldLastTurnByController || {};
          stateAny.creaturesEnteredBattlefieldLastTurnByController[ended] = n;
        }

        // Persist who this player attacked during their last turn.
        const attackedThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer;
        const attackedList = attackedThisTurnByPlayer && typeof attackedThisTurnByPlayer === 'object'
          ? (attackedThisTurnByPlayer as any)[ended]
          : null;
        if (Array.isArray(attackedList)) {
          stateAny.attackedPlayersLastTurnByPlayer = stateAny.attackedPlayersLastTurnByPlayer || {};
          stateAny.attackedPlayersLastTurnByPlayer[ended] = Array.from(
            new Set(attackedList.map((x: any) => String(x || '').trim()).filter(Boolean))
          );

          // Additional legacy/compat shape used by some intervening-if fallbacks:
          // attackedYouLastTurnByPlayer[defenderId][attackerId] = true
          try {
            stateAny.attackedYouLastTurnByPlayer = stateAny.attackedYouLastTurnByPlayer || {};
            for (const defenderId of stateAny.attackedPlayersLastTurnByPlayer[ended]) {
              const def = String(defenderId || '').trim();
              if (!def) continue;
              stateAny.attackedYouLastTurnByPlayer[def] = stateAny.attackedYouLastTurnByPlayer[def] || {};
              stateAny.attackedYouLastTurnByPlayer[def][ended] = true;
            }
          } catch {
            // best-effort only
          }

          // Clear for future combats in the next cycle.
          (attackedThisTurnByPlayer as any)[ended] = [];
        }

        // Persist whether this player tapped any nonland permanents during their last turn.
        // Conservative: only set `true` on positive evidence; otherwise clear any prior value.
        const tappedNonlandThisTurn = stateAny.tappedNonlandPermanentThisTurnByPlayer;
        const didTapNonland = tappedNonlandThisTurn && typeof tappedNonlandThisTurn === 'object'
          ? (tappedNonlandThisTurn as any)[ended]
          : undefined;
        if (tappedNonlandThisTurn && typeof tappedNonlandThisTurn === 'object') {
          stateAny.tappedNonlandPermanentLastTurnByPlayer = stateAny.tappedNonlandPermanentLastTurnByPlayer || {};
          if (didTapNonland === true) (stateAny.tappedNonlandPermanentLastTurnByPlayer as any)[ended] = true;
          else {
            try {
              delete (stateAny.tappedNonlandPermanentLastTurnByPlayer as any)[ended];
            } catch {
              (stateAny.tappedNonlandPermanentLastTurnByPlayer as any)[ended] = undefined;
            }
          }
          try {
            delete (tappedNonlandThisTurn as any)[ended];
          } catch {
            (tappedNonlandThisTurn as any)[ended] = undefined;
          }
        }

        // Initialize the per-opponent map to `false` for known opponents.
        // This allows "no opponent cast a spell since your last turn ended" to return true/false
        // when the engine has sufficient team information.
        const getTeamId = (pid: string): string | null => {
          if (!pid) return null;
          const direct = stateAny?.team?.[pid] ?? stateAny?.teams?.[pid] ?? stateAny?.playerTeam?.[pid];
          if (typeof direct === 'string' && direct.trim()) return String(direct).trim();
          const playersAll = Array.isArray(stateAny?.players) ? (stateAny.players as any[]) : [];
          const p = playersAll.find((pp: any) => String(pp?.id || '') === String(pid));
          const fromPlayer = p?.team ?? p?.teamId ?? p?.playerTeam;
          if (typeof fromPlayer === 'string' && fromPlayer.trim()) return String(fromPlayer).trim();
          return null;
        };

        const endedTeam = getTeamId(ended);
        const playersAll = Array.isArray(stateAny?.players) ? (stateAny.players as any[]) : [];
        const allIds = playersAll.map((p: any) => String(p?.id || '').trim()).filter(Boolean);
        const anyTeamData = Boolean(allIds.some((pid) => getTeamId(pid)));

        const inner: Record<string, boolean> = {};
        for (const pid of allIds) {
          if (pid === ended) continue;
          const pidTeam = getTeamId(pid);

          let areOpponents: boolean | null;
          if (endedTeam && pidTeam) areOpponents = endedTeam !== pidTeam;
          else if (anyTeamData) areOpponents = null; // don't guess in team games
          else areOpponents = true; // free-for-all

          if (areOpponents === true) inner[pid] = false;
        }

        stateAny.opponentCastSpellSinceYourLastTurnEnded = stateAny.opponentCastSpellSinceYourLastTurnEnded || {};
        stateAny.opponentCastSpellSinceYourLastTurnEnded[ended] = inner;
      }
    } catch {
      // best-effort only
    }
}
