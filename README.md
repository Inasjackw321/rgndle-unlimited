# RNGDLE Unlimited

Roll a nine-digit number. Fifteen factors judge it. Find out how rare your luck really was.

A static web game: slot-machine reels, a rarity-weighted scoring engine, a verifiable Daily Challenge,
41 achievements, shareable cards, Google and Discord sign-in, and leaderboards — all running on GitHub
Pages with no build step and no server.

---

## How the score works

Each roll produces **nine digits** and one **cosmic multiplier**. The digits are then examined by a
panel of factors, each paying out according to how unlikely it is.

### Improbability — the rarity floor

Every roll scores this one. It takes the roll's *shape* — how many of each digit you got, ignoring
which digits and in what order — and computes the **exact probability of that shape**:

```
P(shape) = (ways to assign digits to parts) x (ways to arrange them) / 10^9
```

That ranges from `0.229` (two pairs and five singles — the most common outcome) down to `1e-8` (all
nine digits identical). The payout is proportional to `1 / sqrt(P)`, so a shape twice as rare pays
about 1.41x as much. This is what keeps the low end of the distribution smooth: without it, half of
all players would score one of about four possible values.

### Arrangement factors

Improbability is deliberately blind to digit *order*, so the rest of the panel rewards it: identical
runs, ascending and descending straights, palindromes, alternating patterns, arithmetic sequences,
repeated halves, and trailing zeros. Each scales exponentially in the length of the pattern.

### Number theory and culture

The nine digits are also read as a single integer — primes and perfect squares pay out — and scanned
for a short list of numbers people care about for entirely unmathematical reasons.

### Multipliers

The **cosmic multiplier** is a second, independent roll (1x through 25x, heavily weighted toward 1x).
A **hot streak** multiplier builds while each roll beats the last, and a small **time bonus** applies
at a few silly clock times.

## Ranks are real numbers, not vibes

Ranks (F through Ω) are defined by **percentile**, not by hand-picked score thresholds:

| Rank | Percentile | Rank  | Percentile   |
| ---- | ---------- | ----- | ------------ |
| F    | bottom 40% | S     | top 3%       |
| D    | 40–65%     | SS    | top 0.8%     |
| C    | 65–82%     | SSS   | top 0.2%     |
| B    | 82–92%     | ULTRA | top 0.05%    |
| A    | 92–97%     | Ω     | top 0.005%   |

`tools/gen-percentiles.mjs` runs the scoring engine over **2,000,000 simulated rolls** and emits a
quantile table (`js/percentiles.js`) — dense through the body of the distribution, logarithmic in the
upper tail. When the game says *top 0.004%*, that is a measured position in a real distribution.

Two consequences worth knowing:

- **Rank bands are self-calibrating.** Retuning the scoring engine doesn't require re-picking
  thresholds — just regenerate the table.
- **Nominal band widths aren't exactly attainable.** The score distribution is discrete and has large
  atoms: the single score `18,984` (a near-pandigital roll with no other factors and a 1x multiplier)
  is 0.16% of *all* rolls. A percentile boundary landing inside an atom cannot split it, so observed
  band shares drift a little from nominal. `tools/verify.mjs` therefore asserts the property that
  actually matters — that `percentileOf(s)` equals the true fraction of rolls scoring below `s` — and
  reports band shares as information only.

## Daily Challenge

One roll per player per UTC day, derived deterministically from `(date, playerId)`:

```js
dailyRoll(day, playerId)   // -> the same nine digits, every time
```

Two things follow from that:

- **You cannot reroll it.** Refreshing, clearing storage or opening a different browser all reproduce
  the same digits. The button locks to `PLAYED` with a countdown to the next one.
- **It is the one mode a server can fully verify.** The Worker recomputes your roll from your
  authenticated Discord ID and the date, and ignores whatever digits the client sent. A Daily
  submission cannot claim a roll you didn't get.

The derivation is public, so you can compute future days in advance. That's harmless — knowing
tomorrow's roll doesn't let you change it.

The Daily deliberately has no streak or time multipliers: it's a single fixed roll, so session
multipliers would make the board depend on how much you'd played beforehand.

Fairness was checked against the crypto-random baseline over 240,000 derived rolls — digit
frequencies land within ±0.5% of uniform, and the score median and 99th percentile match the endless
mode exactly.

## Achievements

41 of them, evaluated after every roll and stored locally: rank milestones, score milestones, pattern
finds (palindromes, straights, primes, perfect squares), the cultural numbers, multiplier and streak
feats, and Daily streaks. Six are secret and stay masked in the list until earned. Unlocks arrive as
toasts.

## Sharing

- **Copy image** renders a 1200×630 card on a canvas — digits, rank badge, score, rarity and top
  factors — and puts the PNG on your clipboard, falling back to a download where browsers don't allow
  image clipboard writes.
- **Copy for Discord** produces a message with a fenced block, which Discord renders as a monospace
  card.

## Running it locally

```bash
npm start          # http://localhost:8080
```

Plain ES modules, so any static file server works.

```bash
npm run percentiles   # regenerate js/percentiles.js (required after editing js/scoring.js)
npm run verify        # confirm the table still calibrates the scorer
```

## Deploying to GitHub Pages

1. Push to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**

`.github/workflows/deploy.yml` verifies the percentile table and publishes the repository root. The
verify step is the useful part: editing `js/scoring.js` without regenerating the table fails CI
rather than silently shipping miscalibrated ranks.

There is no build step. `.nojekyll` is present so paths beginning with `_` are served correctly.

## Signing in

Two providers, either or both. Both are browser-only flows, which is what makes them work on a static
host — no token exchange, no client secret, no server.

| | Google | Discord |
| --- | --- | --- |
| Mechanism | Identity Services (signed JWT ID token) | OAuth2 implicit grant |
| You register | an **authorised JavaScript origin** | an **exact redirect URL** |
| Token life | ~1 hour, silently renewed | 7 days, renewable with `prompt=none` |
| Server verification | RS256 signature against Google's public keys | token checked against the Discord API |

Every "Sign in with…" button on the web requires the site owner to register an OAuth client first;
there is no provider that skips this. Google's is the more forgiving of the two, because it authorises
an origin rather than an exact path.

### Quickest route

Open the game and press **Set up sign-in** in the top right. The dialog prints the exact origin and
redirect URL for wherever the game is running, with copy buttons, and takes the client IDs.

### Google

1. In [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application**.
2. Under **Authorised JavaScript origins**, add your origin — e.g. `https://<you>.github.io`. There is
   no redirect URI to add.
3. Put the client ID (`…apps.googleusercontent.com`) into `js/config.js` as `googleClientId`.

### Discord

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2 → Redirects**, add exactly `https://<you>.github.io/<repo>/callback.html`, then Save Changes.
3. Put the **Client ID** into `js/config.js` as `discordClientId`.

Only the `identify` scope is requested — username and avatar.

Sign-in happens in a **popup** for Discord, so the page and the roll you're looking at are never torn
down by a navigation; if the popup is blocked it falls back to a redirect. Both routes land on
`callback.html`, so there is only ever one redirect URI to register. Google renders its own button, as
their branding terms require.

### Session handling

- Tokens are stored in `localStorage` and scrubbed from the address bar immediately on return; the
  OAuth `state` parameter is generated and checked on the way back.
- Google ID tokens expire in about an hour, so **identity and token lifetimes are tracked separately**.
  Your profile stays signed in for 30 days locally — re-prompting hourly just to look at your own roll
  history would be obnoxious — while the leaderboard silently renews the token before submitting a
  score, since that's the only place a fresh token actually matters.
- Discord tokens last seven days and cannot be refreshed, so within 12 hours of expiry the chip shows
  a **Renew** button, and a browser that has signed in before gets **Reconnect** rather than a cold
  prompt. Both use `prompt=none`, so returning users re-auth with no consent screen.
- A `401` from the leaderboard triggers one silent re-auth and a retry.

Settings entered in the in-app dialog are per-browser, which suits trying it out. To enable sign-in for
**everyone** who visits, put the same values in `js/config.js` and redeploy. A client ID is public — it
ships to the browser either way. The thing you must never commit is a client *secret*, and neither
flow here uses one.

## What signing in gets you

Roll history, achievements and the Daily streak are stored **per identity**, namespaced by player key
(`rngdle_history::google:1098765…`). Identity is `provider:id`, so a Google subject and a Discord
snowflake can never collide. Signing in therefore swaps the whole profile rather than just
changing the name on the leaderboard, and two people sharing a browser never see each other's
progress.

Guest progress is **moved** onto your account the first time you sign in, so signing in never looks
like it wiped everything. It is a move rather than a copy on purpose: if the guest profile survived,
the next person to sign in on a shared browser would inherit the same session and start with someone
else's history. An account that already has its own progress keeps it — nothing is merged over the
top.

Storage is per-browser. To make a profile follow you between devices it would need to live in the
Worker; the leaderboard already does, the rest does not.

## Leaderboard

By default the leaderboard lives in `localStorage` — per-device, works offline, no setup.

For a **shared** leaderboard, deploy the Cloudflare Worker in `worker/`:

```bash
cd worker
npx wrangler kv namespace create RNGDLE   # paste the id into wrangler.toml
# Required if you accept Google sign-ins, so tokens minted for other sites are rejected:
#   set GOOGLE_CLIENT_ID in wrangler.toml
npx wrangler deploy
```

Then set the endpoint in `js/config.js`:

```js
leaderboardEndpoint: 'https://rngdle-leaderboard.<your-subdomain>.workers.dev',
```

The Worker verifies the bearer token — Discord tokens against the Discord API, Google ID tokens by
checking the RS256 signature against Google's published keys plus issuer, audience and expiry — then
rate-limits submissions, and keeps one personal-best row
per player on the all-time board plus one row per player per day on the Daily board (kept ~40 days).

### Channel announcements

The Worker can post big rolls to a Discord channel. The webhook URL is a **Worker secret**, never
client config, so nobody can read it out of the page and spam your channel:

```bash
npx wrangler secret put ANNOUNCE_WEBHOOK      # a channel webhook URL
```

`ANNOUNCE_MIN_RANK` in `wrangler.toml` sets the threshold (default `SS`). Announcements are fired with
`ctx.waitUntil`, so a Discord outage never delays or fails a score submission.

### Trust model — please read before deploying the Worker

**The Daily board is fully verified.** The roll is a pure function of the UTC date and your Discord
user ID, so the Worker recomputes it and ignores the client's claims entirely. It cannot be faked and
cannot be rerolled.

**The all-time board is not, and cannot be on a static front end.** The endless roll happens in the
browser. What the Worker enforces is that a submitted score is **arithmetically consistent with its
digits**: it recomputes the base score using the same engine the client uses, checks the cosmic
multiplier against the real weight table, and bounds the rest. That stops `{"score": 99999999}`
outright. It cannot stop someone from claiming they rolled `123456789`.

If that matters for your deployment, prefer the Daily board — or move `rollDigits`/`rollCosmic` into
the Worker and have the client request a roll rather than report one.

## Layout

```
index.html                  markup and DOM contract
callback.html               OAuth2 landing page (popup + redirect, one URI)
styles.css                  all visuals and animation
js/scoring.js               the scoring engine — pure, runs in browser and Node alike
js/percentiles.js           GENERATED quantile table
js/ranks.js                 score -> percentile -> rank
js/daily.js                 deterministic Daily Challenge (shared with the Worker)
js/achievements.js          achievement definitions and unlock state
js/share.js                 PNG share card and Discord text
js/reels.js                 slot-machine reel mechanics
js/fx.js                    starfield, particle bursts, count-up, screen shake
js/audio.js                 synthesised sound (no audio files)
js/auth.js                  provider-agnostic sign-in facade and session store
js/discord.js               OAuth2 implicit grant, popup flow, redirect fallback
js/google.js                Google Identity Services, JWT ID tokens
js/profile.js               per-identity storage and guest adoption
js/leaderboard.js           local and remote board adapters, both scopes
js/ui.js                    rendering
js/main.js                  game loop and wiring
tools/gen-percentiles.mjs   Monte Carlo -> js/percentiles.js
tools/verify.mjs            calibration check (runs in CI)
tools/serve.mjs             local dev server
worker/                     optional Cloudflare Worker leaderboard
```

Accessibility: reels expose their result via `aria-live`, and everything animated is disabled under
`prefers-reduced-motion`.

## Licence

MIT
