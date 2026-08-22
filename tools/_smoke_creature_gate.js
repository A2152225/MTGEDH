const fs = require('fs');
// Minimal copy of parser for smoke test without TS compile
const WORD = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
function parse(text) {
  const normalized = String(text||'').replace(/[\u2018\u2019]/g,"'").replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  const sentences = normalized.split(/[.!?\n]+/).map(s=>s.trim()).filter(Boolean);
  let best = null;
  for (const sentence of sentences) {
    const match = sentence.match(/can(?:not|'t)\s+(attack(?:\s+or\s+block)?|block(?:\s+or\s+attack)?)\s+unless\s+you\s+control\s+(?:at\s+least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+or\s+more)?\s+(other\s+)?creatures?\b/i);
    if (!match) continue;
    const actionPhrase = String(match[1]||'').toLowerCase();
    const raw = String(match[2]||'').toLowerCase();
    const min = /^\d+$/.test(raw) ? parseInt(raw,10) : WORD[raw];
    if (!min) continue;
    const candidate = {
      minCreatures: min,
      restrictsAttack: actionPhrase.includes('attack'),
      restrictsBlock: actionPhrase.includes('block'),
      otherOnly: Boolean(match[3]),
    };
    best = candidate;
  }
  return best;
}
console.log('bast', parse("Bast can't attack or block unless you control three or more creatures."));
console.log('attack2', parse("This creature can't attack unless you control 2 or more creatures."));
console.log('other4', parse("~ can't block unless you control four other creatures."));
console.log('neg', parse('Whenever you attack, target attacking creature gets +1/+1.'));
