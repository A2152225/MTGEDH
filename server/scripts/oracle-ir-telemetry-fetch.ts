/*
  Fetch live Oracle IR gap telemetry from a running server (task D2 live soak).

  Usage (from server/):
    npm run dev   # or beta deployment
    npx tsx scripts/oracle-ir-telemetry-fetch.ts
    npx tsx scripts/oracle-ir-telemetry-fetch.ts --url http://127.0.0.1:3001/api/oracle-ir/telemetry
    npx tsx scripts/oracle-ir-telemetry-fetch.ts --out scripts/out/telemetry-snapshot.json
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.join(__dirname, 'out', 'telemetry-snapshot.json');

function parseArgs(argv: string[]): { url: string; outPath: string } {
  let url = `http://127.0.0.1:${process.env.PORT || 3001}/api/oracle-ir/telemetry`;
  let outPath = defaultOut;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      url = argv[++i];
    } else if (arg === '--out' && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    }
  }

  return { url, outPath };
}

async function main(): Promise<void> {
  const { url, outPath } = parseArgs(process.argv.slice(2));
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  const snapshot = await response.json();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Wrote telemetry snapshot (${snapshot.totalEvents ?? 0} events) to ${outPath}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
