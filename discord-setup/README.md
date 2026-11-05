# BlackCat Discord setup

`setup.mjs` builds the **BlackCat** Discord server from `server.json`: it creates the channels and posts the text in them automatically. You can safely run it more than once: anything that already exists (matched by name) is skipped. You need Node 18 or newer; nothing to install.

(The older SalesGames team layout is kept in `salesgames.json`; run it with `--config salesgames.json`.)

## What it creates

| Category     | Channels | Access |
|--------------|----------|--------|
| Start Here   | #welcome, #rules, #announcements (read-only), #introductions | Everyone |
| Community    | #general, #opportunities, #ideas | Everyone |
| Skills       | #sales, #marketing, #tech, #finance | Everyone |
| Projects     | #project-1 to #project-5 | Everyone |
| Public Voice | Lounge, Co-Working, Meeting Room | Everyone |
| Private      | #private-chat, Private Room 1, Private Room 2 | **Authorized** role only |

Every text channel gets an intro message (the welcome, rules, intro template, opportunity and idea formats, and project cards are pinned).

**Roles:** *Admin* (full control) and *Authorized*. To let someone into the private channels, right-click them → *Roles* → tick **Authorized**. Only Admins (and you, as the server owner) can post in the read-only channels.

To rename a project, change text, or add channels, edit `server.json` and re-run.

## One-time steps

1. **Create the server.** In Discord: **+** → *Create My Own* → name it. (Bots can't create servers.)
2. **Create a bot.** Go to <https://discord.com/developers/applications> → *New Application* → *Bot* → *Reset Token*, and copy the token. Keep it secret.
3. **Invite the bot.** Under *OAuth2 → URL Generator*, tick scope `bot` and permission `Administrator`, open the generated URL, and pick your server.
4. **Get the server ID.** In Discord, open *User Settings → Advanced* and turn on *Developer Mode*. Then right-click your server → *Copy Server ID*.

## Run it

Preview without changing anything:

```bash
node setup.mjs --dry-run
```

Run it for real:

```bash
DISCORD_TOKEN=your-bot-token DISCORD_GUILD_ID=your-server-id node setup.mjs
```

(The SalesGames layout also prints a GitHub webhook URL for #dev-updates; BlackCat has none.)

## Afterwards

- Give trusted helpers the **Admin** role and private-channel members **Authorized** (right-click a member → *Roles*).
- Once setup is done you can kick the bot, or remove its Administrator permission.
- To change the layout, edit `server.json` and re-run. New items get added; existing ones aren't changed or deleted. Intro text is posted only when a channel is first created, so re-runs never repost it.
