# Ringy to Gmail

A Chrome extension. With a lead open in Ringy, press a shortcut and a Gmail draft opens in a new tab,
addressed to the lead, with your template filled in ("Hi Dana," and so on).

## Shortcuts

| Keys | What it does |
| --- | --- |
| Alt+Shift+E | Shows the lead's name and email (you can fix them), then pick a template with 1, 2, 3 (or 0 for a blank email) |
| Alt+Shift+1 | Opens template 1 for this lead straight away |
| Alt+Shift+2 | Opens template 2 for this lead straight away |
| (none yet) | Template 3: set a key at `chrome://extensions/shortcuts` |

On a Mac, Alt is the Option key. You can change any shortcut at `chrome://extensions/shortcuts`.

If no email is found, the draft still opens without an address and the extension icon shows a red **!**.
To help it, highlight the email (or the name) on the Ringy page before you press the shortcut.

## Install (once)

1. Download this `ringy-gmail-extension` folder to your computer.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `ringy-gmail-extension` folder.
4. The settings page opens. Paste in your Gmail templates, then click **Save**.
5. Pin the extension (puzzle-piece icon, then the pin) so you can see the red **!** when it appears.

## Templates

Gmail doesn't let other tools read your saved templates, so paste each one's subject and body into the
settings page once. These placeholders get filled in from the lead:

- `{first_name}` becomes "Dana" (or "there" if no name is found; you can change that word)
- `{last_name}`, `{full_name}`, `{email}`

Example body:

```
Hi {first_name},

Thanks for taking my call today. Here's the quote we talked about...
```

Gmail still adds your signature. If you'd rather use a Gmail template exactly as saved, press 0
(blank email) in the picker and insert the template from Gmail's **⋮ > Templates** menu.

If you use more than one Gmail account, set the account number on the settings page. It's the number
in `mail.google.com/mail/u/N/` when you're looking at the right inbox.
