package de.dumbospizza.pos.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Токены терминала — значения из app/pos/pos.css сайта (Figma «Sunmi V2s ·
 * Bestellannahme»). Пока живут оба режима терминала, веб и нативный обязаны
 * выглядеть одинаково, поэтому правка цвета или кегля делается в обоих файлах.
 *
 * Шрифт не задаём: Roboto — системный шрифт прибора, ровно как в pos.css.
 */
object PosColors {
    val bgBase = Color(0xFFFAF7F2)
    val bgSurface = Color(0xFFFFFFFF)
    val bgSurface2 = Color(0xFFF5F0E8)
    val textPrimary = Color(0xFF3D2F21)
    val textSecondary = Color(0xFF5E4934)
    val textMuted = Color(0xFF7C6145)
    val textOnAccent = Color(0xFFFFFFFF)
    val accent = Color(0xFF8A6C4C)
    val accentSubtle = Color(0xFFF5F0E8)
    val border = Color(0xFFEBE0CE)
    val borderStrong = Color(0xFFDCC9A9)

    val statusPreparing = Color(0xFF713F12)
    val tintPreparing = Color(0xFFFEF9C3)
    val statusReady = Color(0xFF15803D)
    val tintReady = Color(0xFFDCFCE7)
    val statusDelivering = Color(0xFF7C6145)
    val tintDelivering = Color(0xFFF5F0E8)
    val statusDelivered = Color(0xFF15803D)
    val tintDelivered = Color(0xFFDCFCE7)
    val statusCancelled = Color(0xFFB31F39)
    val tintCancelled = Color(0xFFFDE6E7)

    val danger = Color(0xFFD42A47)
    val success = Color(0xFF15803D)
}

/** Шкала типографики из Figma — имена совпадают с классами pos-* в pos.css. */
object PosType {
    val overline = TextStyle(
        fontSize = 11.sp, lineHeight = 14.sp,
        fontWeight = FontWeight.W700, letterSpacing = 1.2.sp,
    )
    val labelXs = TextStyle(
        fontSize = 11.sp, lineHeight = 14.sp,
        fontWeight = FontWeight.W500, letterSpacing = 0.4.sp,
    )
    val labelS = TextStyle(
        fontSize = 12.sp, lineHeight = 16.sp,
        fontWeight = FontWeight.W500, letterSpacing = 0.3.sp,
    )
    val labelM = TextStyle(
        fontSize = 14.sp, lineHeight = 18.sp,
        fontWeight = FontWeight.W500, letterSpacing = 0.1.sp,
    )
    val labelL = TextStyle(
        fontSize = 16.sp, lineHeight = 20.sp,
        fontWeight = FontWeight.W500, letterSpacing = 0.1.sp,
    )
    val bodyS = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W400)
    val bodyM = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.W400)
    val titleS = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
    val titleM = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.W600)
    val titleL = TextStyle(
        fontSize = 22.sp, lineHeight = 28.sp,
        fontWeight = FontWeight.W700, letterSpacing = (-0.2).sp,
    )
    val numberM = TextStyle(
        fontSize = 20.sp, lineHeight = 24.sp,
        fontWeight = FontWeight.W600, letterSpacing = (-0.1).sp,
    )
    val numberL = TextStyle(
        fontSize = 28.sp, lineHeight = 32.sp,
        fontWeight = FontWeight.W700, letterSpacing = (-0.3).sp,
    )
    val displayM = TextStyle(
        fontSize = 32.sp, lineHeight = 36.sp,
        fontWeight = FontWeight.W700, letterSpacing = (-0.4).sp,
    )
}

/** Цифры в колонках (суммы, время, таймеры) обязаны стоять ровно — pos-num. */
fun TextStyle.num(): TextStyle = copy(fontFeatureSettings = "tnum")
