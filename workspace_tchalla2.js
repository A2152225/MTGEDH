const fs = require("fs");
const j = JSON.parse(fs.readFileSync("AllDeckFiles/WakandaForever_MSC.json","utf8"));
const cards = [...(j.data.commander||[]), ...(j.data.mainBoard||[])];
const t = cards.find(c => String(c.name||"").includes("Black Panther") && String(c.name||"").includes("Challa"));
console.log("keys", Object.keys(t||{}).sort().join(","));
console.log("keywords", t && t.keywords);
console.log("hasInd in text", /indestructible/i.test(String(t?.oracleText||t?.text||"")));
