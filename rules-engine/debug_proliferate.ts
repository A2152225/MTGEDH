import { parseOracleTextToIR } from './src/oracleIRParser';
import { PROLIFERATE_REMINDER_REGEXES } from './src/keywordActions/proliferate';

const text = 'Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)';
const name = 'Spread the Sickness';
const ir = parseOracleTextToIR(text, name);

const ability = ir.abilities[0];
console.log('Ability has proliferate step: ' + ability.steps.some(function(s) { return s.kind === 'proliferate'; }));
console.log('Filtered step kinds: ' + JSON.stringify(ability.steps.map(function(s) { return s.kind; }).filter(function(k) { return k === 'proliferate'; })));

ability.steps.forEach(function(step, i) {
    const raw = step.raw;
    const normalized = raw.toLowerCase().replace(/\s\([^)]+\)/g, '').replace(/[.,]$/, '').trim();
    
    console.log('Step ' + i + ':');
    console.log('  kind: ' + step.kind);
    console.log('  raw: ' + raw);
    console.log('  is unknown: ' + (step.kind === 'unknown'));
    console.log('  normalized: ' + normalized);
    
    PROLIFERATE_REMINDER_REGEXES.forEach(function(re, j) {
        console.log('  regex ' + j + ' match: ' + re.test(raw));
    });
});
