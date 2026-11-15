import { Bot } from './yapper.js';
import fs from 'node:fs';
import './social-alerts.js';

// Only create roles in servers with no existing staff-application setup.
const ROLE_FILE = '/data/frieren-role-bootstrap.json';
const STAFF_FILE = '/data/staff-applications.json';
function hasSavedApplicationSetup(serverId) {
  try {
    const data = JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8'));
    const setup = data.setupConfig?.[serverId];
    return (Array.isArray(setup?.appRoleIds) && setup.appRoleIds.length > 0) ||
      setup?.applicationsOpen === false;
  } catch {
    return false;
  }
}

const REQUIRED_ROLES = [...Array.from({ length: 10 }, (_, i) => 'app-' + (i + 1)), 'Trial Mod'];
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
  if (!sid) return { status: 'skipped', reason: 'No server ID' };
  if (active.has(sid)) return { status: 'in-progress' };
  active.add(sid);
  try {
    const [roles, channels, categories] = await Promise.all([
      bot.roles(sid), bot.channels(sid), bot.categories(sid)
    ]);
    const names = new Set((roles || []).map(x => String(x.name || '').toLowerCase()));
    const panel = (channels || []).some(x => String(x.name || '').toLowerCase() === 'staff-applications');
    const category = (categories || []).some(x => String(x.name || '').toLowerCase() === 'staff applications');
    // A category or a few app-N roles can be leftovers from an incomplete
    // setup. They do not mean the server has finished configuring Frieren.
    // Never change servers with an application panel, saved selections or
    // all ten app roles already present. An interrupted bootstrap is resumed
    // by creating only the role names that are still missing.
    const existingSetup = hasSavedApplicationSetup(sid) && !pending.has(sid);
    const tenRolesAlreadyExist = REQUIRED_ROLES.slice(0, 10)
      .every(name => names.has(name.toLowerCase()));

    if (panel || existingSetup || (tenRolesAlreadyExist && !pending.has(sid))) {
      if (pending.delete(sid)) save();
      return {
        status: 'skipped',
        reason: panel ? '#staff-applications already exists' :
          existingSetup ? 'saved staff-application configuration found' :
          'ten application roles already exist'
      };
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
    return { status: 'created', created };
  } catch (err) {
    console.error('[frieren-roles] setup failed for ' + sid + ': ' + err.message);
    if (err.status === 403) console.error('[frieren-roles] Frieren needs Manage Roles and sufficient role hierarchy.');
    return { status: 'error', error: String(err?.message || err).slice(0, 240), code: err?.status || null };
  } finally {
    active.delete(sid);
  }
}

// Authorized /frierensetup overview calls may retry a failed bootstrap and show the reason.
Bot.prototype.provisionFreshRoles = function (serverId) {
  return provision(this, serverId);
};

// Keep Frieren's original commands and startup behavior unchanged.
const previousStart = Bot.prototype.start;
Bot.prototype.start = function (...args) {
  if (!this._frierenFreshRoleSetup) {
    this._frierenFreshRoleSetup = true;
    this.on('ready', () => {
      void (async () => {
        try {
          for (const server of await this.servers()) await provision(this, server.id);
        } catch (err) {
          console.error('[frieren-roles] initial check failed:', err.message);
        }
      })();
    });
    this.on('server_add', event => {
      void provision(this, event.server_id || event.server?.id || event.id);
    });
  }
  return previousStart.apply(this, args);
};

await import('./launch.js');
