// Merge a GitHub traffic/clones snapshot (14-day rolling window) into the
// accumulated history. Same-date buckets get replaced, so re-running within
// the window never double-counts; today's partial bucket firms up tomorrow.
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let stats = { days: {} };
try { stats = JSON.parse(fs.readFileSync('stats.json', 'utf8')); } catch {}
for (const d of snap.clones || []) {
  const day = d.timestamp.slice(0, 10);
  stats.days[day] = { count: d.count, uniques: d.uniques };
}
let total = 0, uniq = 0;
for (const v of Object.values(stats.days)) { total += v.count; uniq += v.uniques; }
stats.total = total;
stats.uniqueSum = uniq;
fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2) + '\n');
// shields.io endpoint schema - unique cloners is the closest thing to installs
fs.writeFileSync('badge.json', JSON.stringify({
  schemaVersion: 1, label: 'installs', message: String(uniq), color: 'd97757',
}) + '\n');
console.log(`clones total ${total}, unique ${uniq}`);
