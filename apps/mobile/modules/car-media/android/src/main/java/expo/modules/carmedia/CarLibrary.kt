package expo.modules.carmedia

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import java.text.Normalizer

/** The browse tree: `root` → 114 playable surah rows. Pure data + matching; the service adapts it. */
class CarLibrary(private val surahs: List<Surah>, private val artworkUri: Uri? = null) {
  data class Surah(
    val id: Int,
    val nameSimple: String,
    val nameArabic: String,
    val nameEnglish: String,
    val ayahCount: Int,
  )

  fun root(): MediaItem = MediaItem.Builder().setMediaId("root")
    .setMediaMetadata(
      MediaMetadata.Builder().setTitle("Quran").setIsBrowsable(true).setIsPlayable(false)
        .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()
    ).build()

  fun children(parentId: String): List<MediaItem>? = if (parentId == "root") surahs.map(::row) else null

  fun item(mediaId: String): MediaItem? = surahs.firstOrNull { "surah:${it.id}" == mediaId }?.let(::row)

  fun search(query: String): List<MediaItem> {
    val q = fold(stripSurahWord(query))
    if (q.isBlank()) return emptyList()
    q.toIntOrNull()?.let { n -> surahs.firstOrNull { it.id == n }?.let { return listOf(row(it)) } }
    val scored = surahs.mapNotNull { s ->
      // The Arabic name is folded too: NFD strips the hamza carriers, so a name
      // like المائدة only ever matches a query that went through the same fold.
      val names = listOf(fold(s.nameSimple), fold(s.nameEnglish), fold(s.nameArabic))
      val score = when {
        names.any { it == q } -> 3
        names.any { it.startsWith(q) } -> 2
        names.any { it.contains(q) } -> 1
        else -> 0
      }
      if (score > 0) s to score else null
    }
    return scored.sortedWith(compareByDescending<Pair<Surah, Int>> { it.second }.thenBy { it.first.id })
      .map { row(it.first) }
  }

  private fun row(s: Surah): MediaItem = MediaItem.Builder().setMediaId("surah:${s.id}")
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle(s.nameSimple).setSubtitle("${s.nameArabic} · ${s.ayahCount} ayahs")
        .setArtworkUri(artworkUri).setIsBrowsable(false).setIsPlayable(true)
        .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER).build()
    ).build()

  companion object {
    /**
     * Voice search arrives as prose — "play surah 18", "Surah Al-Kahf". Drop the
     * leading "surah"/"surat"/"sura" so the rest can be read as a number or a name.
     */
    fun stripSurahWord(query: String): String =
      query.replace(Regex("^\\s*(surah|surat|sura)[\\s-]*", RegexOption.IGNORE_CASE), "")

    /** Lower-case, diacritics/apostrophes/hyphens/spaces/"al " removed — so "al kahf", "Al-Kahf", "alkahf" all match. */
    fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
      .replace(Regex("\\p{M}+"), "")
      .replace(Regex("^(al|an|as|ash|ar|at|ad|az)[ -]"), "")
      .replace(Regex("[^\\p{L}\\p{N}]"), "")

    fun parse(json: String, artworkUri: Uri? = null): CarLibrary {
      val arr = JSONArray(json)
      return CarLibrary(
        (0 until arr.length()).map { i ->
          arr.getJSONObject(i).let {
            Surah(
              it.getInt("id"),
              it.getString("nameSimple"),
              it.getString("nameArabic"),
              it.getString("nameEnglish"),
              it.getInt("ayahCount"),
            )
          }
        },
        artworkUri,
      )
    }
  }
}
