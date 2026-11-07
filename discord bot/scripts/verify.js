// Syntax + config check for every shipped file. No token, no network, no side effects.
// Run with: npm run verify
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fails = 0;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fails += 1;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).trim());
  }
}
console.log(`checked ${files.length} JavaScript file(s)`);

for (const name of ['tickets.json', 'giveaway.json', 'welcome.json']) {
  const file = path.join(ROOT, 'config', name);
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`ok   config/${name}`);
  } catch (err) {
    fails += 1;
    console.error(`FAIL config/${name}: ${err.message}`);
  }
}

for (const name of ['package.json', 'railway.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
    console.log(`ok   ${name}`);
  } catch (err) {
    fails += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

console.log(fails === 0 ? '\nVERIFY OK' : `\nVERIFY FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
