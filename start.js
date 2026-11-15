import { Bot } from './yapper.js';
import fs from 'node:fs';
import './social-alerts.js';

// Only create roles in servers with no existing staff-application setup.
const ROLE_FILE = '/data/frieren-role-bootstrap.json';
const REQUIRED_ROLES = [...Array.from({ length: 10 }, (_, i) => 'app-' + (i + 1)), 'Trial Priest'];
const active = new Set();
let pending;
try {
  const saved = JSON.parse(fs.readFileSync(ROLE_FILE, 'utf8'));
  pending = new Set(Array.isArray(saved.pending) ? saved.pending.map(String) : []);
} catch {
  pending = new Set();
}
function save() {
  try {
    fs.writeFileSync(ROLE_FILE, JSON.stringify({ pending: [...pending] }, null, 2));
  } catch (e) { console.error('[frieren-roles] progress save failed:', e.message); }
}

async function provision(bot, rawId) {
  const sid = String(rawId || '');
  if (!sid || active.has(sid)) return;
  active.add(sid);
  try {
    const [roles, channels, categories] = await Promise.all([
      bot.roles(sid), bot.channels(sid), bot.categories(sid)
    ]);
    const names = new Set((roles || []).map(x => String(x.name || '').toLowerCase()));
    const panel = (channels || []).some(x => String(x.name || '').toLowerCase() === 'staff-applications');
    const category = (categories || []).some(x => String(x.name || '').toLowerCase() === 'staff applications');
    const started = (roles || []).some(x =>
      /^app-(?:[1-9]|10)$/i.test(x.name || '') ||
      ['trial priest', 'high priest', 'priest'].includes(String(x.name || '').toLowerCase())
    );
    if (panel || category || (started && !pending.has(sid))) {
      if (pending.delete(sid)) save();
      return;
    }
    if (!pending.has(sid)) { pending.add(sid); save(); }
    let created = 0;
    for (const name of REQUIRED_ROLES) {
      if (names.has(name.toLowerCase())) continue;
      const response = await fetch(
        'https://bots.yapper.website/api/bot/v1/servers/' + encodeURIComponent(sid) + '/roles',
        {
          method: 'POST',
          headers: { authorization: 'Bot ' + bot.token, 'content-type': 'application/json' },
          body: JSON.stringify({ name, mentionable: false }),
          signal: AbortSignal.timeout(30000)
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const err = new Error(body.error || 'role creation HTTP ' + response.status);
        err.status = response.status;
        throw err;
      }
      names.add(name.toLowerCase());
      created++;
    }
    pending.delete(sid);
    save();
    if (created) console.log('[frieren-roles] created ' + created + ' setup roles in new server ' + sid);
  } catch (err) {
    console.error('[frieren-roles] setup failed for ' + sid + ': ' + err.message);
    if (err.status === 403) console.error('[frieren-roles] Frieren needs Manage Roles and sufficient role hierarchy.');
  } finally {
    active.delete(sid);
  }
}

// Keep Frieren's original commands and startup behavior unchanged.
const previousStart = Bot.prototype.start;
Bot.prototype.start = function (...args) {
  if (!this._frierenFreshRoleSetup) {
    this._frierenFreshRoleSetup = true;
    this.on('ready', async () => {
      try {
        for (const server of await this.servers()) await provision(this, server.id);
      } catch (err) {
        console.error('[frieren-roles] initial check failed:', err.message);
      }
    });
    this.on('server_add', event => {
      void provision(this, event.server_id || event.server?.id || event.id);
    });
  }
  return previousStart.apply(this, args);
};

await import('./launch.js');
