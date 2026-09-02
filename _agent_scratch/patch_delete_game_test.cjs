const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/server/tests/delete-game.authorization.integration.test.ts';
const { text, eol } = readText(p);
let next = text;
next = mustReplaceOnce(next,
`  it('does not throw when payload is missing (crash-safety)', async () => {
`,
`  it('allows an authenticated admin to deleteGame they did not create', async () => {
    const creator = 'p_creator_admin';
    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(
      { playerId: 'p_admin', spectator: false, accountIsAdmin: true, accountUserId: 'user_admin' },
      emitted,
    );

    const io = createMockIo(emitted);
    registerGameManagementHandlers(io as any, socket as any);

    await handlers['deleteGame']({ gameId, claimedPlayerId: 'p_admin' });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    const ack = emitted.find(e => e.event === 'gameDeletedAck');
    expect(ack?.payload?.gameId).toBe(gameId);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
`, 'delete-game admin test');
writeText(p, next, eol);
console.log('patched delete-game tests');
