// Review/resolve player issue reports:  npm --workspace @mtgedh/server run issues -- list
import { ensureIssueDbForCli, runIssuesCli } from '../src/db/issueReportsCli.js';
import { closeIssueReportsDb } from '../src/db/issueReports.js';

ensureIssueDbForCli();
const code = runIssuesCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
closeIssueReportsDb();
process.exit(code);