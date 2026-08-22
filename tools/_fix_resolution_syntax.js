const fs = require('fs');
const path = 'server/src/socket/resolution.ts';
let s = fs.readFileSync(path, 'utf8');
const bad = `debugWarn(1, [Resolution] Invalid target selection: one or more targets not in valid targets list (got=));`;
const good = "debugWarn(1, `[Resolution] Invalid target selection: one or more targets not in valid targets list (got=${JSON.stringify(selections)})`);";
if (!s.includes(bad)) {
  // try find broken variant
  const idx = s.indexOf('Invalid target selection: one or more targets not in valid targets list (got=)');
  console.log('idx', idx);
  console.log(JSON.stringify(s.slice(idx - 40, idx + 120)));
  throw new Error('bad string not found exact');
}
s = s.replace(bad, good);
fs.writeFileSync(path, s);
console.log('fixed');
