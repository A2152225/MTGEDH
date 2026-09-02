const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/client/src/components/GameList.tsx';
const { text, eol } = readText(p);
let next = text;

next = mustReplaceOnce(next,
`import { socket } from "../socket";
import { debug, debugWarn, debugError } from "../utils/debug";
`,
`import { socket } from "../socket";
import { authHeaders } from "../utils/authSessionStorage";
import { debug, debugWarn, debugError } from "../utils/debug";
`, 'GameList import');

next = mustReplaceOnce(next,
`interface GameListProps {
  onJoin: (gameId: string, spectator?: boolean) => void;
  pollMs?: number;
  onRefresh?: () => void;
  currentPlayerId?: string | null;
}
`,
`interface GameListProps {
  onJoin: (gameId: string, spectator?: boolean) => void;
  pollMs?: number;
  onRefresh?: () => void;
  currentPlayerId?: string | null;
  isAdmin?: boolean;
}
`, 'GameList props');

next = mustReplaceOnce(next,
`  const { onJoin, pollMs = 5000, onRefresh, currentPlayerId } = props;
`,
`  const { onJoin, pollMs = 5000, onRefresh, currentPlayerId, isAdmin } = props;
`, 'GameList destructure');

next = mustReplaceOnce(next,
`  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "");
  
  // Check if the current player can delete a specific game
  const canDelete = (game: GameRow): boolean => {
    // Localhost can always delete
    if (isLocalhost) return true;
    // Game creators can delete their games
    if (currentPlayerId && game.createdByPlayerId === currentPlayerId) return true;
    return false;
  };
`,
`  // Check if the current player can delete a specific game
  const canDelete = (game: GameRow): boolean => {
    if (isAdmin) return true;
    if (currentPlayerId && game.createdByPlayerId === currentPlayerId) return true;
    return false;
  };
`, 'GameList canDelete');

next = mustReplaceOnce(next,
`      if (isLocalhost) {
        // Admin endpoint for localhost
        const res = await fetch(\`/admin/games/\${encodeURIComponent(game.id)}\`, { method: "DELETE" });
        if (!res.ok) {
          const txt = await res.text();
          alert("Delete failed: " + txt);
        } else {
          await fetchGames();
        }
      } else if (isCreator) {
`,
`      if (isAdmin) {
        const res = await fetch(\`/admin/games/\${encodeURIComponent(game.id)}\`, {
          method: "DELETE",
          credentials: "include",
          headers: authHeaders(),
        });
        if (!res.ok) {
          const txt = await res.text();
          alert("Delete failed: " + txt);
        } else {
          await fetchGames();
        }
      } else if (isCreator) {
`, 'GameList handleDelete');

next = mustReplaceOnce(next,
`                          isLocalhost ? "Admin delete" :
`,
`                          isAdmin ? "Admin delete" :
`, 'GameList title');

writeText(p, next, eol);
console.log('patched GameList.tsx');
