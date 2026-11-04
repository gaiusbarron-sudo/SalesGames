#!/usr/bin/env node
// Sets up a Discord server (roles, categories, channels, permissions, welcome
// message, GitHub webhook) from server.json. Safe to re-run: anything that
// already exists (matched by name) is left alone.
//
// Usage:
//   DISCORD_TOKEN=... DISCORD_GUILD_ID=... node setup.mjs [--dry-run] [--config path]
//
// Requires Node 18+ (uses built-in fetch). No npm install needed.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://discord.com/api/v10";

const PERMS = {
  KICK_MEMBERS: 1n << 1n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
};

const CHANNEL_TYPES = { text: 0, voice: 2, category: 4 };
const OVERWRITE_ROLE = 0;

// ---------- args / env ----------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const configIdx = args.indexOf("--config");
const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = configIdx >= 0 ? args[configIdx + 1] : path.join(here, "server.json");

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID || (dryRun ? "GUILD_ID" : undefined);
if (!dryRun && (!token || !process.env.DISCORD_GUILD_ID)) {
  console.error("Set DISCORD_TOKEN and DISCORD_GUILD_ID (or pass --dry-run). See README.md.");
  process.exit(1);
}

const config = JSON.parse(await readFile(configPath, "utf8"));

// ---------- helpers ----------

function bits(names = []) {
  let v = 0n;
  for (const n of names) {
    if (!(n in PERMS)) throw new Error(`Unknown permission "${n}" in ${configPath}`);
    v |= PERMS[n];
  }
  return v;
}

let fakeId = 1000;
async function api(method, route, body) {
  if (dryRun) {
    if (method === "GET") return [];
    if (body?.permission_overwrites) console.log(`      access: ${describe(body.permission_overwrites)}`);
    return { id: String(fakeId++), token: "dry-run-token" };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + route, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (salesgames-setup, 1.0)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const { retry_after = 1 } = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, retry_after * 1000 + 250));
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint =
        res.status === 401 ? " (bad token?)" :
        res.status === 403 ? " (bot is missing permissions; give it Administrator for setup)" :
        res.status === 404 ? " (wrong server ID, or the bot isn't in that server)" : "";
      throw new Error(`${method} ${route} -> ${res.status}${hint}: ${JSON.stringify(data)}`);
    }
    return data;
  }
  throw new Error(`${method} ${route}: still rate limited after 5 tries`);
}

// Readable summary of overwrites, shown in --dry-run.
function describe(overwrites) {
  const names = Object.fromEntries(Object.entries(roleIds).map(([n, id]) => [id, n]));
  const v = PERMS.VIEW_CHANNEL, s = PERMS.SEND_MESSAGES;
  const see = [], post = [];
  for (const o of overwrites) {
    const allow = BigInt(o.allow), deny = BigInt(o.deny), n = names[o.id];
    if (allow & v) see.push(n);
    if ((allow & s) || ((allow & v) && !(deny & s) && !overwrites.some((x) => x.id === guildId && BigInt(x.deny) & s))) post.push(n);
  }
  return `see: ${see.join(", ") || "Admin only"} | post: ${post.join(", ") || "Admin only"}`;
}

const hexColor = (c) => (c ? parseInt(c.replace("#", ""), 16) : 0);

// ---------- run ----------

process.on("uncaughtException", (e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});

console.log(dryRun ? "Dry run: nothing will be changed.\n" : "Setting up server...\n");

if (!dryRun) {
  const guild = await api("GET", `/guilds/${guildId}`);
  console.log(`Server: ${guild.name}\n`);
}

// Roles. Discord puts new roles at the bottom, so create from the last entry
// to the first; the first role in server.json ends up highest.
console.log("Roles");
const existingRoles = await api("GET", `/guilds/${guildId}/roles`);
const roleIds = { "@everyone": guildId };
for (const r of existingRoles) roleIds[r.name] = r.id;

for (const role of [...config.roles].reverse()) {
  if (roleIds[role.name]) {
    console.log(`  = ${role.name} (exists)`);
    continue;
  }
  const created = await api("POST", `/guilds/${guildId}/roles`, {
    name: role.name,
    color: hexColor(role.color),
    hoist: !!role.hoist,
    mentionable: true,
    permissions: bits(role.permissions).toString(),
  });
  roleIds[role.name] = created.id;
  console.log(`  + ${role.name}`);
}

function roleId(name) {
  const id = roleIds[name];
  if (!id) throw new Error(`Role "${name}" is referenced in a channel but not defined in roles`);
  return id;
}

// Builds permission overwrites for one channel.
//  - Hidden from @everyone unless `public`.
//  - Visible to the category's `roles` (or defaults.viewRoles), plus `extraRoles`.
//  - `readOnly`: only defaults.postRoles can send messages.
// Admin has ADMINISTRATOR and sees everything regardless.
function overwritesFor(category, channel) {
  const map = new Map();
  const add = (id, allow = 0n, deny = 0n) => {
    const o = map.get(id) || { allow: 0n, deny: 0n };
    o.allow |= allow;
    o.deny |= deny;
    o.allow &= ~deny; // a deny added later wins
    map.set(id, o);
  };
  const view = PERMS.VIEW_CHANNEL;
  const send = PERMS.SEND_MESSAGES | PERMS.SEND_MESSAGES_IN_THREADS | PERMS.CREATE_PUBLIC_THREADS;
  const viewRoles = [...(category.roles || config.defaults.viewRoles), ...(channel.extraRoles || [])];
  const postRoles = config.defaults.postRoles || [];

  if (channel.public) add(guildId, view);
  else add(guildId, 0n, view);

  for (const name of viewRoles) add(roleId(name), view);

  if (channel.readOnly) {
    add(guildId, 0n, send);
    for (const name of viewRoles) if (!postRoles.includes(name)) add(roleId(name), 0n, send);
    for (const name of postRoles) {
      const o = map.get(roleId(name)) || { allow: 0n, deny: 0n };
      o.deny &= ~send;
      o.allow |= send | view;
      map.set(roleId(name), o);
    }
  }

  return [...map].map(([id, o]) => ({
    id,
    type: OVERWRITE_ROLE,
    allow: o.allow.toString(),
    deny: o.deny.toString(),
  }));
}

// Categories and channels.
const existingChannels = await api("GET", `/guilds/${guildId}/channels`);
const findChannel = (name, type, parentId) =>
  existingChannels.find(
    (c) => c.name.toLowerCase() === name.toLowerCase() && c.type === type && (parentId === undefined || c.parent_id === parentId)
  );

const webhookUrls = [];

for (const category of config.categories) {
  console.log(`\nCategory: ${category.name}`);
  let cat = findChannel(category.name, CHANNEL_TYPES.category);
  if (cat) {
    console.log("  = category exists");
  } else {
    cat = await api("POST", `/guilds/${guildId}/channels`, {
      name: category.name,
      type: CHANNEL_TYPES.category,
      permission_overwrites: overwritesFor(category, {}),
    });
    console.log("  + category");
  }

  for (const channel of category.channels) {
    const type = CHANNEL_TYPES[channel.type || "text"];
    const label = type === CHANNEL_TYPES.voice ? `🔊 ${channel.name}` : `#${channel.name}`;
    if (findChannel(channel.name, type, cat.id)) {
      console.log(`  = ${label} (exists)`);
      continue;
    }
    const created = await api("POST", `/guilds/${guildId}/channels`, {
      name: channel.name,
      type,
      parent_id: cat.id,
      topic: type === CHANNEL_TYPES.text ? channel.topic : undefined,
      permission_overwrites: overwritesFor(category, channel),
    });
    console.log(`  + ${label}`);

    // Only post on first creation so re-runs don't spam.
    if (channel.message) {
      const msg = await api("POST", `/channels/${created.id}/messages`, { content: channel.message });
      if (channel.pin) await api("PUT", `/channels/${created.id}/pins/${msg.id}`);
      console.log(`    posted${channel.pin ? " and pinned" : ""} welcome message`);
    }

    if (channel.githubWebhook) {
      const hook = await api("POST", `/channels/${created.id}/webhooks`, { name: "GitHub" });
      webhookUrls.push({ channel: channel.name, url: `https://discord.com/api/webhooks/${hook.id}/${hook.token}/github` });
      console.log("    created GitHub webhook");
    }
  }
}

console.log("\nDone.");

if (webhookUrls.length) {
  console.log("\nGitHub webhook (keep this URL private, it lets anyone post to the channel):");
  for (const w of webhookUrls) console.log(`  #${w.channel}: ${w.url}`);
  console.log(
    "\nAdd it in GitHub: repo Settings > Webhooks > Add webhook\n" +
      "  Payload URL: the URL above (it must end in /github)\n" +
      "  Content type: application/json\n" +
      "  Events: 'Send me everything', or pick pushes, pull requests, issues"
  );
}
