import fs from 'node:fs';
const p = 'D:/Git/MTGEDH/server/src/socket/resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
s = s.replace(
  'import { getResolutionHandlerDeps } from "./resolutionHandlerDeps.js";\n',
  '',
);
s = s.replace(
  `  const deps = getResolutionHandlerDeps();
  const appendCastSpellContinuationEvent = deps.appendCastSpellContinuationEvent;
  const createForwardingGameActionSocket = deps.createForwardingGameActionSocket;
  const restartPlayerCastRequest = deps.restartPlayerCastRequest;
`,
  `  // Lazy deps read avoids static cycle: deps factory defaults import this module.
  const { getResolutionHandlerDeps } = await import("./resolutionHandlerDeps.js");
  const deps = getResolutionHandlerDeps();
  const appendCastSpellContinuationEvent = deps.appendCastSpellContinuationEvent;
  const createForwardingGameActionSocket = deps.createForwardingGameActionSocket;
  const restartPlayerCastRequest = deps.restartPlayerCastRequest;
`,
);
fs.writeFileSync(p, s, 'utf8');
console.log('PREFIX updated for lazy deps');
