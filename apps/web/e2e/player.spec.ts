import { test, expect } from '@playwright/test';

// Two notes on every test below:
//
// 1. The only way to start playback on a cold page is a per-ayah "Play ayah
//    N" button — the persistent player bar renders nothing until something
//    has played (`PlayerProvider`'s `surahId` starts `null`). Its accessible
//    name is matched by substring by default, and "Play ayah 1" is itself a
//    substring of "Play ayah 10", "Play ayah 11", etc. on longer surahs, so
//    `exact: true` is required or the click hits Playwright's strict-mode
//    guard against multiple matches.
// 2. Where a test claims playback "survives navigation", it must navigate by
//    clicking a real `next/link` (a soft, client-side transition) — the
//    persistent `PlayerProvider` lives in the root layout and is exactly
//    what "survives navigation" is about. `page.goto()` is a hard browser
//    navigation: it reloads the document from scratch and would kill the
//    audio regardless of whether the feature works, making the assertion
//    meaningless. `page.goto()` is still the right tool for a page's very
//    first load, and for the reload test below where a real reload is the
//    point.

test('playback survives navigation and the highlight reattaches', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play ayah 1', exact: true }).click();

  // Wait for a word to actually highlight before judging anything else.
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  // Client-side navigation home, via the page's own "All surahs" link.
  await page.locator('a[href="/"]').click();
  // The bar persists and still names the surah.
  await expect(page.getByRole('link', { name: /Al-Fatihah/ })).toBeVisible();

  // Client-side navigation back. Both the surah-list row and the player
  // bar itself now link to /surah/1/ — either is a genuine soft navigation,
  // so take the first match rather than assert which element it is.
  await page.locator('a[href="/surah/1/"]').first().click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });
});

test('a different surah page is not highlighted while another plays', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play ayah 1', exact: true }).click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  // Client-side navigation to surah 2: home, then its row in the list.
  await page.locator('a[href="/"]').click();
  await page.locator('a[href="/surah/2/"]').click();

  // Surah 2's words must stay untouched while surah 1 plays.
  await page.waitForTimeout(2000);
  await expect(page.locator('.word--active')).toHaveCount(0);
});

// The Phase 1 defect: the control claimed "Pause" while audio was still loading.
//
// A snapshot taken right after the click cannot tell this apart from a
// perfectly correct app: every ayah's timing data has a lead-in of silence
// before its first transcribed word (600–1200ms in this data), so "no word
// highlighted yet" is also the normal, momentary state of real playback,
// not just of a stalled load. What's actually true by construction of a
// correct player is narrower: the control is *never allowed to render
// "Pause" before it has rendered "Loading" at least once* — `isLoading` is
// set the moment `playSurah` starts and can only clear on the audio
// element's real `playing` event, which is necessarily a later, separate
// commit. A MutationObserver records that sequence at DOM-mutation
// granularity, immune to the round-trip latency of polling from outside
// the page, which a local, sub-100ms-to-load file could easily slip past.
test('the control never claims to be playing while audio is still loading', async ({ page }) => {
  await page.goto('/surah/2/');

  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __labels: string[] }).__labels = seen;
    const record = () => {
      const btn = document.querySelector(
        'button[aria-label="Play"], button[aria-label="Pause"], button[aria-label="Loading"]',
      );
      const label = btn?.getAttribute('aria-label') ?? null;
      if (label && seen[seen.length - 1] !== label) seen.push(label);
    };
    new MutationObserver(record).observe(document.body, {
      attributes: true, attributeFilter: ['aria-label'], childList: true, subtree: true,
    });
  });

  await page.getByRole('button', { name: 'Play ayah 1', exact: true }).click();
  // Give the control time to settle into "Pause" so the full transition has
  // actually happened by the time we read the recorded sequence.
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 20_000 });

  const labels = await page.evaluate(
    () => (window as unknown as { __labels: string[] }).__labels,
  );
  const loadingIndex = labels.indexOf('Loading');
  const pauseIndex = labels.indexOf('Pause');
  // "Pause" appeared, so "Loading" must have appeared first.
  expect(loadingIndex).not.toBe(-1);
  expect(loadingIndex).toBeLessThan(pauseIndex);
});

// Requirement 3 end-to-end: when a surah ends while its own page is open,
// playback must continue into the next surah AND the page must follow. This
// starts from Al-Ikhlas's (surah 112) last ayah rather than its first: its
// audio is ~4s long, keeping this test fast, versus playing the whole
// ~12s surah from the start (already the shortest available surah).
test('surah ends -> next surah plays and the page follows', async ({ page }) => {
  await page.goto('/surah/112/');
  await page.getByRole('button', { name: 'Play ayah 4', exact: true }).click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  // The last ayah's audio finishes and playback runs on into surah 113,
  // taking the page with it.
  await expect(page).toHaveURL(/\/surah\/113\/?$/, { timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Al-Falaq/ })).toBeVisible();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });
});

test('the saved position is offered after a reload', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play ayah 1', exact: true }).click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  await page.goto('/');
  await page.reload();
  await expect(page.getByRole('link', { name: /Al-Fatihah/ })).toBeVisible();
});
