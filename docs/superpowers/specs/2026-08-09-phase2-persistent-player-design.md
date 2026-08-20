# Phase 2 — Persistent Player, Offline Audio, Resume

**Date:** 2026-08-09
**Status:** Approved for planning
**Branch:** `phase-2-player`
**Builds on:** `docs/superpowers/specs/2026-08-09-quran-word-highlighting-design.md`

---

## 1. Scope

Three features, one shared architectural change.

1. **Persistent player** — audio keeps playing across in-app navigation, with a
   player visible on every page. Opening the surah that is playing reattaches
   word highlighting mid-recitation.
2. **Offline audio** — a per-surah download button, a screen listing what is
   stored with sizes, and deletion to reclaim space. Underneath it, a small
   automatic cache so replaying recent audio does not re-download.
3. **Resume** — the player shows the last position when nothing is playing, and
   resumes exactly there.

### Out of scope

Playback speed, repeat modes, translations, bookmarks, multiple reciters,
search, themes. Restoring *playback* (not just position) after a hard refresh —
browsers require a user gesture, so the player can only offer a play button.

---

## 2. The architectural change

Today `AyahPlaylist`, `SyncEngine`, and `Timeline` are constructed inside
`app/surah/[id]/SurahClient.tsx`. Navigating unmounts that component and
destroys the audio.

They move into **`PlayerProvider`, mounted in `app/layout.tsx`**. The App Router
keeps the layout mounted across client-side navigation, so the audio element
survives. The surah page becomes a consumer of that context.

This works only because `lib/sync/` imports nothing from React — a constraint
from the Phase 1 spec, adopted for exactly this reason. The engine does not
change.

### Context API

```ts
interface PlayerState {
  surahId: number | null;
  surahName: string | null;
  ayah: number;          // 1-based, for display
  ayahIndex: number;     // 0-based, into the timings array
  totalAyahs: number;
  isPlaying: boolean;
  isLoading: boolean;    // audio requested but not yet producing sound
  currentMs: number;     // global position within the surah
  totalMs: number;
  volume: number;
  error: string | null;
}

interface PlayerActions {
  playSurah(surahId: number, opts?: { ayah?: number; localMs?: number; autoplay?: boolean }): Promise<void>;
  playWord(wordId: string): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(globalMs: number): void;
  setVolume(volume: number): void;

  /** Page hands its timings over so the provider need not refetch. */
  primeTimings(surahId: number, timings: SurahTimings): void;

  /** Page registers its DOM word map. Returns a detach function. */
  attachRegistry(surahId: number, registry: WordRegistry): () => void;
}
```

### The registry attach protocol

DOM word nodes belong to the page; the engine now lives above it. So
`WordRegistry` stays page-owned and the page registers it:

- **Mount** — the page calls `attachRegistry(surahId, registry)` in an effect.
- **Highlight writes are conditional.** The provider writes to the attached
  registry only when `attachedSurahId === playingSurahId`. Browsing surah 5
  while surah 2 plays must not paint highlights onto surah 5's words.
- **Unmount** — the returned detach function clears the reference. Audio
  continues; nothing is highlighted until a matching page mounts again.
- **Reattach mid-playback** — on attach, the provider immediately pushes the
  current word id, so returning to a playing surah highlights the right word
  without waiting for the next word boundary. `SyncEngine.onChange` already
  replays its last value to late subscribers; this reuses that.

### Data layout change

The provider must advance through ayahs for a surah whose page is not mounted,
so it needs that surah's timings without a page render. Today they are imported
server-side from `data/timings/`.

**Move `data/timings/` to `public/timings/`.** The build still reads the files
for pre-rendering, and the client can fetch the same file at runtime. One copy,
two consumers. `data/text/` stays where it is — only page rendering needs it.

`loadTimings(surahId)` fetches `/timings/abdulbasit-murattal/{id}.json` and
memoises in a module-level map. `primeTimings` lets a surah page hand over the
timings it already has, so opening a surah and pressing play costs no extra
request.

---

## 3. Offline audio — NOT BUILT

Dropped after implementation began. A service worker cannot read a cross-origin
response without CORS headers, and neither `github.com` release URLs nor their
`release-assets.githubusercontent.com` redirect target sends any. A Vercel
rewrite was tested and passes the 302 through rather than following it, so the
browser still receives an opaque response. Keeping audio on GitHub Releases and
dropping offline support was chosen over moving to Quran.com's CDN or proxying
every byte through a Vercel Function.

The original design is preserved below for the record.

### Original design

### Service worker

`public/sw.js`, registered from a client component, scope `/`. Two caches:

| Cache | Contents | Eviction |
|---|---|---|
| `quran-audio-pinned-v1` | Surahs the user explicitly downloaded | Never — only explicit deletion |
| `quran-audio-runtime-v1` | Audio fetched during normal playback | Least-recently-used above a 100 MB budget |

**Fetch handler**, for requests matching the audio origin: pinned → runtime →
network. A network response is cloned into the runtime cache, then the budget is
enforced.

The runtime cache is what fixes the original complaint: GitHub release assets
carry no `cache-control`, so without it every replay re-downloads. It is
invisible — no UI, no user decision.

**LRU bookkeeping.** A service worker cannot use `localStorage`. The runtime
index lives in IndexedDB as `{ url, size, lastUsed }` records. Eviction selects
victims through a pure function:

```ts
selectEvictions(entries: CacheEntry[], budgetBytes: number): string[]
```

Pure so it can be unit-tested without a browser — the correctness-critical part
is the selection, not the deletion.

### Download manager

`lib/offline/downloadManager.ts` talks to the worker by `postMessage`:

| Message | Direction | Purpose |
|---|---|---|
| `download` | page → sw | Fetch every ayah of a surah into the pinned cache |
| `progress` | sw → page | `{ surahId, done, total, bytes }` |
| `delete` | page → sw | Remove one surah from the pinned cache |
| `status` | page → sw | Which surahs are pinned, and their sizes |

A download is resumable in the same sense as the fetch script: files already
present are skipped, so an interrupted download continues rather than restarting.

### Downloads screen

`app/downloads/page.tsx` lists surahs with their download state and size, a
per-surah download or delete button, and total storage used against
`navigator.storage.estimate()`.

**Quota handling matters here.** iOS Safari grants far less origin storage than
Chrome and evicts aggressively. A `QuotaExceededError` during download must stop
cleanly and say so plainly — "Not enough storage to download Al-Baqarah (232 MB).
Free space by deleting other surahs." — rather than failing silently or leaving
a half-downloaded surah marked as available.

---

## 4. Resume

`lib/player/lastPosition.ts` reads and writes one `localStorage` key:

```ts
interface LastPosition {
  surahId: number;
  ayah: number;
  localMs: number;
  updatedAt: number;
}
```

Written on ayah change and on pause, throttled so it does not write on every
frame. Reads tolerate absent, malformed, or out-of-range values by returning
`null` — a corrupt entry must never break the home page.

When nothing is playing, the player bar shows that position — surah name and
ayah — with a play button that resumes exactly there. This is why no separate
"Continue reading" card is needed: the player bar is the resume affordance.

---

## 5. Player UI

One player component rendered by the layout, visible on every page.

- Surah name and `ayah N / total`
- Play/pause, previous, next, whole-surah progress bar, volume
- Tapping the surah name navigates to that surah
- When nothing has ever played and there is no saved position, the bar is hidden
  entirely rather than shown empty

The surah page no longer renders its own `AudioPlayer`; it consumes the same
provider. The existing `ProgressBar`, `PlayerIcons`, and transport styling are
reused as-is.

### Loading state fix

Phase 1 flips the button to "Pause" the instant `play()` is called, while audio
is still being fetched. Measured against production with a cold cache:

| Surah | Button shows Pause | First word highlights | Gap |
|---|---|---|---|
| 1 | 100 ms | 817 ms | 717 ms |
| 2 | 66 ms | 1401 ms | 1335 ms |
| 18 | 63 ms | 1494 ms | 1431 ms |

That gap is what looked like broken highlighting. The player now holds
`isLoading` until audio actually produces sound (`playing` event), showing a
spinner rather than a pause icon. Cached and downloaded audio makes the gap
disappear entirely.

---

## 6. Error handling

| Condition | Behaviour |
|---|---|
| Audio fails to load | Existing per-ayah error surfaces in the player bar with retry. Unchanged from Phase 1. |
| Timings fetch fails | Playback is refused with a clear message rather than starting audio that cannot highlight. |
| Service worker unsupported or blocked | Everything still works, just without caching or downloads. The downloads screen explains why it is unavailable rather than showing broken buttons. |
| Storage quota exceeded | Download stops, partial files are removed so the surah is not falsely listed as available, and the message names the space needed. |
| Saved position references missing data | Treated as no saved position. |

---

## 7. Testing

**Pure logic, unit-tested:**

- `selectEvictions` — budget maths, ties, empty input, single oversized entry
- `lastPosition` — round-trip, absent key, malformed JSON, out-of-range ayah
- Provider state transitions, driven through a fake playlist rather than real audio

**Behavioural:**

- Highlight writes go to the attached registry only when its surah is playing —
  the guard against painting surah 5 while surah 2 plays
- Attaching mid-playback highlights the current word immediately
- Detaching leaves playback running

**Integration, with Playwright** (installed during Phase 1 debugging):

- Start playback, navigate away, confirm audio continues and the bar persists
- Return to the playing surah, confirm the highlight resumes on the right word
- Reload with a saved position, confirm the bar offers it and resuming lands correctly

The Playwright reproduction that diagnosed the loading gap becomes a regression
test: assert the button does not claim "Pause" while audio is still loading.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Provider becomes a god object | Playlist, engine, and timeline stay separate modules; the provider only wires them and exposes state |
| Highlight leaks across surahs | Explicit surah-id guard on every registry write, with a test |
| iOS storage limits | Quota checked before download, failures surfaced plainly, partial downloads cleaned up |
| Service worker caching stale audio | Audio files are immutable — a given ayah's bytes never change — so staleness is not a concern. Cache names are versioned for future format changes. |
| Moving `timings/` breaks Phase 1 loaders | `getSurahTimings` updated to the new path; the cross-file integrity check (77,429 words, zero mismatches) reruns as verification |

---

## 9. Definition of done

Press play on a surah, navigate to the surah list and into a different surah,
and the recitation continues without interruption with the player bar visible
throughout. Return to the playing surah and the highlight picks up on the
correct word. Download a surah, go offline, and it still plays. Delete it and
the space is reclaimed. Close the site, reopen it, and the player offers the
exact position where listening stopped.
