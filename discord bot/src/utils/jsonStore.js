const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// Small JSON store used for everything that must survive a restart: giveaways, the
// welcome overrides and the ticket fallback when Supabase is not configured.
// DATA_DIR lets Railway point the files at a mounted volume.
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const queues = new Map();

function fileFor(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[store] could not read ${name}:`, err.message);
    return fallback;
  }
}

function enqueue(name, task) {
  const previous = queues.get(name) || Promise.resolve();
  const next = previous.then(task, task);
  queues.set(name, next.catch(() => {}));
  return next;
}

// Writes go through one promise chain per file, and land through a temp file + rename so a
// crash mid-write never leaves a truncated JSON document behind.
function writeJson(name, value) {
  return enqueue(name, async () => {
    const file = fileFor(name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return value;
  });
}

// Read-modify-write inside the same queue, so two button clicks can never overwrite each other.
function updateJson(name, fallback, mutate) {
  return enqueue(name, async () => {
    const current = readJson(name, fallback);
    const result = await mutate(current);
    const file = fileFor(name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return result;
  });
}

module.exports = { DATA_DIR, readJson, writeJson, updateJson };
