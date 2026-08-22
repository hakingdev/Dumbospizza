package de.dumbospizza.pos.ui

import androidx.compose.runtime.State

/**
 * Что нативному терминалу нужно от прибора — то же, что веб-мост «DumboPos»
 * давал странице (KioskActivity.TerminalBridge), только прямыми вызовами без
 * JavaScript между ними. Реализует KioskActivity.
 */
interface PosBridge {
    /** Проиграть сигнал. false — на приборе нет ни одного пригодного звука. */
    fun playAlert(): Boolean

    /** Оборвать сигнал — рингтон бывает длиннее паузы между повторами. */
    fun stopAlert()

    /** Свой список Wi-Fi поверх киоска: lock task не прерывается, PIN не нужен. */
    fun openWifiPicker()

    /** Штатный выбор звука Android. Результат придёт через [alertSoundVersion]. */
    fun pickAlertSound()

    /** Имя того звука, который реально прозвучит. Пусто — звучать нечему. */
    fun alertSoundName(): String

    /** Служебный экран — через PIN, как и жест по углу. */
    fun openServiceScreen()

    /** Растёт после каждого выбора звука: экран «Mehr» перечитывает имя. */
    val alertSoundVersion: State<Int>
}
