import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';

const onStatus = ({ phase, message }: { phase: string; message: string }) => {
  console.log(`[${phase}] ${message}`);
};

console.log('Rebuilding local card lookup database...');
ensureLocalCardLookupIndexSync({ onStatus });
console.log('Done.');
