# Golden Shift — a 3D fast-food simulator that runs in the browser

Take orders, work the grill and the fryer, keep the queue happy, level up your crew — and
run the rush together with friends.

Built as a **custom WebGL engine with zero dependencies and zero asset downloads**. No
Three.js, no model files, no textures to fetch: every mesh and every texture is generated
procedurally at load time. The whole game is ~150&nbsp;KB of source and boots in well under a
second on a Chromebook.

```
open index.html          # that's it — or serve the folder over http for multiplayer
```

Multiplayer needs the page served over `http(s)://` (the Firebase SDK is an ES module).
Solo play works straight off the filesystem.

```bash
python3 -m http.server 8000     # then visit http://localhost:8000
```

---

## Playing

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look — click the canvas to lock the pointer |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` / left click | Interact: take an order, start cooking, collect food, serve |
| `Q` / right click | Drop the top item |
| `T` | Chat with your crew (co-op) |
| `Esc` | Pause menu |
| `F3` | FPS / draw-call overlay |

**The loop.** Customers come in and queue at the register. Press `E` at the register to take
an order — a ticket appears on the left with the icons you need. Walk to the right station
and press `E` to start each item; the station picks whatever your open tickets are short of,
so you never have to fiddle with a menu. Watch the progress bar: green means ready, orange
means it is about to burn. Press `E` again to put it on your tray (four items max), then
serve at the pickup counter.

Faster service pays more, streaks multiply your take, and burnt food halves it. Customers
who run out of patience walk out and cost you rating. Levelling up unlocks Nuggets,
McFlurry and the Big Mac — and raises every payout.

Yes, the ice cream machine breaks. That is not a bug.

---

## Performance

The target is a locked 60 FPS on integrated graphics with no dedicated GPU.

* **~2 draw calls for the entire restaurant.** All static geometry is baked into one
  interleaved buffer sharing one 512×512 texture atlas, so the building — floors, walls,
  counters, kitchen, tables, car park, skyline — draws in a single `drawElements`.
* **~20k vertices / ~11k triangles for the whole world**, including every prop.
* **One shader, gouraud lighting, no post-processing, no shadow maps.** Ambient occlusion is
  baked into a vertex-colour channel; contact shadows are one multiply-blended decal pass.
* **Procedural everything.** The texture atlas is painted onto a canvas at boot (~1 ms) and
  the sound effects are synthesised with WebAudio, so the game makes zero network requests.
* **Adaptive resolution.** The internal render target scales between 55% and 100% to hold
  60 FPS while the UI stays crisp at native resolution.
* **Auto-detected quality preset** from the GPU string, core count and device memory —
  Potato / Low / Medium / High, all overridable in Settings.

Typical frame on a low-end Chromebook: 30–40 draw calls, ~11k triangles, no allocation in
the hot path.

---

## Multiplayer & the leaderboard

Co-op and the leaderboard run on the **`mickeyd-s` Firebase project**, already wired up:
the config lives in `src/firebase-config.js`, anonymous auth is enabled, and
`firebase.rules.json` is published to the Realtime Database.

To redeploy the rules after editing them:

```bash
firebase deploy --only database
```

Anyone can point the game at a **different** Firebase project without touching the code —
open **Multiplayer → Connection**, paste that project's web config, and it is stored in
localStorage for that browser only.

<details>
<summary>Setting up a fresh Firebase project from scratch</summary>

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Realtime Database → Create database.**
3. **Build → Authentication → Sign-in method → Anonymous → Enable.**
4. **Project settings → Your apps → Web app**, copy the config into
   `src/firebase-config.js` (or paste it into the in-game Connection panel).
5. `firebase deploy --only database` to publish `firebase.rules.json`.

</details>

### About the API key

Firebase web config values are **public by design** — the SDK ships them to every browser
that loads the page, and the API key is a project identifier rather than a credential.
Access control is entirely in `firebase.rules.json`, which is verified to enforce:

* you can only write your own profile, score and player position
* a friend code can be claimed once and never stolen
* **a room is readable and joinable only by uids on the host's allow-list** — the friends-only
  guarantee holds even if someone guesses a room code
* only the host may write the shared simulation snapshot
* scores are range-checked, so the leaderboard cannot be stuffed

Then:

* **Friends** tab — you get a 6-character friend code. Swap codes, send a request, and the
  other player accepts. That's the only way to become crew.
* **Kitchen** tab — *Open kitchen* gives you a room code. Only players on your friends list
  can join it; anyone else is refused by both the client and the database rules.
* **Leaderboard** — best shift score (revenue + customers served + level), filterable to
  friends only.

### How co-op is synchronised

The host simulates the customers and owns the station timers, publishing a compact snapshot
about six times a second (customers are packed into a single delimited string, not one JSON
node each). Every player streams their own position at ~12 Hz and interpolates everyone
else. Cooking and serving are sent as small events that the host validates and folds into
the shared shift — so money, XP and level are a team score. If the host leaves, the room
closes and everyone drops back to solo.

Bandwidth is a few KB/s per player, which sits comfortably inside the Firebase free tier.

---

## Deploying

The site is static, so any host works. It is set up for Vercel:

```bash
vercel --prod
```

`vercel.json` runs `build.js`, which does two things and nothing else:

1. **Regenerates `src/firebase-config.js` from `FIREBASE_*` environment variables** when they
   are set, so the project can be configured on Vercel instead of in git. With no env vars
   present it leaves the committed config alone, which is what keeps local and `file://`
   play working.
2. **Stamps a content hash onto every `<script src>` query string**, so `src/*` can be served
   `immutable` for a year while a redeploy can never serve a stale mix of modules.

The environment variables it reads:

```
FIREBASE_API_KEY            FIREBASE_PROJECT_ID
FIREBASE_AUTH_DOMAIN        FIREBASE_STORAGE_BUCKET
FIREBASE_DATABASE_URL       FIREBASE_MESSAGING_SENDER_ID
                            FIREBASE_APP_ID
```

## Layout

```
index.html              markup, HUD, menus, all CSS
src/math.js             mat4 / vector helpers, seeded PRNG
src/atlas.js            procedural 512×512 texture atlas (16 tiles)
src/geom.js             geometry builder — boxes, cylinders, tiled quads, baked AO
src/gl.js               the WebGL1 renderer: one shader, four blend modes
src/props.js            humanoids, food, props — one dynamic mesh of named ranges
src/world.js            the restaurant: geometry, colliders, nav points, interaction points
src/net.js              Firebase: auth, friend codes, rooms, sync, leaderboard
src/game.js             player controller, customer AI, stations, economy, rendering
src/ui.js               HUD, menus, settings, multiplayer panels, leaderboard
src/main.js             boot, input, frame loop, adaptive resolution
firebase.rules.json     Realtime Database security rules
firebase.json           Firebase CLI config (database rules target)
build.js                optional build step: env-var config + cache-busting
vercel.json             static hosting config and cache headers
```

No build step. No package manager. Edit a file and reload.

---

## If it will not start

The game reports failures rather than hanging, and tries to recover on its own:

1. **Full detail fails → it retries in safe mode automatically** (512px atlas, lite
   world, no mipmaps or particles). You'll see a "running in safe mode" notice.
2. **A script did not arrive** — common behind school network filters or a stale
   proxy cache — it names the file and re-fetches it with a cache-busting URL.
3. **Both fail** → an on-screen panel shows the actual error plus **Copy details**
   (user agent, GPU, driver limits, extensions, vertex counts, stack) and a
   **Try safe mode** button.

You can force the conservative path at any time by adding `?safe=1` to the URL.

Assets are served `must-revalidate` rather than `immutable`: the files are tiny,
and a caching proxy that ignores the `?v=` query string would otherwise pin an
old copy for a year.
