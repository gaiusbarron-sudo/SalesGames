# Call Captions

Live captions of the caller for agents who take calls on a softphone. The agent
opens a caption window next to their softphone, presses **Start captions**, and
reads what the member is saying as they say it.

```
 Agent's PC                                         Speech service (under a BAA)
┌───────────────────────────────┐                 ┌───────────────────────────┐
│ Softphone ──audio──► Caption  │  16 kHz PCM     │ Deepgram or               │
│ (caller's voice)     window   │ ──WebSocket──►  │ Amazon Transcribe         │
│                      (browser)│   Caption       │                           │
│  live captions  ◄─────────────│◄── server ◄─────│ interim + final text      │
└───────────────────────────────┘                 └───────────────────────────┘
```

- **Caption window** (`public/`): captures the softphone's audio with the
  browser's screen/tab-share audio, converts it to 16 kHz mono PCM, and streams it
  to the server. It shows text as it forms (grey) and finished sentences (black),
  with adjustable text size and a Copy button for call notes.
- **Caption server** (`server.js`): relays audio to the speech service and
  sends captions back. The API key stays on the server, never in the browser.
- **Providers** (`providers/`): `deepgram`, `aws` (Amazon Transcribe), and
  `mock`, a scripted demo that needs no account.

Only the caller is captioned: the softphone's speaker output is the caller's
voice, and the agent's own microphone is not captured.

## Try it

Requires Node.js 22 or newer.

```bash
cd call-captions
npm install
npm start             # demo mode: scripted captions, no account needed
```

Open http://127.0.0.1:8787 in Chrome or Edge, choose **Microphone (testing
only)**, and press **Start captions**. In demo mode, scripted captions appear
while audio is flowing.

## Set up Amazon Transcribe

One-time setup in the AWS console, done by whoever manages your AWS account:

1. **Accept the AWS BAA.** In **AWS Artifact → Agreements**, accept the
   Business Associate Addendum for the account (or your whole AWS Organization).
   Amazon Transcribe is a HIPAA-eligible service under it. Do this before
   sending any real member calls.
2. **Opt out of AI training.** In **AWS Organizations → Policies → AI services
   opt-out policies**, attach `aws/ai-opt-out-policy.json` so AWS doesn't keep
   or use your call audio to improve its models. (Use the `default` service key
   instead of `transcribe` to opt out of every AWS AI service.)
3. **Create a least-privilege identity.** In **IAM**, create a policy from
   `aws/iam-policy.json`. It allows starting live transcription and nothing
   else. Attach it to:
   - an **IAM role**, if the caption server runs on AWS (EC2, ECS), or
   - an **IAM user** with an access key, if it runs on an office machine.
4. **Pick a region** close to your agents (for example `us-east-1` or
   `us-west-2`).

Then configure the server:

```bash
cp .env.example .env
```

```ini
CAPTION_PROVIDER=aws
AWS_REGION=us-east-1
# Only when not using an IAM role:
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Run `npm start`. The status pill should say **Listening** (not "demo
captions"). If credentials are missing or wrong, the window shows the error as
soon as you press Start.

### Where to run the server

- **One shared server (recommended).** Run it on one machine (an office server
  or a small EC2 instance with an IAM role), so the AWS key never sits on agent
  PCs. Browsers only allow audio capture on secure pages, so serve it over
  **HTTPS** (for example behind your existing reverse proxy or an AWS load
  balancer), keep it on your internal network or VPN, and set `HOST=0.0.0.0`
  and an `ACCESS_TOKEN`.
- **One per agent PC.** Works with plain `http://127.0.0.1:8787` and no HTTPS
  setup, but every PC needs Node.js and a copy of the AWS key. Fine for a pilot
  with a few agents.

### Cost

Transcribe bills per second of audio streamed (check the
[pricing page](https://aws.amazon.com/transcribe/pricing/) for your region).
To keep that to talk time, the caption window doesn't send audio during
silence: it starts sending when someone speaks, keeps going two seconds after
they stop, and includes a fraction of a second from just before speech so first
words aren't cut off. The server opens a Transcribe stream when speech starts
and closes it after eight quiet seconds. Agents can leave captions on all shift
without paying for the gaps between calls. Hold music still counts as sound.

## Using it with Ringy

Ringy runs in the browser at app.ringy.com, so captions work by sharing that tab's
audio. This works on Windows and Mac.

1. Use Chrome or Edge for both Ringy and the caption window.
2. Log in to Ringy in one tab. Open the caption window in a **separate browser
   window** (drag its tab out) and place it beside Ringy so both stay visible.
3. In the caption window, press **Start captions**, choose the **Chrome Tab**
   section of the share dialog, select the **app.ringy.com** tab, and make sure
   **Also share tab audio** is switched on. Then press **Share**.
4. Dial as usual. Captions run continuously across power-dialer calls; there's
   no need to restart them for each call. Press **Clear** between calls if you
   want a fresh transcript for each member.
5. If you close or switch the Ringy tab's sharing off, captions stop and the
   window says so; press **Start captions** again.

Turn the caption window off for calls with members who decline transcription
(see the checklist below).

## Using it on a call

1. Open the caption window beside the softphone (Chrome or Edge).
2. Leave **Audio from** on **Softphone** and press **Start captions**.
3. In the share dialog:
   - **Browser-based softphone**: pick the softphone's **tab** and turn on
     **Share tab audio**. This works on Windows, Mac and ChromeOS.
   - **Desktop softphone app**: pick **Entire screen** and turn on **Share
     system audio**. Chrome supports this on Windows and ChromeOS. On a Mac,
     system audio sharing needs a recent macOS and Chrome; if it isn't offered,
     use a browser-based softphone or the contact-center integration below.
4. Press **Stop captions** (or the browser's *Stop sharing*) after the call.

The browser shows its usual "sharing your screen" bar. No video is kept: the
window discards the video track right away and uses only the audio.

## Before using it with real member calls

Captions of member calls contain PHI. Before going live:

- **Sign a BAA with the speech provider.** AWS covers Amazon Transcribe under the
  AWS BAA. Deepgram offers a BAA on its enterprise plans. Don't send real calls
  to a provider without one.
- **Check your call disclosures.** Your IVR greeting probably already says calls
  may be recorded or monitored; have compliance confirm it covers
  machine transcription, especially for members in all-party-consent states.
- **Keep the server private.** By default it listens on `127.0.0.1`, meaning one
  instance per agent PC. To run one shared server instead, put it behind your
  company's TLS reverse proxy (so the window uses `https`/`wss`), restrict it to
  the internal network or VPN, and set `ACCESS_TOKEN` (better: put it behind
  your SSO).
- **Nothing is stored.** The server keeps audio and text in memory only and
  never logs transcript text. The window keeps the transcript until the agent
  clears it or closes the window. When agents paste it into a case, your normal
  record-retention rules apply.
- **Opt out of AI training.** For AWS, attach the AI services opt-out policy
  (step 2 above). Deepgram requests already opt out of its model-improvement
  program (`mip_opt_out`).

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `CAPTION_PROVIDER` | `mock` | `mock`, `deepgram`, or `aws` |
| `CAPTION_LANGUAGE` | `en-US` | Spoken language (for example `es-US`) |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Where the server listens |
| `ACCESS_TOKEN` | *(none)* | If set, open the window with `?token=…` |
| `DEEPGRAM_API_KEY` | | Deepgram key |
| `DEEPGRAM_MODEL` | `nova-3` | `nova-3-medical` is tuned for medical terms |
| `AWS_REGION` | `us-east-1` | Amazon Transcribe region |

## Tests

```bash
npm test
```

The tests run the server with the demo provider, the Deepgram adapter against
a local fake Deepgram server, and the AWS adapter against a fake Transcribe
client (stream opens on audio, closes when idle, results map to captions).
Do a short test call against real Transcribe before rollout.

## Where this can go next

- **Contact-center integration.** If you move to a cloud contact center
  (Amazon Connect, Genesys Cloud, Five9, Twilio Flex), it can stream each
  call's audio straight to the server. Agents then wouldn't need to share
  anything, and both sides could be captioned with speaker labels.
- **Spanish and other languages**, chosen per call.
- **Highlighting** member IDs, claim numbers and dates in the captions.
- **Redaction** of SSNs and card numbers before text reaches the screen
  (both providers support it).
