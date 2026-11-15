# Foefall

**Every monster shows where it will strike. Make them strike each other.**

Foefall is a daily tactics puzzle for Reddit, set in the world of [Orvandel](https://play.jonathansolvesproblems.com), my browser MMORPG. Each day a new trial goes up in the subreddit: a small board, a few monsters whose strikes are marked on the ground, and one to three heroes who can shove, hurl, drag, swap or drop a star. You get one turn. When you press Strike, every monster strikes at the same moment. Clear the board with every hero standing and every lamp lit.

Most trials can be won more than one way, and the subreddit hunts for all of them together. The first redditor to find each way gets their name on it.

It is a port: Foefall takes Orvandel's world, its four nations, its hero classes, its creatures and its signature mechanic (big attacks marked on the ground before they land) and turns them into a bite-sized daily game built for Reddit.

## How to run it

Requires Node 24 or newer and a Reddit account with [Devvit](https://developers.reddit.com) access.

```bash
npm install
npm test              # rules, solver, every scheduled trial, and the game state
npm run local         # local preview at http://127.0.0.1:5199/splash.html?user=you (mock Reddit, real game logic)
npx tsx tools/device-check.ts   # touch play at three phone sizes and a laptop window, plus a logged-out player (needs npm run local)
npx tsx tools/forge-check.ts    # build, prove, post and play a player-built trial (needs npm run local)
npx tsx tools/a11y-check.ts     # axe (WCAG 2.1 AA) on every screen, plus contrast sampled behind the glyphs where axe cannot measure (needs npm run local)
npx devvit login
npm run dev           # devvit playtest in your test subreddit
npm run deploy        # type-check, test, devvit upload
```

In the subreddit, a moderator can use the menu item **Foefall: post today's trial**. After that, the scheduler posts each day's trial at 00:01 UTC.

## How to play

1. **Read the board.** Red hatched tiles are where the monsters will strike. Every monster strikes when you press Strike, all at once.
   - **Duskfield Wolf** bites the tile it faces (the small triangle on its ring).
   - **Thornback Boar** shakes thorns onto all four sides.
   - **Shardrunner Thief** throws a knife that hits the first thing in its path (the dashed line).
   - **Cinder Acolyte** calls fire down in a cross two tiles ahead.
2. **Move your heroes.** Tap a hero, tap a gold dot to walk, then tap a ringed target to use its ability. Tap the hero again (or press Wait) to end its turn without one.
   - **Vanguard** (Shield Bash): shove an adjacent creature one tile.
   - **Reaver** (Hurl): throw an adjacent creature over your head to the far side.
   - **Gloamhunter** (Tetherline): hook the first creature in a line and drag it to you.
   - **Hexweaver** (Unwrite): swap places with anyone within 3 tiles.
   - **Shardcaller** (Starfall): drop a star on a creature 2 or 3 tiles away.
3. **Watch the forecast.** The line above the board updates on every tap: how many monsters will fall, whether a hero will be struck, whether the lamp stays lit. A crossed-swords badge marks each monster that will fall. When the forecast turns gold, press **Strike**.
4. **Small print.** A creature shoved into rock, a lamp or another creature takes 1. Shoved or dragged onto a chasm, it falls. Monsters with two red pips need two hits. A hero struck by anything falls. Undo is free; only Strike counts as a try.

First-time players get a one-move warm-up with hints before the day's trial.

### The week follows the moon

| Day | Moon | Feel |
|---|---|---|
| Monday | New Moon | Gentle: one hero, two monsters |
| Tuesday | Waxing Crescent | Easy: one hero, three monsters |
| Wednesday | First Quarter | Steady: two heroes |
| Thursday | Waxing Gibbous | Tricky |
| Friday | Full Moon | Hard |
| Saturday | Broken Moon | Fiendish: three heroes, up to five monsters |
| Sunday | Waning Moon | Many paths: three to six ways to win |

## What makes it a Reddit game

- **Build a trial.** After a clear, any redditor can build their own trial: place monsters (tap again to turn them), rock, chasms, lamps and up to three heroes, and the forecast shows every strike as you build. The solver checks it can be won and counts its ways. Then the maker has to clear it themselves before it can be posted, so no impossible trial ever reaches the feed. It goes up as its own post, with its own hunt for every way and its own first clears. Three trials per player per day.
- **The hunt.** Each trial has a known number of ways to win. The post shows how many the subreddit has found, and each found way carries the name and avatar of the first redditor who found it. Unfound ways stay locked.
- **Chalk marks.** After a clear, one button leaves your result as a comment in the day's thread (try count, ways found, streak, nation). The way itself is never spelled out, so the thread stays spoiler-free.
- **Nations and flair.** Pick one of Orvandel's four nations after your first clear. Your nation and streak become your user flair, and every clear adds to your nation's tally for the day.
- **Streaks.** A streak counts consecutive days you cleared that day's trial.
- **First to clear.** Each post has a leaderboard of the day's first clears, by tries.
- **Daily posts.** The scheduler posts the new trial every day at 00:01 UTC; old posts stay playable but do not count toward streaks. Each post gets flair: "Daily · Gentle" through "Daily · Fiendish", coloured by difficulty, or "Built by a player", so the subreddit can filter by either.
- **Journeys.** The game reports Devvit Journeys events: app ready, journey start on the first action, progress per hero action, interactions (undo, help, chalk mark), and journey end with the win and try count.

## How the trials are made

Trials are generated backwards, so every one can be won:

1. Place monsters so that, striking at once, every one of them is hit.
2. For each hero, undo one use of its ability (un-shove, un-hurl, un-pull, un-swap, or add the health a falling star will take).
3. Scatter the heroes within walking distance and set lamps where doing nothing would put them out.

Then an exhaustive solver (`src/shared/engine/solver.ts`) plays every order of heroes, every reachable tile and every target. A trial is kept only if it can be won, cannot be won by doing nothing, needs every hero, and has the number of ways its weekday calls for. Difficulty bands come from the share of distinct endings that win, measured with `tools/calibrate.ts`. The season (`src/server/season.json`, 120 days from 15 November 2026) is checked again by `npm test`, which re-solves every day and asserts its ways.

The server replays every claimed turn with the same rules engine before recording it, so the client's verdict is never trusted.

## Data

Foefall stores, per player, a try count, the ways they found, a streak and a nation, and per day the first finder of each way and the first clears. Following the Devvit Rules, every key that holds a username, user id or avatar expires 30 days after its last write, and deleting a trial's post removes what the app stored about that post. No data leaves Reddit.

On a test subreddit (name ending in `_dev`), every upload runs a self-check on Reddit: it plays a known winning line for today's trial as a throwaway player on a scratch day, through the real Devvit Redis, and logs `[selftest] ok` or `[selftest] FAIL` with the reason.

## Layout

| Path | What it is |
|---|---|
| `src/shared/engine/` | Rules, solver, generator, seeded RNG |
| `src/shared/game.ts` | Tries, ways, first finders, streaks, nations, leaderboard, player-built trials, over a small key-value interface |
| `src/shared/forge.ts` | Validation for player-built trials: limits, the maker's proof, and the solver check |
| `src/server/` | Devvit Web server (Hono): API, Journeys endpoints, scheduler, menu, install trigger |
| `src/client/` | The splash (inline in the feed) and the game (expanded), React and SVG |
| `tools/` | Season generator, calibration, local preview, screenshot harness, icon renderer |

## Credits

- World, nations, classes and creatures: Orvandel, by Jonathan Andrei.
- Icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite, Caro Asercion and DarkZaitzev, CC BY 3.0.
- Fonts: Cormorant Unicase and Alegreya Sans, SIL Open Font License.
- The board, moon, terrain and app icon are drawn in code.
