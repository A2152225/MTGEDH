const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');

{
  const p = 'D:/Git/MTGEDH/server/src/socket/game-management.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`      // Check if the player is the creator of the game (validated against DB record)
      const isCreator = playerId ? isGameCreator(gameId, playerId) : false;
`,
`      // Check if the player is the creator of the game (validated against DB record)
      const isCreator = playerId ? isGameCreator(gameId, playerId) : false;
      const isAdmin = (socket.data as any)?.accountIsAdmin === true;
`, 'game-management isAdmin');
  next = mustReplaceOnce(next,
`      // Allow delete only for the creator (validated via DB).
      if (!isCreator) {
        socket.emit("error", {
          code: "DELETE_GAME_NOT_AUTHORIZED",
          message: "Only the game creator can delete this game.",
        });
        return;
      }
`,
`      // Allow delete for the creator (validated via DB) or an authenticated admin.
      if (!isCreator && !isAdmin) {
        socket.emit("error", {
          code: "DELETE_GAME_NOT_AUTHORIZED",
          message: "Only the game creator can delete this game.",
        });
        return;
      }
`, 'game-management auth');
  writeText(p, next, eol);
  console.log('patched game-management.ts');
}

{
  const p = 'D:/Git/MTGEDH/server/src/index.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`import { registerAuthHttpRoutes } from "./auth/authHttp.js";
import { registerDeckHttpRoutes } from "./decks/decksHttp.js";
`,
`import { registerAuthHttpRoutes } from "./auth/authHttp.js";
import { isLoopbackSocket } from "./auth/loopback.js";
import { getRequestAuthUser, userIsAdmin } from "./auth/requestUser.js";
import { registerDeckHttpRoutes } from "./decks/decksHttp.js";
`, 'index imports');

  const helper = `
function canUseAdminHttp(req: { socket?: { remoteAddress?: string } }): boolean {
  if (userIsAdmin(getRequestAuthUser(req as any))) return true;
  return isLoopbackSocket(req);
}

`;

  next = mustReplaceOnce(next,
`// API: list house rule suggestions (admin only - localhost)
`,
 helper + `// API: list house rule suggestions (admin only - localhost)
`, 'index helper insert');

  next = mustReplaceOnce(next,
`app.delete("/admin/games/:id", (req, res) => {
  try {
    // Determine requester IP (works for direct connections). If behind proxy, adjust trust proxy as needed.
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
`,
`app.delete("/admin/games/:id", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
`, 'index delete one game');

  next = mustReplaceOnce(next,
`app.delete("/admin/games", (req, res) => {
  try {
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
`,
`app.delete("/admin/games", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
`, 'index delete all games');

  writeText(p, next, eol);
  console.log('patched index.ts');
}
