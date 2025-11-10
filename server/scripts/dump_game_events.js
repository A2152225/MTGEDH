// Node script to inspect mtgedh.sqlite events for a game and player
// Usage: node server/scripts/dump_game_events.js [GAME_ID] [PLAYER_NAME]
// Example: node server/scripts/dump_game_events.js 3 Player

const path = require('path');
const fs = require('fs');

const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const GAME_ID = args[0] || '3';
const PLAYER_NAME = args[1] || 'Player';

// Path to runtime sqlite (adjust if your server uses a different path)
const DB_PATH = path.join(process.cwd(), 'server', 'server', 'data', 'mtgedh.sqlite');

if (!fs.existsSync(DB_PATH)) {
  console.error('ERROR: DB file not found at', DB_PATH);
  process.exit(2);
}

const db = new Database(DB_PATH, { readonly: true });

function parsePayload(payloadText) {
  if (!payloadText) return null;
  try {
    return JSON.parse(payloadText);
  } catch (e) {
    // some payloads might be double-encoded / stringified
    try {
      return JSON.parse(JSON.parse(payloadText));
    } catch (_e) {
      return payloadText;
    }
  }
}

function fetchEvents(gameId, limit = 500) {
  const rows = db.prepare(
    'SELECT id, game_id, seq, type, payload, ts FROM events WHERE game_id = ? ORDER BY id DESC LIMIT ?'
  ).all(gameId, limit);
  return rows.map(r => ({
    id: r.id,
    seq: r.seq,
    type: r.type,
    ts: new Date(r.ts).toISOString(),
    payloadRaw: r.payload,
    payload: parsePayload(r.payload)
  }));
}

function filterEventsByTypes(events, types) {
  const set = new Set(types);
  return events.filter(e => set.has(e.type));
}

function findEventsForPlayer(events, playerNameOrId) {
  // Search payloads for playerId or created_by_name or created_by_id or message referencing playerName
  return events.filter(e => {
    const p = e.payload;
    if (!p) return false;
    if (p.playerId && String(p.playerId) === String(playerNameOrId)) return true;
    if (p.playerId && String(p.playerId).toLowerCase() === String(playerNameOrId).toLowerCase()) return true;
    if (p.created_by_name && String(p.created_by_name).toLowerCase() === String(playerNameOrId).toLowerCase()) return true;
    if (p.created_by_id && String(p.created_by_id) === String(playerNameOrId)) return true;
    // fallback: search JSON string
    try {
      const s = JSON.stringify(p).toLowerCase();
      return s.includes(String(playerNameOrId).toLowerCase());
    } catch (e) {
      return false;
    }
  });
}

function printSummary(events) {
  console.log(`Total events returned: ${events.length}`);
  const counts = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
  console.log('Event counts (top):', counts);
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
    const events = fetchEvents(GAME_ID, 800);
    if (!events.length) {
      console.log(`No events found for game "${GAME_ID}".`);
      process.exit(0);
    }
    printSummary(events);

    // Show all deck/commander/draw/shuffle relevant events
    const interesting = filterEventsByTypes(events, [
      'deckImportResolved', 'setCommander', 'shuffleLibrary', 'drawCards', 'deckApplied', 'deckSaved', 'draw', 'drawCards'
    ]);
    console.log(`Found ${interesting.length} interesting events:`);
    interesting.forEach(prettyPrintEvent);

    // Show events whose payload references the player name (imported deck author, etc)
    const playerEvents = findEventsForPlayer(events, PLAYER_NAME);
    console.log(`\nEvents mentioning player "${PLAYER_NAME}" (${playerEvents.length}):`);
    playerEvents.forEach(prettyPrintEvent);

    // If there was a deckImportResolved for this player, print the first such payload's cards length
    const importEv = events.find(e => e.type === 'deckImportResolved' && (e.payload?.playerId || '').toString() !== '');
    if (importEv) {
      console.log('\nSample deckImportResolved payload (first found):');
      prettyPrintEvent(importEv);
      const cards = (importEv.payload && importEv.payload.cards) || importEv.payload;
      try {
        console.log(' -> resolved cards count:', Array.isArray(cards) ? cards.length : 'N/A');
      } catch (e) { /* noop */ }
    }

    // Show the very latest setCommander and any drawCards that followed
    const latestSetCommander = events.find(e => e.type === 'setCommander');
    if (latestSetCommander) {
      console.log('\nLatest setCommander event:');
      prettyPrintEvent(latestSetCommander);

      // show later events (id > setCommander.id)
      const later = events.filter(e => e.id < latestSetCommander.id); // rows returned desc; smaller id = earlier. adjust
      const draws = later.filter(e => e.type === 'drawCards' || e.type === 'shuffleLibrary');
      console.log(`Events after setCommander (draw/shuffle): ${draws.length}`);
      draws.forEach(prettyPrintEvent);
    } else {
      console.log('\nNo setCommander events found for this game in the log.');
    }

    // Also dump games table info if present
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