import { Bot } from './yapper.js';
import fs from 'node:fs';

const FILE = '/data/social-alerts.json';
const STAFF_FILE = '/data/staff-applications.json';
const OWNER = process.env.FRIEREN_OWNER_ID || null;
const YT_KEY = process.env.YOUTUBE_API_KEY || null;
const TWITCH_ID = process.env.TWITCH_CLIENT_ID || null;
const TWITCH_SECRET = process.env.TWITCH_CLIENT_SECRET || null;
const POLL_MS = Math.max(30000, Number(process.env.SOCIAL_ALERT_POLL_MS || 120000));
const originalStart = Bot.prototype.start;
let started = false;
let busy = false;
let twitchToken = null;

const wait = ms => new Promise(r => setTimeout(r, ms));

function load() {
  try {
    if (!fs.existsSync(FILE)) return { servers: {} };
    const x = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { servers: x?.servers || {} };
  } catch (err) {
    console.error('[socialalerts] load:', err.message);
    return { servers: {} };
  }
}
const db = load();
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); }
  catch (err) { console.error('[socialalerts] save:', err.message); }
}
function list(serverId) {
  const k = String(serverId);
  if (!Array.isArray(db.servers[k])) db.servers[k] = [];
  return db.servers[k];
}
function userId(ctx) { return ctx?.user_id || ctx?.author_id || ctx?.user?.id || ctx?.author?.id || null; }

async function serverId(bot, ctx) {
  if (ctx?.server_id) return String(ctx.server_id);
  for (const s of await bot.servers()) {
    try {
      const cs = await bot.channels(s.id);
      if ((cs || []).some(c => String(c.id) === String(ctx?.channel_id))) return String(s.id);
    } catch {}
  }
  return null;
}
function roleIds(member) {
  const set = new Set((member?.role_ids || []).map(String));
  for (const r of member?.roles || []) {
    if (typeof r === 'string') set.add(String(r));
    else if (r?.id) set.add(String(r.id));
  }
  return set;
}
function staffIds(sid) {
  try {
    const x = JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8'));
    return (x?.staffConfig?.[sid]?.staffRoleIds || []).map(String);
  } catch { return []; }
}
async function allowed(bot, sid, uid) {
  if (!uid) return false;
  if (OWNER && String(uid) === String(OWNER)) return true;
  try {
    const [m, servers] = await Promise.all([bot.member(sid, uid), bot.servers()]);
    const s = (servers || []).find(x => String(x.id) === String(sid));
    const owners = [s?.owner_id, s?.ownerId, s?.owner?.id, s?.creator_id, s?.created_by].filter(Boolean).map(String);
    if (owners.includes(String(uid))) return true;
    if (m?.administrator === true || m?.admin === true || m?.permissions?.includes?.('administrator') || m?.permissions?.includes?.('admin')) return true;
    const mine = roleIds(m);
    return staffIds(sid).some(id => mine.has(id));
  } catch { return false; }
}

function platform(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (h === 'twitch.tv' || h.endsWith('.twitch.tv')) return 'twitch';
    if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') return 'youtube';
    if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  } catch {}
  return null;
}
function normalize(url, p) {
  const u = new URL(url); u.search = ''; u.hash = '';
  const ps = u.pathname.split('/').filter(Boolean);
  if (p === 'twitch') {
    if (!ps[0]) throw new Error('Use a Twitch channel URL.');
    return `https://www.twitch.tv/${ps[0]}`;
  }
  if (p === 'tiktok') {
    const h = ps.find(x => x.startsWith('@'));
    if (!h) throw new Error('Use a TikTok profile URL like https://www.tiktok.com/@creator');
    return `https://www.tiktok.com/${h}`;
  }
  if (!ps[0]) throw new Error('Use a YouTube channel URL.');
  return `https://www.youtube.com/${ps.join('/')}`;
}
async function destination(bot, sid, token) {
  const cs = await bot.channels(sid);
  const raw = String(token || '').trim();
  const key = raw.match(/^<#([^>]+)>$/)?.[1] || raw.replace(/^#/, '');
  return (cs || []).find(c => String(c.id) === key) ||
    (cs || []).find(c => String(c.name || '').toLowerCase() === key.toLowerCase()) || null;
}
async function fetchText(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FrierenYapperBot/1.0)', 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}
function decode(s='') { return String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function clean(s='') { return decode(String(s).replace(/<[^>]+>/g,'')).trim(); }
function template(p) {
  if (p === 'twitch') return '🔴 {channel} is live!\n**{title}**\n{url}';
  if (p === 'youtube') return '📺 {channel} posted/is live!\n**{title}**\n{url}';
  return '🎵 {channel} posted!\n**{title}**\n{url}';
}
function render(t, e) {
  return String(t || '').replace(/\{channel\}/gi,e.channel || 'Unknown channel').replace(/\{url\}/gi,e.url || '').replace(/\{title\}/gi,e.title || 'Untitled').slice(0,1900);
}

async function youtubeChannelId(alert) {
  if (alert.youtubeChannelId) return alert.youtubeChannelId;
  const ps = new URL(alert.sourceUrl).pathname.split('/').filter(Boolean);
  if (ps[0] === 'channel' && ps[1]) return (alert.youtubeChannelId = ps[1]);
  if (YT_KEY) {
    const q = new URLSearchParams({ part: 'id', key: YT_KEY });
    if (ps[0]?.startsWith('@')) q.set('forHandle', ps[0]);
    else if (ps[0] === 'user' && ps[1]) q.set('forUsername', ps[1]);
    if ([...q.keys()].some(k => k === 'forHandle' || k === 'forUsername')) {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?${q}`);
      if (r.ok) {
        const id = (await r.json())?.items?.[0]?.id;
        if (id) return (alert.youtubeChannelId = id);
      }
    }
  }
  const html = await fetchText(alert.sourceUrl);
  for (const re of [/"channelId":"(UC[\w-]{20,})"/, /"externalId":"(UC[\w-]{20,})"/, /youtube\.com\/channel\/(UC[\w-]{20,})/]) {
    const m = html.match(re); if (m) return (alert.youtubeChannelId = m[1]);
  }
  throw new Error('Could not resolve that YouTube channel. Try its /channel/UC... URL.');
}
async function youtubeState(id) {
  if (YT_KEY) {
    try {
      const q = new URLSearchParams({ part: 'snippet,liveStreamingDetails', id, key: YT_KEY });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?${q}`);
      if (r.ok) {
        const s = (await r.json())?.items?.[0]?.snippet?.liveBroadcastContent;
        if (s === 'live' || s === 'upcoming') return s;
      }
    } catch {}
  }
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${id}`);
    if (/"isLiveNow":true/.test(html)) return 'live';
    if (/"isUpcoming":true/.test(html)) return 'upcoming';
  } catch {}
  return 'video';
}
async function youtubeStatus(alert) {
  const id = await youtubeChannelId(alert);
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);
  const e = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!e) throw new Error('No recent YouTube videos found.');
  const videoId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1];
  const title = clean(e.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || 'Untitled');
  const url = decode(e.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)?.[1] || `https://www.youtube.com/watch?v=${videoId}`);
  const channel = clean(e.match(/<name>([\s\S]*?)<\/name>/i)?.[1] || 'YouTube channel');
  return { id: videoId, title, url, channel, state: await youtubeState(videoId) };
}

function twitchLogin(url) { return new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase() || null; }
async function twitchAccess() {
  if (!TWITCH_ID || !TWITCH_SECRET) throw new Error('Twitch alerts need TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Railway.');
  if (twitchToken && twitchToken.exp > Date.now() + 60000) return twitchToken.value;
  const q = new URLSearchParams({ client_id: TWITCH_ID, client_secret: TWITCH_SECRET, grant_type: 'client_credentials' });
  const r = await fetch(`https://id.twitch.tv/oauth2/token?${q}`, { method:'POST' });
  if (!r.ok) throw new Error(`Twitch auth failed (${r.status}).`);
  const j = await r.json(); twitchToken = { value:j.access_token, exp:Date.now()+Number(j.expires_in || 3600)*1000 };
  return twitchToken.value;
}
async function twitchApi(path) {
  let token = await twitchAccess();
  let r = await fetch(`https://api.twitch.tv/helix${path}`, { headers:{ 'Client-Id':TWITCH_ID, Authorization:`Bearer ${token}` } });
  if (r.status === 401) { twitchToken = null; token = await twitchAccess(); r = await fetch(`https://api.twitch.tv/helix${path}`, { headers:{ 'Client-Id':TWITCH_ID, Authorization:`Bearer ${token}` } }); }
  if (!r.ok) throw new Error(`Twitch API failed (${r.status}).`);
  return r.json();
}
async function twitchStatus(alert) {
  const login = alert.creatorLogin || twitchLogin(alert.sourceUrl);
  if (!alert.twitchUserId) {
    const u = (await twitchApi(`/users?login=${encodeURIComponent(login)}`))?.data?.[0];
    if (!u) throw new Error('Twitch channel not found.');
    alert.twitchUserId=u.id; alert.creatorLogin=u.login; alert.creatorName=u.display_name || u.login;
  }
  const s = (await twitchApi(`/streams?user_id=${encodeURIComponent(alert.twitchUserId)}`))?.data?.[0] || null;
  const url = `https://www.twitch.tv/${alert.creatorLogin || login}`;
  if (!s) return { live:false, id:null, channel:alert.creatorName || login, title:'', url };
  return { live:true, id:String(s.id), channel:s.user_name || alert.creatorName, title:s.title || 'Live now', url };
}

function collectTikTok(v,out,d=0) {
  if (!v || d>14) return;
  if (Array.isArray(v)) { for (const x of v) collectTikTok(x,out,d+1); return; }
  if (typeof v !== 'object') return;
  const id = v.id && /^\d{15,22}$/.test(String(v.id)) ? String(v.id) : null;
  const title = typeof v.desc === 'string' ? v.desc : typeof v.title === 'string' ? v.title : null;
  const channel = v?.author?.uniqueId || v?.author?.nickname || null;
  if (id && (title !== null || channel)) out.push({id,title:title || 'New TikTok',channel,t:Number(v.createTime || 0)});
  for (const x of Object.values(v)) if (x && typeof x === 'object') collectTikTok(x,out,d+1);
}
async function tiktokStatus(alert) {
  const handle = new URL(alert.sourceUrl).pathname.split('/').filter(Boolean).find(x=>x.startsWith('@'));
  const html = await fetchText(alert.sourceUrl), found=[];
  for (const re of [/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i,/<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i]) {
    const raw=html.match(re)?.[1]; if (!raw) continue;
    try { collectTikTok(JSON.parse(decode(raw)),found); } catch {}
  }
  let x=found.sort((a,b)=>b.t-a.t)[0];
  if (!x) { const id=html.match(/\/video\/(\d{15,22})/)?.[1]; if (!id) throw new Error('TikTok did not expose recent videos to Frieren. TikTok monitoring is best-effort.'); x={id,title:'New TikTok',channel:handle?.replace(/^@/,'')}; }
  return { id:x.id, title:x.title || 'New TikTok', channel:x.channel || handle?.replace(/^@/,'') || 'TikTok creator', url:`https://www.tiktok.com/${handle}/video/${x.id}` };
}

async function status(alert) {
  if (alert.platform==='youtube') return youtubeStatus(alert);
  if (alert.platform==='twitch') return twitchStatus(alert);
  return tiktokStatus(alert);
}
function prime(alert,s) {
  alert.initialized=true; alert.creatorName=s.channel || alert.creatorName;
  if (alert.platform==='twitch') { if (s.live) alert.lastLiveId=s.id; return; }
  alert.lastSeenId=s.id;
  if (alert.platform==='youtube' && s.state==='live') alert.liveNotifiedId=s.id;
}
function event(alert,s) {
  alert.creatorName=s.channel || alert.creatorName;
  if (alert.platform==='twitch') {
    if (!s.live || String(alert.lastLiveId || '')===String(s.id)) return null;
    alert.lastLiveId=s.id; return s;
  }
  if (alert.platform==='youtube') {
    if (String(alert.lastSeenId || '')!==String(s.id)) { alert.lastSeenId=s.id; if (s.state==='upcoming') return null; if (s.state==='live') alert.liveNotifiedId=s.id; return s; }
    if (s.state==='live' && String(alert.liveNotifiedId || '')!==String(s.id)) { alert.liveNotifiedId=s.id; return s; }
    return null;
  }
  if (String(alert.lastSeenId || '')===String(s.id)) return null;
  alert.lastSeenId=s.id; return s;
}
async function check(bot,a,notify=true) {
  const s=await status(a);
  if (!a.initialized) { prime(a,s); a.lastCheckedAt=new Date().toISOString(); return; }
  const e=event(a,s);
  if (e && notify) { await bot.send(a.targetChannelId,render(a.template,e)); a.lastNotifiedAt=new Date().toISOString(); }
  a.lastCheckedAt=new Date().toISOString(); a.lastCheckError=null;
}
async function poll(bot) {
  if (busy) return; busy=true;
  try {
    for (const ls of Object.values(db.servers)) for (const a of (Array.isArray(ls)?ls:[])) {
      if (!a.enabled) continue;
      try { await check(bot,a,true); }
      catch (err) { a.lastCheckError=String(err?.message || err).slice(0,400); a.lastCheckedAt=new Date().toISOString(); console.error('[socialalerts]',a.sourceUrl,a.lastCheckError); }
      await wait(200);
    }
    save();
  } finally { busy=false; }
}
function startPoll(bot) {
  if (started) return; started=true;
  setTimeout(()=>poll(bot).catch(console.error),5000);
  setInterval(()=>poll(bot).catch(console.error),POLL_MS);
  console.log(`[socialalerts] polling every ${Math.round(POLL_MS/1000)}s`);
}
function pick(sid,n) {
  const ls=list(sid), i=Number(n);
  if (!Number.isInteger(i)||i<1||i>ls.length) return null;
  return {alert:ls[i-1],index:i-1,number:i};
}

async function command(bot,msg) {
  const sid=await serverId(bot,msg), uid=userId(msg);
  if (!sid) return msg.reply('This command only works inside a server.');
  if (!(await allowed(bot,sid,uid))) return msg.reply('Only server staff/admins can configure social alerts.');
  const [subRaw,...parts]=String(msg.args || '').trim().split(/\s+/), sub=String(subRaw || 'help').toLowerCase();

  if (sub==='add') {
    const source=parts[0], dest=parts[1];
    if (!source||!dest) return msg.reply('Use `/socialalerts add <creator URL> <#destination-channel>`.');
    const p=platform(source); if (!p) return msg.reply('Supported links: Twitch, YouTube, TikTok.');
    if (p==='twitch' && (!TWITCH_ID||!TWITCH_SECRET)) return msg.reply('Twitch alerts need `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in Railway first.');
    try {
      const sourceUrl=normalize(source,p), ch=await destination(bot,sid,dest);
      if (!ch) return msg.reply(`I couldn't find ${dest}.`);
      if (list(sid).some(a=>a.sourceUrl.toLowerCase()===sourceUrl.toLowerCase())) return msg.reply('That creator is already being watched in this server.');
      const a={platform:p,sourceUrl,targetChannelId:String(ch.id),targetChannelName:ch.name || String(ch.id),template:template(p),creatorName:null,enabled:true,initialized:false,createdAt:new Date().toISOString(),lastSeenId:null,lastLiveId:null,liveNotifiedId:null,lastCheckError:null};
      const s=await status(a); prime(a,s); a.lastCheckedAt=new Date().toISOString(); list(sid).push(a); save();
      return msg.reply(`✅ Added **${a.creatorName || p}** as social alert #${list(sid).length} → #${a.targetChannelName}.${p==='tiktok'?'\n⚠️ TikTok monitoring is best-effort.':''}\nDefault message:\n${a.template}`);
    } catch (err) { return msg.reply(`Could not add that alert: ${String(err?.message || err).slice(0,500)}`); }
  }
  if (sub==='list') {
    const ls=list(sid); if (!ls.length) return msg.reply('No social alerts are configured.');
    return msg.reply('**Social alerts**\n'+ls.map((a,i)=>`${i+1}. **${a.platform}** — ${a.creatorName || a.sourceUrl} → #${a.targetChannelName || a.targetChannelId} (${a.enabled?'on':'off'})${a.lastCheckError?' ⚠️':''}`).join('\n'));
  }
  if (sub==='remove') { const x=pick(sid,parts[0]); if(!x)return msg.reply('Use `/socialalerts list` and give me a valid number.'); const [r]=list(sid).splice(x.index,1); save(); return msg.reply(`Removed #${x.number} (${r.creatorName || r.sourceUrl}).`); }
  if (sub==='toggle') { const x=pick(sid,parts[0]); if(!x)return msg.reply('Use `/socialalerts list` and give me a valid number.'); x.alert.enabled=!x.alert.enabled; save(); return msg.reply(`#${x.number} is now **${x.alert.enabled?'on':'off'}**.`); }
  if (sub==='channel') { const x=pick(sid,parts[0]); if(!x||!parts[1])return msg.reply('Use `/socialalerts channel <number> <#channel>`.'); const ch=await destination(bot,sid,parts[1]); if(!ch)return msg.reply(`I couldn't find ${parts[1]}.`); x.alert.targetChannelId=String(ch.id); x.alert.targetChannelName=ch.name || String(ch.id); save(); return msg.reply(`#${x.number} will now post in #${x.alert.targetChannelName}.`); }
  if (sub==='message') { const n=parts.shift(),x=pick(sid,n),t=parts.join(' ').replace(/\\n/g,'\n').trim(); if(!x||!t)return msg.reply('Use `/socialalerts message <number> <message>`. Parameters: `{channel}` `{url}` `{title}`. Type `\\n` for a new line.'); x.alert.template=t.slice(0,1900); save(); return msg.reply(`✅ Updated #${x.number}.\nParameters: \`{channel}\` \`{url}\` \`{title}\`\n${x.alert.template}`); }
  if (sub==='test') { const x=pick(sid,parts[0]); if(!x)return msg.reply('Use `/socialalerts list` and give me a valid number.'); try { let s=await status(x.alert); if(x.alert.platform==='twitch'&&!s.live)s={channel:s.channel,title:'Test notification (currently offline)',url:s.url}; await bot.send(x.alert.targetChannelId,render(x.alert.template,s)); return msg.reply(`✅ Test sent to #${x.alert.targetChannelName}.`); } catch(err){return msg.reply(`Test failed: ${String(err?.message || err).slice(0,400)}`);} }
  if (sub==='status') { const x=pick(sid,parts[0]); if(!x)return msg.reply('Use `/socialalerts list` and give me a valid number.'); const a=x.alert; return msg.reply(`**Social alert #${x.number}**\nPlatform: ${a.platform}\nCreator: ${a.creatorName || 'unknown'}\nSource: ${a.sourceUrl}\nDestination: #${a.targetChannelName || a.targetChannelId}\nEnabled: ${a.enabled?'yes':'no'}\nLast checked: ${a.lastCheckedAt || 'never'}\nLast error: ${a.lastCheckError || 'none'}\nMessage:\n${a.template}`); }

  return msg.reply(`**Frieren social alerts**\n\n\`/socialalerts add <creator URL> <#channel>\`\n\`/socialalerts list\`\n\`/socialalerts message <number> <message>\`\n\`/socialalerts channel <number> <#channel>\`\n\`/socialalerts test <number>\`\n\`/socialalerts toggle <number>\`\n\`/socialalerts status <number>\`\n\`/socialalerts remove <number>\`\n\nParameters: \`{channel}\` \`{url}\` \`{title}\`\nExample: \`/socialalerts message 1 🔴 {channel} is live! {title} {url}\``);
}

function install(bot) {
  if (bot.__socialAlertsInstalled) return;
  bot.__socialAlertsInstalled=true;
  bot.command('socialalerts','Configure Twitch, YouTube, and TikTok creator notifications',async msg=>{
    try { return await command(bot,msg); }
    catch(err){ console.error('[socialalerts] command:',err); return msg.reply(`Social alerts error: ${String(err?.message || err).slice(0,500)}`); }
  });
  startPoll(bot);
  console.log('[socialalerts] feature enabled');
}
Bot.prototype.start = async function patchedSocialAlertsStart(...args) {
  install(this);
  return originalStart.apply(this,args);
};
