/*
  Oracle IR smoke / soak CLI.

  Usage (from server/):
    npm run oracle-ir:smoke -- --list
    npm run oracle-ir:smoke -- --suite edh-readiness
    npm run oracle-ir:smoke -- --suite edh-readiness --url http://127.0.0.1:3001/api/oracle-ir/telemetry
    npm run oracle-ir:smoke -- --suite edh-readiness --live
    npm run oracle-ir:edh-readiness:soak
*/

import { parseSmokeArgs, runSmokeSuite } from './oracleIrSmokeCore.js';
import { getSmokeSuite, listSmokeSuites } from './suites/index.js';

export function printSmokeHelp(): void {
  const suites = listSmokeSuites();
  console.log(`Oracle IR smoke / soak

Usage:
  npx tsx scripts/soak/oracleIrSmokeCli.ts --list
  npx tsx scripts/soak/oracleIrSmokeCli.ts --suite <id> [--url <telemetry>] [--out <dir>] [--live]

Suites:`);
  for (const suite of suites) {
    console.log(`  ${suite.id.padEnd(20)} ${suite.title}${suite.description ? ` — ${suite.description}` : ''}`);
  }
  console.log(`
Add a suite: scripts/soak/suites/<name>.ts then register it in scripts/soak/suites/index.ts.
`);
}

export async function runSmokeCli(argv: readonly string[], defaults?: { suite?: string }): Promise<void> {
  const args = parseSmokeArgs(argv, defaults);
  if (args.help) {
    printSmokeHelp();
    return;
  }
  if (args.list) {
    for (const suite of listSmokeSuites()) {
      console.log(`${suite.id}\t${suite.title}`);
    }
    return;
  }

  const suiteId = args.suite;
  if (!suiteId) {
    printSmokeHelp();
    process.exitCode = 1;
    return;
  }

  const suite = getSmokeSuite(suiteId);
  if (!suite) {
    console.error(`Unknown smoke suite "${suiteId}". Use --list.`);
    process.exitCode = 1;
    return;
  }

  await runSmokeSuite(suite, {
    url: args.url,
    outDir: args.outDir,
    live: args.live,
  });
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/oracleIrSmokeCli.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/oracleIrSmokeCli.js');

if (isMain) {
  runSmokeCli(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
