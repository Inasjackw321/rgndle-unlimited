# RNGDLE Unlimited

Roll a nine-digit number. Fifteen factors judge it. Find out how rare your luck really was.

A static, dependency-free web game: slot-machine reels, a rarity-weighted scoring engine, Discord
sign-in, and a leaderboard — all running on GitHub Pages with no build step and no server.

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

## Discord sign-in

The game uses the OAuth2 **implicit grant** (`response_type=token`). That is what makes sign-in work
on a static host: the access token comes back in the URL fragment, so there is no token exchange,
**no client secret, and no server**. Only the `identify` scope is requested — username and avatar.

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2 → Redirects**, add the exact URL the game is served from, including the trailing slash:
   ```
   https://<your-username>.github.io/<your-repo>/
   ```
   The in-game help dialog (`?`) prints the exact string to paste.
3. Put the **Client ID** into `js/config.js`:
   ```js
   discordClientId: '1234567890123456789',
   ```

For local testing, skip editing the file and set an override in the browser console:

```js
localStorage.rngdle_client_id = '1234567890123456789';
```

(Add `http://localhost:8080/` as a redirect URI too.)

The token is stored in `localStorage` and scrubbed from the address bar immediately on return. The
OAuth `state` parameter is generated and checked on the way back. Leave `discordClientId` empty and
the game runs fine in guest mode.

## Leaderboard

By default the leaderboard lives in `localStorage` — per-device, works offline, no setup.

For a **shared** leaderboard, deploy the Cloudflare Worker in `worker/`:

```bash
cd worker
npx wrangler kv namespace create RNGDLE   # paste the id into wrangler.toml
npx wrangler deploy
```

Then set the endpoint in `js/config.js`:

```js
leaderboardEndpoint: 'https://rngdle-leaderboard.<your-subdomain>.workers.dev',
```

The Worker verifies the Discord bearer token, rate-limits submissions, and keeps one personal-best
row per player.

### Trust model — please read before deploying the Worker

The roll happens in the browser, so a determined user can submit a roll they did not honestly
generate. What the Worker enforces is that a submitted score is **arithmetically consistent with its
digits**: it recomputes the base score from the digits using the same engine the client uses, checks
the cosmic multiplier against the real weight table, and bounds the remaining multipliers. That stops
`{"score": 99999999}` outright. It cannot stop someone from claiming they rolled `123456789`.

Genuinely cheat-proof scoring would require generating rolls server-side, which is out of scope for a
static front end. If that matters for your deployment, move `rollDigits`/`rollCosmic` into the Worker
and have the client request a roll rather than report one.

## Layout

```
index.html                  markup and DOM contract
styles.css                  all visuals and animation
js/scoring.js               the scoring engine — pure, runs in browser and Node alike
js/percentiles.js           GENERATED quantile table
js/ranks.js                 score -> percentile -> rank
js/reels.js                 slot-machine reel mechanics
js/fx.js                    starfield, particle bursts, count-up, screen shake
js/audio.js                 synthesised sound (no audio files)
js/discord.js               OAuth2 implicit grant
js/leaderboard.js           local and remote board adapters
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
