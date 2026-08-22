const fs = require('fs');
const path = 'client/src/components/CombatControlModal.tsx';
let s = fs.readFileSync(path, 'utf8');

// Import
if (!s.includes('getControlledCreatureCombatGateReason')) {
  s = s.replace(
    'getCounterCombatRestrictionReason,',
    'getCounterCombatRestrictionReason, getControlledCreatureCombatGateReason,'
  );
  console.log('import updated');
} else {
  console.log('import ok');
}

// Attack reasons - insert gate reason before counter reason
if (!s.includes("getControlledCreatureCombatGateReason(perm, battlefield, 'attack')")) {
  s = s.replace(
    "|| getCounterCombatRestrictionReason(perm, battlefield, 'attack')",
    "|| getControlledCreatureCombatGateReason(perm, battlefield, 'attack')\n      || getCounterCombatRestrictionReason(perm, battlefield, 'attack')"
  );
  console.log('attack reason updated');
} else {
  console.log('attack reason ok');
}

if (!s.includes("getControlledCreatureCombatGateReason(perm, battlefield, 'block')")) {
  s = s.replace(
    "blockReason = blockReason || getCounterCombatRestrictionReason(perm, battlefield, 'block') || \"Can't block\";",
    "blockReason = blockReason\n      || getControlledCreatureCombatGateReason(perm, battlefield, 'block')\n      || getCounterCombatRestrictionReason(perm, battlefield, 'block')\n      || \"Can't block\";"
  );
  console.log('block reason updated');
} else {
  console.log('block reason ok');
}

fs.writeFileSync(path, s);

// App.tsx crude checks?
const app = fs.readFileSync('client/src/App.tsx', 'utf8');
const hits = [];
let idx = 0;
while ((idx = app.indexOf("can't block", idx)) !== -1) {
  hits.push(app.slice(Math.max(0, idx - 60), idx + 80).replace(/\s+/g, ' '));
  idx += 10;
}
console.log('App cant-block hits', hits.length);
hits.slice(0, 5).forEach((h, i) => console.log(i, h));
