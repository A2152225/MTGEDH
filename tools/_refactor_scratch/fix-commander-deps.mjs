import fs from 'node:fs';
const p = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  'handleCommanderZoneResponse(io, game, gameId, step, {',
  'getResolutionHandlerDeps().handleCommanderZoneResponse(io, game, gameId, step, {',
);
fs.writeFileSync(p, s, 'utf8');
console.log('commander via deps');
