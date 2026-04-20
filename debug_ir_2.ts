import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const samples = [
    { name: "Equipment Vehicle", text: "Crew 2 (Tap any number of creatures you control with total power 2 or more: This Vehicle becomes an artifact creature until end of turn. Creatures can't be attached to other permanents.)" }
];

samples.forEach(sample => {
    console.log(`--- ${sample.name} ---`);
    const ir = parseOracleTextToIR(sample.text);
    console.log(JSON.stringify(ir, null, 2));
});
