import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitted: Array<{ event: string; payload: any }> = [];
vi.mock('../src/socket', () => ({
  socket: { emit: (event: string, payload: any) => emitted.push({ event, payload }) },
}));
const toastCalls: Array<{ kind: string; message: string }> = [];
vi.mock('../src/components/ToastHost', () => ({
  toast: {
    success: (message: string) => toastCalls.push({ kind: 'success', message }),
    error: (message: string) => toastCalls.push({ kind: 'error', message }),
  },
}));
const apiSave = vi.fn();
vi.mock('../src/utils/serverDeckApi', () => ({
  saveServerDeckViaApi: (...a: any[]) => apiSave(...a),
  deleteServerDeckViaApi: vi.fn(),
  fetchServerDeckDetail: vi.fn(),
  renameServerDeckViaApi: vi.fn(),
  updateServerDeckViaApi: vi.fn(),
}));

import { createDeckManagerModalSaveCacheHandlers } from '../src/components/DeckManagerModal-handlers/deckManagerModalSaveCacheHandlers';

function makeDeps(over: Record<string, unknown> = {}) {
  const state = { serverErr: undefined as string | null | undefined, saving: [] as boolean[] };
  const noop = () => {};
  const deps: any = {
    localText: '1 Sol Ring',
    setLocalErr: noop,
    localName: 'My Deck',
    editingLocalId: null,
    localList: [],
    setLocalList: noop,
    clearEditMode: noop,
    setLocalName: noop,
    setLocalText: noop,
    clearPreview: noop,
    resolveAllFromText: noop,
    setEditingLocalId: noop,
    setEditingServerDeckId: noop,
    setPendingServerEditId: noop,
    setTab: noop,
    canServer: true,
    gameId: undefined,
    cacheCards: false,
    useRestServer: true,
    setSaving: (v: boolean) => state.saving.push(v),
    playerId: 'p1',
    playerName: 'Robert',
    refreshRestServerDecks: async () => {},
    setServerErr: (v: string | null) => { state.serverErr = v; },
    onImportText: noop,
    alsoSaveToServer: false,
    applyServerDeckDetail: noop,
    setUpdatingServer: noop,
    editingServerDeckId: null,
    setServerDecks: noop,
    detail: null,
    setDetail: noop,
    setCachingDeckId: noop,
    saveVisibility: 'private',
    accountUserId: 'acct1',
    ...over,
  };
  return { deps, state };
}

describe('deck manager server save (private decks for logged-in users)', () => {
  beforeEach(() => {
    emitted.length = 0;
    toastCalls.length = 0;
    apiSave.mockReset();
  });

  it('REST save sends the private visibility and the account id, then toasts success', async () => {
    apiSave.mockResolvedValue({ success: true });
    const { deps, state } = makeDeps();
    createDeckManagerModalSaveCacheHandlers(deps).saveServer();
    await new Promise((r) => setTimeout(r, 0));
    expect(apiSave).toHaveBeenCalledTimes(1);
    expect(apiSave.mock.calls[0][0]).toMatchObject({ name: 'My Deck', visibility: 'private', playerId: 'acct1' });
    expect(toastCalls.some((t) => t.kind === 'success')).toBe(true);
    expect(state.saving).toEqual([true, false]);
  });

  it('REST save failure is shown inline and as an error toast (not swallowed)', async () => {
    apiSave.mockRejectedValue(new Error('Authentication required'));
    const { deps, state } = makeDeps();
    createDeckManagerModalSaveCacheHandlers(deps).saveServer();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.serverErr).toBe('Authentication required');
    expect(toastCalls.find((t) => t.kind === 'error')?.message).toContain('Authentication required');
    expect(state.saving).toEqual([true, false]);
  });

  it('in-game save emits saveDeck with the chosen visibility and marks saving', () => {
    const { deps, state } = makeDeps({ gameId: 'g1', useRestServer: false, saveVisibility: 'private' });
    createDeckManagerModalSaveCacheHandlers(deps).saveServer();
    expect(emitted).toEqual([
      { event: 'saveDeck', payload: { gameId: 'g1', name: 'My Deck', list: '1 Sol Ring', cacheCards: false, visibility: 'private' } },
    ]);
    expect(state.saving).toEqual([true]);
  });

  it('tells the user to log in instead of silently doing nothing when there is no account', () => {
    const { deps, state } = makeDeps({ accountUserId: undefined, gameId: 'g1', useRestServer: false });
    createDeckManagerModalSaveCacheHandlers(deps).saveServer();
    expect(emitted).toHaveLength(0);
    expect(state.serverErr).toMatch(/log in/i);
    expect(toastCalls.some((t) => t.kind === 'error' && /log in/i.test(t.message))).toBe(true);
  });

  it('explains when server saving is impossible (no game and no REST access)', () => {
    const { deps, state } = makeDeps({ useRestServer: false, gameId: undefined });
    createDeckManagerModalSaveCacheHandlers(deps).saveServer();
    expect(state.serverErr).toMatch(/join a game or use localhost/i);
    expect(apiSave).not.toHaveBeenCalled();
  });
});