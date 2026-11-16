# Foefall: Devpost submission draft

Draft, 15 November 2026. Every `[X]` is a fact still to be measured or confirmed; nothing here is invented. Final values go in the fenced blocks only.

## Project name

```
Foefall
```

## Elevator pitch (200 characters max)

```
Every monster shows where it will strike. Make them strike each other. A daily tactics puzzle ported from my MMO Orvandel, where the subreddit hunts every way to win. [X redditors, Y ways found]
```

## Port note (the form asks ports to say so)

```
This is a port. Foefall brings the world, nations, hero classes, creatures and signature combat mechanic of Orvandel, my browser MMORPG (play.jonathansolvesproblems.com), to Reddit as a daily game. The Devvit app was built new for this hackathon from 15 November 2026.
```

## Story

### Inspiration

In Orvandel, the MMO I have been building, the big attacks are marked on the ground before they land. You see the circle, the cone, the line, and you step out. Foefall turns that around: one board, one turn, every strike marked in advance, and the only way to win is to make the monsters hit each other.

### What it does

A new trial goes up in the subreddit every day. Each monster shows the tiles it will strike: the Duskfield Wolf bites the tile it faces, the Thornback Boar shakes thorns on all four sides, the Shardrunner Thief throws a knife at the first thing in its path, the Cinder Acolyte calls fire two tiles ahead. Your heroes each move once and use one ability: shove, hurl, drag, swap, or drop a falling star. Then you press Strike and every monster strikes at the same moment. Clear the board with every hero standing and every lamp lit.

A forecast above the board updates on every tap, so you always see who will fall before you commit. Undo is free; only Strike counts as a try.

Most trials can be won more than one way, and that is the Reddit part. The post shows how many ways the subreddit has found, and the first redditor to find each way gets their name and avatar on it. After a clear you can leave your result in the day's thread, pick one of Orvandel's four nations for your flair, and build a trial of your own: place the monsters, check it with the solver, clear it yourself to prove it, and post it for everyone to hunt. Every Sunday the week's best-liked player trial goes up again as the community pick.

The week follows the moon: gentle under the New Moon on Monday, fiendish under the Broken Moon on Saturday, and many paths on Sunday.

### How I built it

Devvit Web: an inline launch screen in the feed and an expanded game view, both React and SVG, over a Hono server with Redis. The scheduler posts each day's trial at 00:01 UTC. User actions post the chalk-mark comment and the subscribe prompt, the app sets user flair for nation and streak, and Devvit Journeys records each session (start on the first move, progress per hero action, end on a win). A player-built trial becomes its own interactive post.

Every trial is generated backwards so it can be won: monsters placed so their strikes land on each other, then each hero's ability undone once, then the heroes scattered. An exhaustive solver then plays every order of heroes, every tile and every target, and keeps a trial only if it can be won, cannot be won by doing nothing, needs every hero, and has the number of ways its weekday calls for. The server replays every claimed turn with the same rules before recording it.

### Challenges I ran into

The first rules had monsters strike one after another. Before writing a test I worked out that the last monster to strike could then never be hit, so a full clear through strikes was impossible. Making every monster strike at the same moment fixed it and made the board easier to read.

On a real phone, an older Reddit app showed only the post's text fallback. The fallback now tells people to update the app or open the post in a browser.

### Accomplishments that I'm proud of

- 120 days of trials, each checked by the solver, with `npm test` re-solving every one.
- Played end to end on a real Galaxy S24 in the Reddit app, signed out, from the feed card to a win.
- [X: the first public numbers, e.g. players, clears and ways found on the first trials, from the Journeys dashboard or the post counters]

### What I learned

[X]

### What's next for Foefall

[X: the community outreach sent before submitting, named].

## Built with

```
devvit, react, typescript, hono, redis, vite, vitest, playwright
```

## Links

```
App listing: https://developers.reddit.com/apps/foefall
Demo post: [X: the r/Foefall post]
Repo: https://github.com/JonathanSolvesProblems/foefall
Orvandel: https://play.jonathansolvesproblems.com
```

## Credits (also in the app's help sheet and the README)

Icons from game-icons.net by Lorc, Delapouite, Caro Asercion and DarkZaitzev (CC BY 3.0). Fonts: Cormorant Unicase and Alegreya Sans (SIL Open Font License). The board, moon and app icon are drawn in code.
