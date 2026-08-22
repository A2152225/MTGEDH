const fs = require("fs");
const j = JSON.parse(fs.readFileSync("AllDeckFiles/WakandaForever_MSC.json","utf8"));
const cards = [...(j.data.commander||[]), ...(j.data.mainBoard||[])];
for (const namePart of ["Bast", "Animist", "Angel Armor", "Deathmantle"]) {
  const hits = cards.filter(c => String(c.name||"").includes(namePart));
  for (const t of hits.slice(0,3)) {
    console.log("---", t.name);
    console.log(String(t.text||t.oracleText||"").slice(0,400));
  }
}
