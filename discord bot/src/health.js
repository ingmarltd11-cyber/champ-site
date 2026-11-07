const http = require('http');
const { log } = require('./utils/logger');
const { formatUptime } = require('./utils/format');
const ticketStore = require('./utils/ticketStore');
const giveawayStore = require('./utils/giveawayStore');
const { version } = require('../package.json');

// Railway (and most hosts) poll a health endpoint. It must answer while the gateway is still
// connecting, so "not ready" is information in the payload, not a 5xx that kills the deploy.
let cache = { at: 0, value: null };

async function counts() {
  if (cache.value && Date.now() - cache.at < 15000) return cache.value;
  const [stats, giveaways] = await Promise.all([
    ticketStore.getStats().catch(() => null),
    giveawayStore.listGiveaways({ activeOnly: true }).catch(() => []),
  ]);
  cache = {
    at: Date.now(),
    value: {
      openTickets: stats ? stats.openTotal : null,
      closedTickets: stats ? stats.closedTotal : null,
      averageRating: stats ? stats.avgRating : null,
      activeGiveaways: Array.isArray(giveaways) ? giveaways.length : null,
    },
  };
  return cache.value;
}

async function buildPayload({ client, startedAt = Date.now(), shuttingDown = false } = {}) {
  const ready = Boolean(client?.isReady?.());
  const totals = await counts();
  const guilds = client?.guilds?.cache?.size ?? 0;
  return {
    status: shuttingDown ? 'shutting_down' : 'ok',
    ready,
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    uptime: formatUptime(Date.now() - startedAt),
    bot: ready ? { tag: client.user?.tag || null, id: client.user?.id || null } : null,
    guilds,
    pingMs: ready ? Math.max(0, Math.round(client.ws?.ping ?? -1)) : null,
    tickets: totals,
    storage: ticketStore.isSupabaseActive() ? 'supabase' : 'json',
    timestamp: new Date().toISOString(),
  };
}

// Starts only when the host provides a port. A missing port is a normal local run, not an error.
function startHealthServer({ client, startedAt = Date.now(), isShuttingDown = () => false } = {}) {
  const rawPort = process.env.PORT || process.env.HEALTH_PORT;
  if (!rawPort) {
    log.debug('health', 'no PORT/HEALTH_PORT set, health endpoint disabled');
    return null;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    log.warn('health', `invalid port "${rawPort}", health endpoint disabled`);
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(405, JSON.stringify({ error: 'method_not_allowed' }));
    }

    if (pathname === '/' ) {
      return send(200, `Champ bot ${version} — ok\n`, 'text/plain; charset=utf-8');
    }

    if (pathname === '/health' || pathname === '/healthz') {
      try {
        const payload = await buildPayload({ client, startedAt, shuttingDown: isShuttingDown() });
        return send(payload.status === 'shutting_down' ? 503 : 200, JSON.stringify(payload));
      } catch (err) {
        log.warn('health', `payload failed: ${err.message}`);
        return send(200, JSON.stringify({ status: 'ok', ready: Boolean(client?.isReady?.()), version }));
      }
    }

    return send(404, JSON.stringify({ error: 'not_found' }));
  });

  server.on('error', (err) => {
    log.error('health', `could not listen on port ${port}: ${err.message}`);
  });
  server.listen(port, '0.0.0.0', () => {
    log.info('health', `listening on 0.0.0.0:${port} (/health)`);
  });

  return {
    server,
    port,
    close: () =>
      new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
  };
}

module.exports = { buildPayload, startHealthServer };
