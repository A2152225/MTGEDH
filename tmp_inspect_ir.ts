import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";
const ir = parseOracleTextToIR("All creatures are tokens. (They're considered tokens for spells and abilities. After a creature leaves the battlefield, it ceases to exist.)", "Intangible Vibes");
console.log(JSON.stringify(ir, null, 2));
