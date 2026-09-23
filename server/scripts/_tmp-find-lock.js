const {execSync}=require('child_process');  
console.log(execSync('tasklist /V',{encoding:'utf8'}).split(/\r?\n/).filter(l= 
