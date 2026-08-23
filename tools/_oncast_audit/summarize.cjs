const rows = require('D:/Git/MTGEDH/tools/_oncast_audit/probe-post.json');
console.log('not irWired:');
for (const r of rows.filter(x => !x.irWired)) {
  console.log('-', r.name, r.resolvedAll);
  console.log('  kinds', r.irKinds);
}
const byPat = {};
for (const r of rows) for (const p of r.patterns) {
  if (!byPat[p]) byPat[p] = [];
  byPat[p].push(r);
}
for (const [k, arr] of Object.entries(byPat).sort((a,b)=>b[1].length-a[1].length)) {
  const names = [...new Set(arr.map(x=>x.name))];
  const wired = arr.filter(x=>x.irWired).length;
  console.log(`\n${k}\tcount=${names.length}\tirWiredFraction=${wired}/${arr.length}`);
  console.log('  examples:', names.slice(0,5).join('; '));
  const needT = arr.filter(x=>x.meta.requiresTarget);
  if (needT.length) {
    const thin = needT.filter(x => x.meta.requiresTarget && !x.meta.targetType && !x.meta.targetZone);
    const missingUpTo = needT.filter(x => /up to /i.test((x.resolvedAll||[]).join(' ')) && (x.meta.minTargets==null));
    console.log('  targeted', needT.length, 'thin', thin.length, 'missingUpTo', missingUpTo.map(x=>x.name));
  }
}
