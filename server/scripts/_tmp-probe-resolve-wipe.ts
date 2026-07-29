import Database from 'better-sqlite3';

const db = new Database('D:/Git/MTGEDH/server/server/data/mtgedh.sqlite', { readonly: true });
const gameId = 'game_554411';

for (const id of [1286641, 1286685, 1286686, 1286687]) {
  const e = db.prepare(`SELECT id, seq, type, payload FROM events WHERE id=?`).get(id) as any;
  console.log('\n====', e.id, e.seq, e.type);
  console.log(e.payload.slice(0, 1500));
}

// Any later events mentioning summon / card id after 1286685
const cardId = '13a4c124-216b-44b1-b49a-3db3f033e4cd_ms5a7pkt_11_30714613';
const later = db.prepare(`
  SELECT id, seq, type, substr(payload,1,250) preview
  FROM events WHERE game_id=? AND id > 1286685 AND payload LIKE '%' || ? || '%'
  ORDER BY id ASC LIMIT 30
`).all(gameId, cardId);
console.log('\n=== later mentions ===');
for (const e of later) console.log(JSON.stringify(e));

const moves = db.prepare(`
  SELECT id, seq, type, substr(payload,1,300) preview
  FROM events WHERE game_id=? AND type='moveResolvedInstantOrSorcery'
  ORDER BY id ASC
`).all(gameId);
console.log('\n=== all moveResolved ===');
for (const e of moves) console.log(JSON.stringify(e));

process.exit(0);
