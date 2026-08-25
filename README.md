# Gussle

One nine-digit target a day, the same for everyone. Roll the digits one at a time and try to land
close. Three re-rolls. Spend them wisely.

A static web game — no build step, no server, running on GitHub Pages.

---

## How it plays

1. Everyone gets the **same nine-digit target** today.
2. Roll the digits **one at a time**, left to right.
3. After each roll, **keep it** or spend one of your **three re-rolls** on that digit.
4. The closer each digit lands to its target, the more it scores.

Re-rolls don't come back until tomorrow, and an unspent one is worth points at the end. That's the
whole game: a mediocre digit on lane one is usually worth keeping, while the same digit on lane nine
is worth burning a re-roll on. Judging the middle is the interesting part.

### Digits wrap

Distance is measured the short way round, so **9 and 0 are one apart** and the worst you can ever be
is 5.

This isn't decoration. Under plain `|a − b|` the expected distance depends on the target digit — 4.5
for a 0 or 9, but 2.5 for a 4 or 5 — so a day whose target was `000000000` would be nearly twice as
hard as one of `555555555`, and days would stop being comparable. Wrapping makes every target digit
identical: expected distance 2.5, worst case 5, always. `tools/verify.mjs` asserts this rather than
taking it on trust, and separately checks that four wildly different targets produce the same score
distribution.

### Scoring

| Distance | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Points | 1000 | 400 | 150 | 50 | 15 | 0 |

On top of the per-digit total: a **bullseye combo** that scales hard with how many digits landed
exactly, a bonus for **consecutive** bullseyes, **tight grouping** and **no bad digits** bonuses for
overall control, and **250 per unspent re-roll**. Landing every single digit as far from the target as
possible is exactly as unlikely as a perfect day, and pays accordingly.

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

The reference distribution is **2,000,000 days played by a solver that always makes the correct
re-roll decision**, so a percentile compares you against perfect play. Beating it means you got
luckier than optimal, not that you out-thought it.

## The solver

"Should I burn a re-roll on this?" has a correct answer, so `js/strategy.js` computes it rather than
guessing. The game is a small Markov decision process:

```
state  = (digits left, re-rolls left, bullseyes so far,
          total distance so far, worst distance so far)
action = keep, or spend a re-roll
```

110,400 states, solved exactly in about 30ms. The advice it produces is nicely intuitive and was not
hand-tuned — on the first lane with all three re-rolls it only re-rolls a distance of 4 or 5, but on
the last lane with a re-roll about to expire it re-rolls a 3.

One documented simplification: the DP doesn't look ahead to the consecutive-bullseye bonus, which
would need the current run length in the state for a bonus that is rare and small. Runs are treated as
a windfall. `tools/gen-percentiles.mjs` cross-checks the simulation against the solved expectation and
asserts the simulated mean lands *slightly above* it — below would mean the policy isn't being
followed, far above would mean the run bonus is mis-scaled.

## Sharing

**Copy result** produces a spoiler-free grid — coloured squares for each distance, never the digits,
so posting your result can't hand the answers to someone still playing:

```
Gussle #237 — ETERNAL
🟩🟩🟨🟩🟩🟩🟩🟥🟩
7/9 exact · distance 5 · 73,492 pts
top 0.00396% · 1 in 25,279
```

**Copy image** renders a 1200×630 card showing the target row, your row and the distance chips.

## Running it locally

```bash
npm start             # http://localhost:8080
npm run percentiles   # regenerate js/percentiles.js (required after changing scoring or strategy)
npm run verify        # confirm the table and the fairness claims still hold
```

Plain ES modules, so any static file server works.

## Deploying to GitHub Pages

1. Push to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**

`.github/workflows/deploy.yml` runs the verifier before publishing, so changing the scoring engine
without regenerating the table fails CI rather than silently shipping miscalibrated ranks.

## Signing in

Sign-in uses **Google Identity Services**, which hands the browser a signed JWT ID token directly. No
token exchange, no client secret, no server — which is what lets it work on a static host.

This deployment ships a client ID in `js/config.js`, so sign-in is live for every visitor. For your
own fork:

1. In [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application**.
2. Under **Authorised JavaScript origins**, add your origin — e.g. `https://<you>.github.io`. That is
   the *origin* only: no path, no trailing slash, and no redirect URI to add.
3. Put the client ID into `js/config.js` as `googleClientId`, and into `worker/wrangler.toml` as
   `GOOGLE_CLIENT_ID` if you deploy the leaderboard. The two must match — the Worker checks that every
   token was issued for exactly this client.

You can also enter it in-game via **Set up sign-in**, which stores it for that browser only. A
per-browser value overrides `config.js`; **Clear** removes it and falls back.

Google ID tokens expire in about an hour, so identity and token lifetimes are tracked separately: your
profile stays signed in for 30 days locally, while the leaderboard silently renews the token before
submitting a score.

If Google Identity Services can't be reached, the sign-in slot says so and the game stays fully
playable as a guest.

## What signing in gets you

Results, achievements, streak and **today's in-progress game** are stored per identity, namespaced by
player key (`gussle_history::google:1098765…`). Signing in swaps the whole profile rather than just
changing the name on the board, so two people sharing a browser never see each other's progress — or
each other's half-finished day.

Guest progress is **moved** onto your account the first time you sign in. It's a move rather than a
copy on purpose: if the guest profile survived, the next person to sign in on a shared browser would
inherit the same session.

## Anti-rewind

Every state transition is written to storage the moment it happens — most importantly the pending
roll, before you've decided on it. If that only lived in memory, reloading the page after a bad digit
would hand out a free re-roll, which is exactly what the three-per-day budget exists to prevent. There
is a browser test for it.

## Leaderboard

By default the boards live in `localStorage` — today's board and your best day ever, per device, no
setup.

For **shared** boards, deploy the Cloudflare Worker in `worker/`:

```bash
cd worker
npx wrangler kv namespace create GUSSLE   # paste the id into wrangler.toml
# set GOOGLE_CLIENT_ID in wrangler.toml, or every sign-in is rejected
npx wrangler deploy
```

Then set the endpoint in `js/config.js` as `leaderboardEndpoint`.

### Channel announcements

The Worker can post big results to a Discord channel. The webhook URL is a **Worker secret**, never
client config, so nobody can read it out of the page:

```bash
npx wrangler secret put ANNOUNCE_WEBHOOK
```

`ANNOUNCE_MIN_RANK` in `wrangler.toml` sets the threshold. Announcements fire with `ctx.waitUntil`, so
a Discord outage never delays or fails a score submission.

### Trust model — please read before deploying the Worker

**Identity is verified properly.** Every Google ID token has its RS256 signature checked against
Google's published keys, with issuer, audience and expiry enforced.

**The score is recomputed server-side** from the submitted digits and the day's target, which the
Worker derives itself. A score can never disagree with the digits it claims, and the target can't be
fudged.

**What the Worker cannot check is whether those digits were honestly rolled.** The rolls happen in the
browser, so a determined player can submit nine digits they simply chose. Closing that means having
the Worker issue each roll on request — perfectly doable on top of what's here, and the natural next
step if the board ever matters enough to be worth cheating at.

## Layout

```
index.html                  markup and DOM contract
styles.css                  all visuals and animation
js/scoring.js               distance-based scoring — pure, runs in browser, Worker and Node alike
js/strategy.js              the solved MDP: optimal re-roll policy and reference play
js/percentiles.js           GENERATED quantile table
js/ranks.js                 score -> percentile -> rank
js/daily.js                 the day's target, countdown, puzzle number
js/game.js                  one day's state machine, persisted on every transition
js/reels.js                 the nine lanes and their spin
js/achievements.js          achievement definitions and unlock state
js/share.js                 spoiler-free grid and PNG card
js/fx.js                    starfield, particle bursts, count-up, screen shake
js/audio.js                 synthesised sound (no audio files)
js/auth.js                  sign-in facade and session store
js/google.js                Google Identity Services, JWT ID tokens
js/profile.js               per-identity storage and guest adoption
js/leaderboard.js           local and remote board adapters
js/ui.js                    rendering
js/main.js                  game loop and wiring
tools/gen-percentiles.mjs   Monte Carlo of optimal play -> js/percentiles.js
tools/verify.mjs            calibration and fairness checks (runs in CI)
tools/serve.mjs             local dev server
worker/                     optional Cloudflare Worker leaderboard
```

Accessibility: lanes expose their state via `aria-live`, the re-roll budget is announced, and
everything animated is disabled under `prefers-reduced-motion`.

## Licence

MIT
