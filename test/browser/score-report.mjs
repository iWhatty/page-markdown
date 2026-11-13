import fs from 'node:fs';
import { scoreReport } from './report-score.mjs';
try {
  if (process.argv.length !== 3) throw new Error('Usage: node test/browser/score-report.mjs report.json');
  const summary = scoreReport(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === 'PASS' ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ status: 'FAIL', error: String(error.message || error) }));
  process.exitCode = 1;
}
