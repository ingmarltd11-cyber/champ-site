const fsp = require('fs/promises');
const path = require('path');
const { DATA_DIR } = require('./jsonStore');
const { log } = require('./logger');

// Transcripts are kept on disk in addition to the DM and the log channel: a closed ticket stays
// readable even if every DM failed or the log channel was cleaned up.
const DIR = path.join(DATA_DIR, 'transcripts');
const KEEP = 500;

async function prune() {
  try {
    const files = (await fsp.readdir(DIR)).filter((name) => name.endsWith('.html'));
    if (files.length <= KEEP) return;
    const stats = await Promise.all(
      files.map(async (name) => ({ name, at: (await fsp.stat(path.join(DIR, name))).mtimeMs }))
    );
    stats.sort((a, b) => b.at - a.at);
    await Promise.all(stats.slice(KEEP).map((entry) => fsp.rm(path.join(DIR, entry.name), { force: true })));
  } catch (err) {
    log.warn('transcripts', `prune failed: ${err.message}`);
  }
}

async function saveTranscript(channel, html, { name } = {}) {
  try {
    await fsp.mkdir(DIR, { recursive: true });
    const base = (name || channel?.name || 'ticket').replace(/[^a-z0-9-]/gi, '-').slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(DIR, `${base}-${stamp}.html`);
    await fsp.writeFile(file, html, 'utf8');
    prune();
    return file;
  } catch (err) {
    log.warn('transcripts', `could not save the transcript: ${err.message}`);
    return null;
  }
}

module.exports = { DIR, saveTranscript };
