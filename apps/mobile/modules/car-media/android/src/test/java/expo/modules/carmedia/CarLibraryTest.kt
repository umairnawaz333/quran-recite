package expo.modules.carmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarLibraryTest {
  private val json = """[{"id":1,"nameSimple":"Al-Fatihah","nameArabic":"الفاتحة","nameEnglish":"The Opener","ayahCount":7},
    {"id":5,"nameSimple":"Al-Ma'idah","nameArabic":"المائدة","nameEnglish":"The Table Spread","ayahCount":120},
    {"id":18,"nameSimple":"Al-Kahf","nameArabic":"الكهف","nameEnglish":"The Cave","ayahCount":110},
    {"id":36,"nameSimple":"Ya-Sin","nameArabic":"يس","nameEnglish":"Ya Sin","ayahCount":83}]"""
  private val lib = CarLibrary.parse(json)

  @Test fun rootListsEverySurahInOrder() {
    val ids = lib.children("root")!!.map { it.mediaId }
    assertEquals(listOf("surah:1", "surah:5", "surah:18", "surah:36"), ids)
  }

  @Test fun surahRowCarriesNamesAndCount() {
    val kahf = lib.item("surah:18")!!
    assertEquals("Al-Kahf", kahf.mediaMetadata.title)
    assertEquals("الكهف · 110 ayahs", kahf.mediaMetadata.subtitle)
    assertEquals(true, kahf.mediaMetadata.isPlayable)
    assertEquals(false, kahf.mediaMetadata.isBrowsable)
  }

  @Test fun unknownParentIsNull() {
    assertNull(lib.children("nope"))
  }

  @Test fun searchMatchesNumberNameAndLooseSpelling() {
    assertEquals("surah:18", lib.search("18").first().mediaId)
    assertEquals("surah:18", lib.search("al kahf").first().mediaId)
    assertEquals("surah:18", lib.search("the cave").first().mediaId)
    assertEquals("surah:36", lib.search("yasin").first().mediaId)       // hyphen ignored
    assertEquals("surah:1", lib.search("الفاتحة").first().mediaId)
    assertTrue(lib.search("zzz").isEmpty())
  }

  /** Hamza carriers only survive the fold on both sides — raw المائدة never matches a folded query. */
  @Test fun searchMatchesAnArabicNameWithAHamzaCarrier() {
    assertEquals("surah:5", lib.search("المائدة").first().mediaId)
  }

  @Test fun searchIgnoresASpokenLeadingSurahWord() {
    assertEquals("surah:18", lib.search("surah 18").first().mediaId)
    assertEquals("surah:18", lib.search("Surah Al-Kahf").first().mediaId)
  }
}
