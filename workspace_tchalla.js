const fs = require("fs");
const j = JSON.parse(fs.readFileSync("AllDeckFiles/WakandaForever_MSC.json","utf8"));
const cards = [...(j.data.commander||[]), ...(j.data.mainBoard||[])];
const t = cards.find(c => String(c.name||"").includes("Black Panther") && String(c.name||"").includes("Challa"));
if (!t) { console.log("not found names:", cards.filter(c=>String(c.name||"").toLowerCase().includes("challa")||String(c.name||"").toLowerCase().includes("panther")).map(c=>c.name).slice(0,20)); process.exit(0); }
console.log(JSON.stringify({ name: t.name, oracle: t.oracleText || t.oracle_text, text: t.text, keywords: t.keywords }, null, 2));
