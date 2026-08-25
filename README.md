# RNGDLE Unlimited

Roll a nine-digit number. Fifteen factors judge it. Find out how rare your luck really was.

A static web game: slot-machine reels, a rarity-weighted scoring engine, a verifiable Daily Challenge,
62 achievements, shareable cards, Google sign-in and leaderboards — all running on GitHub Pages with
no build step and no server.

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

### Alphabet and ordering

Which digits you drew, and in what order: rolls made only of binary digits, only prime digits, all
even or all odd; rolls that never decrease or never increase; `AABBCCDD` stutters; and straights that
run through the 9-to-0 seam.

### Number theory and culture

The nine digits are also read as a single integer. Primes, perfect squares, perfect cubes, powers of
two, Fibonacci numbers and triangular numbers all pay out, scaled by how thin on the ground they are —
there are only 44 Fibonacci numbers below a billion. The digits are also scanned for a short list of
numbers people care about for entirely unmathematical reasons.

### Multipliers

The **cosmic multiplier** is a second, independent roll across thirteen tiers, from a 50%-likely 1x up
to a 1-in-20,000 **100x**, heavily weighted toward the bottom.
A **hot streak** multiplier builds while each roll beats the last, and a small **time bonus** applies
at a few silly clock times.

## Ranks are real numbers, not vibes

Fifteen tiers, defined by **percentile** rather than hand-picked score thresholds:

| Rank | Percentile | Rank | Percentile |
| --- | --- | --- | --- |
| F | bottom 30% | S | top 3.5% |
| E | 30–48% | S+ | top 1.5% |
| D | 48–63% | SS | top 0.7% |
| C | 63–76% | SSS | top 0.3% |
| B | 76–86% | ULTRA | top 0.1% |
| A | 86–93% | COSMIC | top 0.03% |
| A+ | 93–96.5% | ETERNAL | top 0.005% |
| | | Ω | top 0.001% |

`tools/gen-percentiles.mjs` runs the scoring engine over **2,000,000 simulated rolls** and emits a
quantile table (`js/percentiles.js`) — dense through the body of the distribution, logarithmic in the
upper tail. When the game says *top 0.004%*, that is a measured position in a real distribution.

Two consequences worth knowing:

- **Rank bands are self-calibrating.** Retuning the scoring engine doesn't require re-picking
  thresholds — just regenerate the table.
- **Nominal band widths aren't exactly attainable.** The score distribution is discrete, so a
  percentile boundary landing inside an atom of identical scores cannot split it. `tools/verify.mjs`
  therefore asserts the property that actually matters — that `percentileOf(s)` equals the true
  fraction of rolls scoring below `s` — and reports band shares as information only. (They currently
  land within a few percent of nominal across all fifteen tiers.)

## Daily Challenge

One roll per player per UTC day, derived deterministically from `(date, playerId)`:

```js
dailyRoll(day, playerId)   // -> the same nine digits, every time
```

Two things follow from that:

- **You cannot reroll it.** Refreshing, clearing storage or opening a different browser all reproduce
  the same digits. The button locks to `PLAYED` with a countdown to the next one.
- **It is the one mode a server can fully verify.** The Worker recomputes your roll from your
  authenticated Google account ID and the date, and ignores whatever digits the client sent. A Daily
  submission cannot claim a roll you didn't get.

The derivation is public, so you can compute future days in advance. That's harmless — knowing
tomorrow's roll doesn't let you change it.

The Daily deliberately has no streak or time multipliers: it's a single fixed roll, so session
multipliers would make the board depend on how much you'd played beforehand.

Fairness was checked against the crypto-random baseline over 240,000 derived rolls — digit
frequencies land within ±0.5% of uniform, and the score median and 99th percentile match the endless
mode exactly.

## Achievements

62 of them, evaluated after every roll and stored per account: rank milestones across all fifteen
tiers, score milestones, pattern finds, the digit-alphabet and ordering rarities, number-theory
curiosities, the cultural numbers, multiplier and streak feats, and Daily streaks. Eleven are secret
and stay masked until earned. Unlocks arrive as toasts.

Every one is reachable — a test sweeps millions of simulated rolls and reports any achievement that
never fires, which catches both unsatisfiable predicates and factor-name typos.

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

Sign-in uses **Google Identity Services**, which hands the browser a signed JWT ID token directly. No
token exchange, no client secret, no server — which is what lets it work on a static host.

Every "Sign in with…" button on the web requires the site owner to register an OAuth client first;
there is no provider that skips this. Google's is the more forgiving kind, because it authorises an
**origin** rather than an exact redirect path.

### Setup

Open the game and press **Set up sign-in** in the top right — the dialog prints the exact origin to
authorise, with a copy button, and takes the client ID. Behind it:

1. In [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application**.
2. Under **Authorised JavaScript origins**, add your origin — e.g. `https://<you>.github.io`. There is
   no redirect URI to add.
3. Put the client ID (`…apps.googleusercontent.com`) into `js/config.js` as `googleClientId`.

Settings entered in the dialog are per-browser, which suits trying it out. To enable sign-in for
**everyone** who visits, put the value in `js/config.js` and redeploy. A client ID is public — it ships
to the browser either way. The thing you must never commit is the client *secret*, which this flow
never uses.

### Session handling

Google ID tokens expire in about an hour, so **identity and token lifetimes are tracked separately**.
Your profile stays signed in for 30 days locally — re-prompting hourly just to look at your own roll
history would be obnoxious — while the leaderboard silently renews the token before submitting a
score, since that's the only place a fresh token actually matters. A `401` triggers one silent re-auth
and a retry.

## What signing in gets you

Roll history, achievements and the Daily streak are stored **per identity**, namespaced by player key
(`rngdle_history::google:1098765…`). The `google:` prefix is deliberate — it keeps the namespace open
so a second provider could never collide with existing identities. Signing in therefore swaps the whole profile rather than just
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
# REQUIRED — set GOOGLE_CLIENT_ID in wrangler.toml, or tokens minted for any
# other site would be accepted here.
npx wrangler deploy
```

Then set the endpoint in `js/config.js`:

```js
leaderboardEndpoint: 'https://rngdle-leaderboard.<your-subdomain>.workers.dev',
```

The Worker verifies every ID token by checking its RS256 signature against Google's published keys,
plus issuer, audience and expiry, then rate-limits submissions, and keeps one personal-best row
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

**The Daily board is fully verified.** The roll is a pure function of the UTC date and your Google
account ID, so the Worker recomputes it and ignores the client's claims entirely. It cannot be faked and
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
js/auth.js                  sign-in facade and session store
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
