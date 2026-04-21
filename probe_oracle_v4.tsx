
import fs from "fs";

function run() {
  const data = JSON.parse(fs.readFileSync("oracle-cards.json", "utf-8"));
  if (data.length > 0) {
    console.log("Keys in first card:", Object.keys(data[0]));
  }
}

run();
