
import fs from "fs";
const data = JSON.parse(fs.readFileSync("oracle-cards.json", "utf-8"));
const target = "copy the exiled card. You may cast the copy without paying its mana cost";
const matches = data.filter((c: any) => c.oracle_text && c.oracle_text.includes(target)).map((c: any) => c.name);
console.log(matches);
