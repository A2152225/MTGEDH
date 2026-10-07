import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { createInitialGameState } from '../src/state/index.js';
import { games } from '../src/socket/socket.js';
import { initDb } from '../src/db/index.js';

function load(file: string, id: string) {
  const db = new Database(file, { readonly: true });
  const rows = db.prepare("SELECT type, payload FROM events WHERE game_id='game_muxjp9tq' ORDER BY id ASC").all() as any[];
  db.close();
  const game: any = createInitialGameState(id as any);
  game.replay(rows.map((r) => ({ type: r.type, ...(JSON.parse(r.payload || '{}')) })));
  games.set(id as any, game);
  return game;
}
function names(game: any) {
  const pn = (pid: string) => (game.state.players.find((p: any) => p.id === pid)?.name || pid);
  return game.state.battlefield.filter((p: any) => /creature/i.test(p.card?.type_line || '')).map((p: any) => `${pn(p.controller)}:${p.card?.name}[mv${p.card?.cmc}]${p.isCommander ? '(C)' : ''}`);
}
const which = process.env.PROBE_WHICH || 'nova';
describe('probe replay', () => {
  it(which, async () => {
    await initDb();
    const game = load(`D:/Git/MTGEDH/_agent_scratch/db/${which}.sqlite`, 'probe_replay_' + which);
    console.log('STACK', JSON.stringify((game.state.stack || []).map((s: any) => ({ id: s.id, name: s.card?.name, modes: s.selectedModes, desc: s.selectedModeDescriptions }))));
    console.log('BEFORE', names(game).length, JSON.stringify(names(game)));
    const nonCreat = game.state.battlefield.filter((p: any) => /artifact|enchantment/i.test(p.card?.type_line || '')).map((p: any) => p.card?.name);
    console.log('ART/ENCH BEFORE', nonCreat.length, JSON.stringify(nonCreat));
    game.resolveTopOfStack();
    console.log('AFTER', names(game).length, JSON.stringify(names(game)));
    const nonCreat2 = game.state.battlefield.filter((p: any) => /artifact|enchantment/i.test(p.card?.type_line || '')).map((p: any) => p.card?.name);
    console.log('ART/ENCH AFTER', nonCreat2.length, JSON.stringify(nonCreat2));
  });
});
