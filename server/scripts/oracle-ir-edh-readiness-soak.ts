/*
  Thin wrapper — EDH readiness suite via the reusable smoke CLI.
  Prefer: npm run oracle-ir:smoke -- --suite edh-readiness
*/

import { runSmokeCli } from './soak/oracleIrSmokeCli.js';

runSmokeCli(process.argv.slice(2), { suite: 'edh-readiness' }).catch((error) => {
  console.error(error);
  process.exit(1);
});
