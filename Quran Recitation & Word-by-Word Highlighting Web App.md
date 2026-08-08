# Quran Recitation & Word-by-Word Highlighting Web App
## Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** August 9, 2026  
**Status:** Draft

---

## 1. Overview

Build a web application that allows users to listen to Quranic Surahs while reading the corresponding Arabic text.

The application should synchronize the audio recitation with the Quran text at the **word level**. As the Qari recites each word, that word should be visually highlighted in real time.

The experience should be similar to the word-by-word playback experience available on Quran.com.

---

# 2. Product Goals

The primary goals are:

1. Allow users to select and play any Quran Surah.
2. Allow users to start playback from any Ayah.
3. Display the complete Arabic text of the selected Surah.
4. Synchronize audio playback with individual Arabic words.
5. Highlight the currently recited word.
6. Support multiple Qaris/reciters.
7. Allow users to pause, resume, seek, and change playback speed.
8. Provide a clean, distraction-free Quran reading experience.
9. Make the application responsive for desktop, tablet, and mobile.
10. Use reliable Quran text and recitation sources.

---

# 3. Target Users

### Primary Users

- People who want to listen to Quran while following the Arabic text.
- Quran students learning correct pronunciation.
- Users memorizing Surahs.
- Users practicing Quran recitation.
- Users who want to follow along with a particular Qari.

### Secondary Users

- Teachers helping students follow recitation.
- Users who prefer specific Qaris.
- Users using the application on mobile devices.

---

# 4. Core User Experience

The main experience should be:

```text
Open Website
    ↓
Select Surah
    ↓
Select Qari
    ↓
Surah text loads
    ↓
Press Play
    ↓
Audio starts
    ↓
Current Ayah is identified
    ↓
Current Word is identified
    ↓
Word is highlighted
    ↓
Next word is highlighted
    ↓
Next Ayah
    ↓
Continue until Surah ends
```

---

# 5. Main Features

## 5.1 Surah Selection

Users should be able to select any Surah from the Quran.

The Surah selector should display:

- Surah number
- Arabic Surah name
- English/transliterated name
- Number of Ayahs

Example:

```text
1  الفاتحة        Al-Fatihah        7
2  البقرة         Al-Baqarah       286
3  آل عمران       Ali 'Imran       200
...
114 الناس         An-Nas           6
```

### Requirements

- Search Surah by name.
- Search by Surah number.
- Support Arabic and English search.
- Selecting a Surah loads its text.
- Default selected Surah can optionally be remembered.

---

# 6. Quran Text

The application must display authentic Quranic Arabic text.

Each Ayah should be represented as individual words rather than a single text string.

Example:

```text
بِسْمِ
اللَّهِ
الرَّحْمَٰنِ
الرَّحِيمِ
```

Internally, the application should have a structure similar to:

```json
{
  "surah": 1,
  "ayah": 1,
  "words": [
    {
      "id": "1:1:1",
      "text": "بِسْمِ"
    },
    {
      "id": "1:1:2",
      "text": "اللَّهِ"
    },
    {
      "id": "1:1:3",
      "text": "الرَّحْمَٰنِ"
    },
    {
      "id": "1:1:4",
      "text": "الرَّحِيمِ"
    }
  ]
}
```

This structure is important because the application needs to identify and highlight individual words.

---

# 7. Arabic Typography

Arabic Quran text should use a dedicated Quran-compatible Arabic font rather than a generic system Arabic font.

The UI should support:

- Quranic glyphs
- Diacritics
- Tajweed-related glyphs if the selected text source provides them
- Proper Arabic shaping
- RTL layout
- High readability

The font should be configurable so that a future version can support multiple Quran fonts.

Example:

```css
.quran-text {
  direction: rtl;
  font-family: "Quran Font";
}
```

The Arabic text should be displayed significantly larger than normal website text.

---

# 8. Ayah Display

Each Ayah should be visually separated.

Example:

```text
بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ۝

الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۝

الرَّحْمَٰنِ الرَّحِيمِ ۝
```

Each word must remain an individually addressable UI element.

Example HTML concept:

```html
<span data-word-id="1:1:1">بِسْمِ</span>
<span data-word-id="1:1:2">اللَّهِ</span>
<span data-word-id="1:1:3">الرَّحْمَٰنِ</span>
<span data-word-id="1:1:4">الرَّحِيمِ</span>
```

---

# 9. Audio Recitation

Users should be able to select from multiple Qaris.

Example:

- Mishary Rashid Alafasy
- Abdul Rahman Al-Sudais
- Maher Al-Muaiqly
- Saad Al-Ghamdi
- Abdul Basit
- Mahmoud Khalil Al-Husary
- Other available reciters

The actual initial list should depend on the selected licensed/open audio source.

### Qari Selector

Example:

```text
Qari
────────────────────
Mishary Rashid Alafasy
Abdul Rahman Al-Sudais
Maher Al-Muaiqly
Saad Al-Ghamdi
Abdul Basit
...
```

The user can change Qari without changing the selected Surah.

---

# 10. Word-Level Audio Synchronization

This is the **most important technical feature** of the application.

Normal audio files only provide:

```text
audio.mp3
```

They do not tell the application:

```text
0.00s → بِسْمِ
0.52s → اللَّهِ
1.01s → الرَّحْمَٰنِ
1.75s → الرَّحِيمِ
```

The application therefore needs **word-level timing metadata**.

Example:

```json
{
  "ayah": "1:1",
  "words": [
    {
      "word": "بِسْمِ",
      "start": 0,
      "end": 520
    },
    {
      "word": "اللَّهِ",
      "start": 520,
      "end": 1010
    },
    {
      "word": "الرَّحْمَٰنِ",
      "start": 1010,
      "end": 1750
    },
    {
      "word": "الرَّحِيمِ",
      "start": 1750,
      "end": 2500
    }
  ]
}
```

The frontend listens to the audio playback position:

```text
audio.currentTime
```

and determines which word's timestamp contains the current playback time.

---

# 11. Synchronization Algorithm

When audio starts:

```text
currentTime = audio.currentTime
```

Find the word where:

```text
word.start <= currentTime < word.end
```

Then:

```text
highlight(word)
```

When the audio progresses:

```text
0.00s → Word 1
0.52s → Word 2
1.01s → Word 3
1.75s → Word 4
```

The previous word loses its active state.

---

# 12. Highlighting Behavior

The currently recited word should have a clear visual state.

Example:

```text
بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
       ↑
   highlighted
```

The highlight should:

- Be visually obvious.
- Not make the Arabic text difficult to read.
- Transition smoothly.
- Work on mobile.
- Work with different Quran fonts.

Recommended states:

### Normal

```text
اللَّهِ
```

### Currently Playing

```text
[ اللَّهِ ]
```

### Previously Played

Remain normal unless a future reading mode introduces a different state.

---

# 13. Auto Scrolling

The application should automatically scroll the current Ayah into view.

If the user is listening to a long Surah:

```text
Ayah 1
Ayah 2
Ayah 3
...
Ayah 50
```

the application should automatically keep the currently playing Ayah visible.

### Behavior

When playback moves to an Ayah outside the viewport:

```text
scrollIntoView()
```

The scroll should be smooth rather than jumping abruptly.

### User Override

If the user manually scrolls:

- Do not aggressively fight the user's scrolling.
- The application can continue highlighting the current word.
- Optionally show a "Jump to current Ayah" button.

---

# 14. Playback Controls

The main audio player should provide:

### Required

- Play
- Pause
- Previous Ayah
- Next Ayah
- Seek
- Volume
- Progress bar
- Current time
- Total duration
- Playback speed
- Qari selection

Example:

```text
┌─────────────────────────────────────────────┐
│                 Surah Al-Fatihah            │
│                                             │
│  ───────────────●────────────────           │
│  01:24                         05:31        │
│                                             │
│       ◀      ▶      ▶      🔊               │
│                                             │
│       Speed: 1x     Qari: Alafasy           │
└─────────────────────────────────────────────┘
```

---

# 15. Start From Any Ayah

Users should be able to start playback from any Ayah.

Each Ayah should have a play button.

Example:

```text
Ayah 5

وَإِيَّاكَ نَسْتَعِينُ

                         ▶
```

When the user clicks the play button:

```text
Audio position → beginning of Ayah 5
Current word → first word of Ayah 5
```

---

# 16. Start From Any Word

This should ideally be supported.

When the user clicks an individual word:

```text
اللَّهِ
```

the application should:

1. Find the word's timestamp.
2. Seek the audio to that timestamp.
3. Start playback.
4. Highlight that word.

Example:

```text
User clicks:

الرَّحْمَٰنِ

        ↓

audio.currentTime = 1.01
        ↓
Play
        ↓
Highlight الرَّحْمَٰنِ
```

This provides a very powerful learning experience.

---

# 17. Repeat Functionality

A repeat feature should be included in the MVP if the synchronization data supports it.

Possible options:

```text
Repeat:
○ Off
○ Current Word
○ Current Ayah
○ Current Ayah × 3
○ Current Ayah × 5
○ Current Ayah × 10
○ Surah
```

For an initial MVP, the minimum requirement should be:

- Repeat Ayah
- Repeat Surah

---

# 18. Qari + Audio Compatibility

A major requirement is that the synchronization metadata must correspond to the exact audio recording.

The system must **never assume that timestamps from one Qari can be used for another Qari**.

For example:

```text
Qari A
Audio A
Timing A

Qari B
Audio B
Timing B
```

These must remain separate.

Data model:

```text
Reciter
   ↓
Audio
   ↓
Surah
   ↓
Ayah
   ↓
Word Timings
```

---

# 19. Data Sources

The application should use reliable Quran data providers.

Potential sources include:

### Quran Text

Possible sources:

- Quran.com APIs/data
- Tanzil Quran text
- Quranic Arabic Corpus
- Other established Quran datasets

### Audio

Possible sources:

- Quran.com audio infrastructure/APIs where permitted
- EveryAyah
- Other established Quran audio providers
- Public/open recitation datasets where licensing permits

### Word Timing

Potentially use:

- Existing word-by-word timing datasets
- Quran APIs providing word timestamps
- Recitation timing datasets
- A custom timing generation pipeline if necessary

Before production, every data source must be checked for:

1. License.
2. Commercial usage rights.
3. Redistribution rights.
4. API usage limits.
5. Attribution requirements.
6. Long-term availability.

**The application should not download/re-host copyrighted audio unless the license explicitly permits it.**

---

# 20. Recommended Data Strategy

The application should avoid tightly coupling the frontend to a single third-party provider.

Create an internal data abstraction:

```text
QuranDataProvider
AudioProvider
TimingProvider
```

For example:

```typescript
interface QuranTextProvider {
  getSurahs(): Promise<Surah[]>;
  getSurah(surahId: number): Promise<Surah>;
}

interface RecitationProvider {
  getReciters(): Promise<Reciter[]>;
  getAudio(reciterId: string, surahId: number): Promise<Audio>;
}

interface TimingProvider {
  getWordTimings(
    reciterId: string,
    surahId: number
  ): Promise<WordTiming[]>;
}
```

This allows the provider to be replaced later without rebuilding the entire application.

---

# 21. Application Architecture

Recommended architecture:

```text
                    ┌──────────────────┐
                    │    Web Browser   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   React / Next   │
                    │    Frontend      │
                    └────────┬─────────┘
                             │
                 ┌───────────┼───────────┐
                 │           │           │
                 ▼           ▼           ▼
             Quran API   Audio API   Timing API
                 │           │           │
                 └───────────┼───────────┘
                             │
                             ▼
                    External Data Sources
```

For the first version, a backend may not even be necessary if reliable public APIs can be consumed directly and their usage/license permits it.

However, a backend/data layer is recommended for production.

---

# 22. Recommended Tech Stack

## Frontend

Recommended:

- Next.js
- React
- TypeScript
- Tailwind CSS

Alternative:

- Vite + React

Next.js is recommended if SEO and future content pages are important.

---

## Backend

If required:

- Node.js
- NestJS

Possible responsibilities:

- Quran data caching
- Audio metadata
- Reciter management
- Timing metadata
- API abstraction
- User preferences
- Favorites
- Bookmarks

---

## Database

For the MVP, a database may not be required for Quran content if the data is static.

For application/user data:

- PostgreSQL

Potential future tables:

```text
users
user_preferences
bookmarks
recent_surahs
favorites
reciters
surahs
ayahs
words
word_timings
```

---

# 23. Data Model

## Surah

```typescript
interface Surah {
  id: number;
  nameArabic: string;
  nameEnglish: string;
  nameTransliteration: string;
  revelationPlace?: string;
  ayahCount: number;
}
```

## Ayah

```typescript
interface Ayah {
  id: string;
  surahId: number;
  ayahNumber: number;
  textArabic: string;
  words: QuranWord[];
}
```

## Word

```typescript
interface QuranWord {
  id: string;
  ayahId: string;
  position: number;
  text: string;
}
```

## Reciter

```typescript
interface Reciter {
  id: string;
  name: string;
  language?: string;
}
```

## Word Timing

```typescript
interface WordTiming {
  wordId: string;
  reciterId: string;
  startMs: number;
  endMs: number;
}
```

---

# 24. URL Structure

The application should have SEO-friendly URLs.

Example:

```text
/
```

Surah:

```text
/surah/al-fatihah
```

or:

```text
/surah/1
```

Ayah:

```text
/surah/al-fatihah/1
```

Potential future URL:

```text
/surah/al-fatihah?ayah=5
```

The URL should update when the user selects a Surah.

This allows users to share a specific Surah/Ayah.

---

# 25. Home Page

The home page should be simple.

Possible layout:

```text
              Quran Player

        Listen • Read • Follow Along

        ┌─────────────────────────┐
        │ Search Surah             │
        └─────────────────────────┘

        Recently Played

        Al-Fatihah
        Al-Baqarah
        Yasin

        All Surahs

        1. Al-Fatihah
        2. Al-Baqarah
        3. Ali 'Imran
        ...
```

---

# 26. Surah Page

Main page layout:

```text
┌─────────────────────────────────────────────┐
│  ← Quran                         Settings ⚙ │
├─────────────────────────────────────────────┤
│                                             │
│              سورة الفاتحة                   │
│              Al-Fatihah                     │
│                                             │
│              Qari: Alafasy                 │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│       بِسْمِ اللَّهِ الرَّحْمَٰنِ           │
│                  الرَّحِيمِ ۝               │
│                                             │
│       الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ │
│                                             │
│       الرَّحْمَٰنِ الرَّحِيمِ ۝             │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│        ◀      ▶      ▶      🔊              │
│        ─────────●──────────                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

# 27. Responsive Design

The application must be fully responsive.

### Desktop

Two possible layouts:

```text
┌───────────────────────────────────────────────┐
│                                               │
│              Quran Text                       │
│                                               │
│                                               │
├───────────────────────────────────────────────┤
│              Audio Player                     │
└───────────────────────────────────────────────┘
```

### Mobile

The audio player should remain easily accessible.

```text
┌──────────────────────┐
│ سورة الفاتحة         │
│                      │
│ بِسْمِ اللَّهِ ...   │
│                      │
│ الْحَمْدُ لِلَّهِ ... │
│                      │
│                      │
├──────────────────────┤
│ ▶  ─────●─────       │
│ Qari: Alafasy        │
└──────────────────────┘
```

A sticky bottom player is recommended on mobile.

---

# 28. Audio Player State

The frontend should maintain:

```typescript
interface PlayerState {
  isPlaying: boolean;
  surahId: number;
  ayahNumber: number;
  wordId?: string;
  currentTime: number;
  duration: number;
  reciterId: string;
  playbackRate: number;
}
```

---

# 29. Synchronization State

Example:

```typescript
interface PlaybackWord {
  wordId: string;
  startMs: number;
  endMs: number;
}
```

The player calculates:

```typescript
const activeWord = timings.find(
  word =>
    currentTime >= word.startMs &&
    currentTime < word.endMs
);
```

Then:

```typescript
setActiveWord(activeWord.wordId);
```

The Quran renderer receives:

```typescript
< QuranWord
  active={word.id === activeWordId}
/>
```

---

# 30. Performance Requirements

The application should remain responsive even when displaying an entire long Surah.

Requirements:

- Avoid unnecessary React re-renders.
- Do not update the entire Quran DOM every audio frame.
- Update only the currently active word where possible.
- Timing data should be efficiently indexed.
- Audio should stream rather than unnecessarily downloading the entire file.
- Use caching where permitted.

For long Surahs such as Al-Baqarah, virtualization may be considered if performance becomes an issue.

---

# 31. Accessibility

The application should support:

- Keyboard navigation.
- Play/pause keyboard shortcut.
- Accessible buttons.
- Proper ARIA labels.
- Screen-reader-friendly controls.
- High contrast mode.
- Responsive font sizing.

Arabic text should remain readable at different browser zoom levels.

---

# 32. User Settings

MVP settings:

### Quran Font Size

```text
A−   A   A+
```

### Playback Speed

```text
0.5x
0.75x
1x
1.25x
1.5x
2x
```

### Auto Scroll

```text
ON / OFF
```

### Theme

```text
Light
Dark
System
```

Future:

- Multiple Quran fonts
- Translation
- Tajweed mode
- Word translation
- Transliteration

---

# 33. Error Handling

The application should gracefully handle:

### Audio unavailable

```text
Unable to load this recitation.
Please try again or select another Qari.
```

### Timing unavailable

```text
Word-by-word synchronization is unavailable
for this recitation.
```

The user should still be able to listen to the audio.

### Network failure

Show:

```text
Connection lost.
Please check your internet connection.
```

---

# 34. Important Synchronization Fallback

Not every audio source will necessarily have word-level timing.

Therefore:

```text
Audio Available
       │
       ▼
Timing Available?
    /       \
  Yes        No
   │          │
   ▼          ▼
Word Sync   Audio Only
```

If timing is unavailable:

- Audio still plays.
- No incorrect word highlighting should occur.
- The application can optionally highlight the current Ayah if Ayah-level timing exists.

---

# 35. Caching

Static Quran text should be aggressively cached.

Possible cache layers:

```text
Browser Cache
     ↓
CDN
     ↓
Application Cache
     ↓
External API
```

Audio should use CDN/cache infrastructure where licensing and provider rules allow.

---

# 36. SEO

Each Surah should be indexable.

Example:

```text
Quran
Quran Al-Fatihah
Surah Al-Fatihah
Surah Al-Baqarah
Listen to Surah Al-Fatihah
```

Each Surah page should contain:

- Page title
- Meta description
- Canonical URL
- Open Graph metadata
- Structured data where appropriate

The application should avoid generating duplicate pages for the same Quran content.

---

# 37. Analytics

Optional for MVP.

If analytics are added, track anonymous product events such as:

```text
surah_opened
audio_played
audio_paused
reciter_changed
ayah_started
surah_completed
```

Do not collect unnecessary personal information.

---

# 38. MVP Scope

The first version should focus heavily on the core experience.

### MVP Features

- [x] 114 Surahs
- [x] Authentic Arabic Quran text
- [x] Arabic Quran font
- [x] Surah selection
- [x] Surah search
- [x] Multiple Qaris
- [x] Audio playback
- [x] Word-level timing
- [x] Current-word highlighting
- [x] Current-Ayah auto-scroll
- [x] Play/pause
- [x] Seek
- [x] Volume
- [x] Playback speed
- [x] Start from Ayah
- [x] Click word to start playback
- [x] Responsive design
- [x] Dark/light mode
- [x] Basic error handling

---

# 39. Phase 2 Features

After the MVP is stable:

### Quran Translation

Display translation below Arabic.

Example:

```text
الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ

[All praise is due to Allah, Lord of the worlds.]
```

### Word Translation

When clicking a word:

```text
اللَّهِ

Allah
```

### Multiple Translations

Allow users to select translations.

### Tajweed

Color-coded Tajweed rules.

### Bookmarks

Users can save Ayahs.

### Continue Reading

Remember the user's last position.

---

# 40. Phase 3 Features

Potential advanced functionality:

### Memorization Mode

Hide words and reveal them progressively.

### Repeat Practice

```text
Ayah 1 × 5
Ayah 2 × 5
Ayah 3 × 5
```

### Recitation Recording

Allow users to record their own recitation.

### AI Recitation Analysis

Future possibility:

```text
User Recites
     ↓
Speech Recognition
     ↓
Compare with Quran
     ↓
Identify possible mistakes
```

This should be treated as a separate product feature because it introduces significantly more complexity.

---

# 41. Security

If authentication is introduced:

- Secure session management.
- HTTPS only.
- Rate limiting.
- Input validation.
- Secure cookies.
- No sensitive information stored unnecessarily.

If the MVP does not require accounts, authentication should not be added just for the sake of it.

---

# 42. Copyright & Licensing Requirements

This is a critical project requirement.

Before using any Quran text, audio, font, or timing dataset in production, verify:

### Quran Text

- Source
- License
- Modification rights
- Redistribution rights

### Audio

- Reciter rights
- Recording rights
- Hosting/streaming rights
- Commercial/non-commercial restrictions

### Fonts

- Font license
- Web embedding rights

### Timing Data

- Dataset license
- Redistribution rights

The application should maintain a `DATA_SOURCES.md` file documenting the source and license for every external dataset.

---

# 43. Suggested Project Structure

```text
quran-web/
│
├── apps/
│   └── web/
│       ├── app/
│       │   ├── page.tsx
│       │   ├── surah/
│       │   │   └── [surah]/
│       │   │       └── page.tsx
│       │   └── api/
│       │
│       ├── components/
│       │   ├── QuranReader/
│       │   ├── QuranWord/
│       │   ├── Ayah/
│       │   ├── SurahSelector/
│       │   ├── AudioPlayer/
│       │   ├── ReciterSelector/
│       │   └── Settings/
│       │
│       ├── hooks/
│       │   ├── useAudioPlayer.ts
│       │   ├── useWordSync.ts
│       │   └── useAutoScroll.ts
│       │
│       ├── services/
│       │   ├── quran/
│       │   ├── audio/
│       │   └── timing/
│       │
│       └── types/
│
├── packages/
│   ├── quran-data/
│   ├── audio-sync/
│   └── ui/
│
├── data/
│   ├── quran/
│   ├── timings/
│   └── reciters/
│
└── docs/
    └── DATA_SOURCES.md
```

---

# 44. Core Frontend Components

## QuranReader

Responsible for:

- Rendering Surah.
- Rendering Ayahs.
- Rendering words.
- Highlighting current word.
- Auto-scroll.

## AudioPlayer

Responsible for:

- Audio element.
- Play/pause.
- Seeking.
- Volume.
- Speed.
- Playback events.

## WordSyncEngine

Responsible for:

- Reading current audio position.
- Finding active word.
- Updating active word.
- Moving between Ayahs.

## ReciterSelector

Responsible for:

- Listing Qaris.
- Selecting Qari.
- Loading corresponding audio/timing data.

---

# 45. Word Synchronization Engine

The synchronization engine should be independent from the UI.

Conceptually:

```text
Audio
 │
 │ currentTime
 ▼
Sync Engine
 │
 │ activeWordId
 ▼
Quran Reader
 │
 ▼
Highlighted Word
```

This is important because it allows future support for:

- Different UI layouts.
- Mobile apps.
- Translation synchronization.
- Memorization mode.
- Multiple timing formats.

---

# 46. Acceptance Criteria

The MVP is considered successful when:

### Quran

- User can select all 114 Surahs.
- Correct Arabic text is displayed.
- Text is displayed RTL.
- Quran font renders correctly.

### Audio

- User can select a supported Qari.
- Audio loads successfully.
- Play/pause works.
- Seeking works.
- Playback speed works.

### Synchronization

- Correct word is highlighted during playback.
- Highlight moves smoothly from word to word.
- Ayah transitions are synchronized.
- Long Surahs remain synchronized.
- Seeking updates the highlighted word correctly.
- Starting from an Ayah starts synchronization correctly.
- Clicking a word seeks to that word where supported.

### UX

- Current Ayah remains visible.
- Mobile experience works correctly.
- Desktop experience works correctly.
- No significant UI lag occurs during playback.

---

# 47. Key Technical Risks

## Risk 1 — Word Timing Availability

This is the biggest risk.

Having Quran text + audio is relatively easy.

Having:

```text
Quran Word
+
Exact Audio Timestamp
+
Same Recording
```

is the difficult part.

The project should validate available timing datasets **before committing to a specific audio provider**.

---

## Risk 2 — Different Quran Text Representations

Different providers may represent words differently.

For example, one dataset might split:

```text
وَالْحَمْدُ
```

differently from another.

Therefore, Quran text IDs should be based on stable identifiers such as:

```text
Surah : Ayah : Word
```

where possible.

---

## Risk 3 — Audio Provider Changes

Third-party APIs can change or disappear.

Therefore, the application should have an abstraction layer and preferably cache static metadata.

---

## Risk 4 — Licensing

Audio and timing datasets must be verified before production.

This should be treated as a technical requirement, not something to check after development.

---

# 48. Development Plan

## Phase 1 — Data Validation

Before building UI:

1. Identify Quran text source.
2. Identify Arabic font.
3. Identify audio source.
4. Identify Qari list.
5. Identify word-level timing source.
6. Verify licenses.
7. Verify that audio and timing datasets correspond.
8. Build a small proof of concept using Al-Fatihah.

### POC Goal

```text
Al-Fatihah
+
One Qari
+
Audio
+
Word timings
+
Highlighting
```

If this works reliably, proceed with the full application.

---

# 49. Phase 2 — Core Player

Build:

- Audio engine.
- Timing engine.
- Word highlighting.
- Ayah navigation.
- Seek.
- Play/pause.
- Auto-scroll.

---

# 50. Phase 3 — Quran Library

Add:

- 114 Surahs.
- Surah search.
- Surah navigation.
- Qari selection.
- Multiple audio sources.

---

# 51. Phase 4 — UI/UX

Build:

- Responsive layout.
- Mobile player.
- Dark mode.
- Settings.
- Font controls.
- Loading states.
- Error states.

---

# 52. Phase 5 — Testing

Test:

- Short Surahs.
- Long Surahs.
- Different Qaris.
- Slow playback.
- Fast playback.
- Seeking.
- Browser refresh.
- Mobile browsers.
- Desktop browsers.
- Slow internet.
- Audio interruptions.

Special attention should be given to synchronization after seeking.

---

# 53. Browser Compatibility

Target:

- Chrome
- Safari
- Firefox
- Edge
- iOS Safari
- Android Chrome

The application should use standard HTML5 audio APIs wherever possible.

---

# 54. Performance Target

Initial targets:

```text
Initial page load:        < 2–3 seconds
Audio start:              < 2 seconds where network permits
Word sync accuracy:       ideally within ~50–100ms
UI frame rate:             60 FPS target
```

Synchronization accuracy will ultimately depend on the quality of the timing dataset.

---

# 55. Final MVP Architecture

The recommended MVP architecture is:

```text
                   ┌─────────────────────┐
                   │      Next.js        │
                   │      React App      │
                   └──────────┬──────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
       Quran Text         Audio Data      Timing Data
             │                │                │
             └────────────────┼────────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Sync Engine     │
                     │                 │
                     │ Audio Position  │
                     │       ↓         │
                     │ Active Word     │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Quran Reader    │
                     │                 │
                     │ Arabic Text     │
                     │       +         │
                     │ Word Highlight  │
                     └─────────────────┘
```

---

# 56. Definition of Done

The MVP is complete when a user can:

1. Open the website.
2. Select any Surah.
3. Select a supported Qari.
4. See the Arabic Quran text.
5. Press Play.
6. Hear the recitation.
7. See the exact currently recited word highlighted.
8. Watch the highlight move word-by-word.
9. Automatically follow the current Ayah.
10. Pause/resume playback.
11. Seek through the audio.
12. Start playback from a specific Ayah.
13. Start playback from a specific word where timing data supports it.
14. Change playback speed.
15. Use the application comfortably on desktop and mobile.

---

# 57. Most Important Implementation Decision

Before starting the complete UI, the development team should build a **small synchronization proof of concept**.

The POC should contain only:

```text
Al-Fatihah
     +
1 Qari
     +
Audio
     +
Word Timing Data
     +
Arabic Text
     +
Word Highlighting
```

The POC should prove that:

```text
Audio timestamp
       ↓
Correct Quran word
       ↓
Correct visual highlight
```

works reliably.

**Do not build the complete application until this POC is working.**

The hardest part of this application is not the Quran reader or audio player. It is obtaining and reliably mapping **word-level timestamps to the exact Quran text and exact recitation audio**.

Once that data pipeline is confirmed, the rest of the application is relatively straightforward.

---

# 58. Future Product Vision

The long-term application can become more than an audio player:

```text
                    Quran App
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ▼                ▼                ▼
    Listen            Read           Memorize
       │                │                │
       ▼                ▼                ▼
 Multiple Qaris    Translations    Repeat Ayah
 Word Sync         Tafsir          Hide Words
 Tajweed           Word Meaning    Practice
       │
       ▼
 Recitation Practice
       │
       ▼
 AI-assisted Recitation Feedback
```

The MVP should remain focused on one excellent experience:

> **Listen to the Quran and follow every word as it is recited.**

That core experience should be fast, accurate, simple, and respectful of the Quranic text.