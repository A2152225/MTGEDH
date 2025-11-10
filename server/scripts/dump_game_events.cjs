// Node script to inspect mtgedh.sqlite events for a game and player
// Usage: node server/scripts/dump_game_events.cjs [GAME_ID] [PLAYER_NAME]
// Example: node server/scripts/dump_game_events.cjs 3 Player

const path = require('path');
const fs = require('fs');

const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const GAME_ID = args[0] || '3';
const PLAYER_NAME = args[1] || 'Player';

// Path to runtime sqlite (adjust if your server uses a different path)
// Common runtime locations examined earlier: server/server/data/mtgedh.sqlite or server/data/mtgedh.sqlite
const CANDIDATES = [
  path.join(process.cwd(), 'server', 'server', 'data', 'mtgedh.sqlite'),
  path.join(process.cwd(), 'server', 'data', 'mtgedh.sqlite'),
  path.join(process.cwd(), 'server', 'mtgedh.sqlite'),
  path.join(process.cwd(), 'data', 'mtgedh.sqlite'),
];

let DB_PATH = CANDIDATES.find(p => fs.existsSync(p));
if (!DB_PATH) {
  console.error('ERROR: DB file not found in expected locations:');
  console.error(CANDIDATES.join('\n'));
  process.exit(2);
}

console.log('Using DB file:', DB_PATH);

const db = new Database(DB_PATH, { readonly: true });

function safeParseJSON(payloadText) {
  if (!payloadText) return null;
  try { return JSON.parse(payloadText); } catch (e) {
    try { return JSON.parse(JSON.parse(payloadText)); } catch (e2) { return payloadText; }
  }
}

function fetchEvents(gameId, limit = 1000) {
  const stmt = db.prepare('SELECT id, game_id, seq, type, payload, ts FROM events WHERE game_id = ? ORDER BY id DESC LIMIT ?');
  const rows = stmt.all(gameId, limit);
  return rows.map(r => ({
    id: r.id,
    seq: r.seq,
    type: r.type,
    ts: new Date(r.ts).toISOString(),
    payloadRaw: r.payload,
    payload: safeParseJSON(r.payload)
  }));
}

function printSummary(events) {
  console.log(`Total events returned: ${events.length}`);
  const counts = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
  console.log('Event counts:', counts);
  console.log('--- latest 50 events (descending id) ---');
  events.slice(0, 50).forEach(e => {
    console.log(`#${e.id} seq=${e.seq} type=${e.type} ts=${e.ts}`);
  });
  console.log('---------------------------------------');
}

function prettyPrintEvent(e) {
  console.log('--- EVENT --------------------------------------------');
  console.log(`#${e.id} seq=${e.seq} type=${e.type} ts=${e.ts}`);
  console.log('payload:', JSON.stringify(e.payload, null, 2));
}

(function main() {
  try {
    const events = fetchEvents(GAME_ID, 2000);
    if (!events.length) {
      console.log(`No events found for game "${GAME_ID}".`);
      process.exit(0);
    }

    printSummary(events);

    // Interested event types
    const interestingTypes = [
      'deckImportResolved',
      'setCommander',
      'shuffleLibrary',
      'drawCards',
      'deckApplied',
      'deckSaved',
      'beginCast',
      'castCommander',
      'selectFromLibrary',
      'handIntoLibrary',
      'importDeckResolved'
    ];

    const interesting = events.filter(e => interestingTypes.includes(e.type));
    console.log(`\nFound ${interesting.length} interesting events:`);
    interesting.forEach(prettyPrintEvent);

    // Events mentioning the player (by id/name)
    const playerEvents = events.filter(e => {
      const p = e.payload;
      if (!p) return false;
      try {
        const s = JSON.stringify(p).toLowerCase();
        if (s.includes(String(PLAYER_NAME).toLowerCase())) return true;
        if (p.playerId && String(p.playerId).toLowerCase() === String(PLAYER_NAME).toLowerCase()) return true;
        if (p.created_by_id && String(p.created_by_id).toLowerCase() === String(PLAYER_NAME).toLowerCase()) return true;
        if (p.created_by_name && String(p.created_by_name).toLowerCase() === String(PLAYER_NAME).toLowerCase()) return true;
      } catch (e) {}
      return false;
    });

    console.log(`\nEvents mentioning player "${PLAYER_NAME}" (${playerEvents.length}):`);
    playerEvents.forEach(prettyPrintEvent);

    // Show the very latest setCommander and subsequent draw/shuffle events (by id ordering)
    const latestSetCommander = events.find(e => e.type === 'setCommander');
    if (latestSetCommander) {
      console.log('\nLatest setCommander event:');
      prettyPrintEvent(latestSetCommander);

      // Since rows are returned desc, events that occurred after will have id > latestSetCommander.id
      const later = fetchEvents(GAME_ID, 2000).filter(e => e.id > latestSetCommander.id);
      const draws = later.filter(e => e.type === 'drawCards' || e.type === 'shuffleLibrary');
      console.log(`Events after setCommander (draw/shuffle): ${draws.length}`);
      draws.forEach(prettyPrintEvent);
    } else {
      console.log('\nNo setCommander events found for this game in the log.');
    }

    // If there was a deckImportResolved for this player, print sample
    const importEv = events.find(e => e.type === 'deckImportResolved' && e.payload && (e.payload.playerId || e.payload.playerId === PLAYER_NAME));
    if (importEv) {
      console.log('\nSample deckImportResolved payload (first found):');
      prettyPrintEvent(importEv);
      const cards = (importEv.payload && importEv.payload.cards) || importEv.payload;
      console.log(' -> resolved cards count:', Array.isArray(cards) ? cards.length : 'N/A');
    } else {
      console.log('\nNo deckImportResolved event explicitly found in the last events snapshot.');
    }

    // games table info
    try {
      const gameRow = db.prepare('SELECT * FROM games WHERE game_id = ?').get(GAME_ID);
      console.log('\ngames table row for this game:', gameRow || '(not found)');
    } catch (e) { /* ignore */ }

    process.exit(0);
  } catch (err) {
    console.error('Error while reading DB:', err);
    process.exit(1);
  }
})();