# Discord team workspace setup

`setup.mjs` sets up a Discord server for the SalesGames team based on `server.json`. You can safely run it more than once: anything that already exists (matched by name) is skipped. You need Node 18 or newer; nothing to install.

## What it creates

**Roles** (highest first): Admin, Lead, Team, Guest

| Category   | Channels | Who sees it |
|------------|----------|-------------|
| Info       | #welcome (read-only, pinned intro), #announcements (Leads post), #links | #welcome: everyone; rest: Team + Lead |
| Team       | #general, #standup, #random | Team + Lead |
| SalesGames | #game-dev, #design, #playtesting, #qa-bugs, #dev-updates (GitHub feed, read-only) | Team + Lead (Guests can also see #playtesting) |
| Leads      | #leads | Lead only |
| Voice      | Huddle, Meeting Room, Focus Room | Team + Lead |

Admins see and can do everything. New members see only #welcome until someone gives them the **Team** role, so the workspace stays private.

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

At the end the script prints a **GitHub webhook URL** for #dev-updates. In GitHub, go to the repo's *Settings → Webhooks → Add webhook*, paste the URL (it ends in `/github`), set the content type to `application/json`, and pick the events you want. Keep the URL private, because anyone who has it can post to the channel.

## Afterwards

- Give yourself the **Admin** role and teammates **Team** or **Lead** (right-click a member → *Roles*).
- Once setup is done you can kick the bot, or remove its Administrator permission.
- To change the layout, edit `server.json` and re-run. New items get added; existing ones aren't changed or deleted. The welcome message is posted only when #welcome is first created.
