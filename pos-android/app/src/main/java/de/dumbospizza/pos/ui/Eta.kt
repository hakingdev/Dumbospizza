package de.dumbospizza.pos.ui

import kotlin.math.roundToInt

/**
 * Выбор времени готовности на экране «Zeit festlegen» — порт lib/pos/eta-choice.ts,
 * строка в строку: числом отсюда кухня отвечает гостю, и правила обязаны
 * совпадать с веб-терминалом, пока живут оба.
 *
 * Выбор существует в ДВУХ видах, и это не удобство, а разница смысла:
 *   • [EtaChoice.InMinutes] — «через N минут»: заказ на сейчас, час едет за часами;
 *   • [EtaChoice.AtTime]    — «к 20:30»: заказ на время, час назвал гость и он
 *     неподвижен. Держать одни минуты нельзя: пока кухня читает состав,
 *     «20:30» само превратилось бы в «20:45».
 */

/** Границы обещания — те же 5…180, что принимает сервер (lib/orders/delay.ts). */
const val POS_ETA_MIN_MINUTES = 5
const val POS_ETA_MAX_MINUTES = 180
const val POS_ETA_STEP = 5
const val POS_ETA_DEFAULT_MINUTES = 30

/** Пресеты «aus der Küche» — те же значения, которыми оперирует стоп-бот. */
val POS_ETA_PRESETS = listOf(30, 45, 60, 90, 120)

sealed interface EtaChoice {
    data class InMinutes(val minutes: Int) : EtaChoice
    data class AtTime(val ms: Long) : EtaChoice
}

val POS_ETA_INITIAL: EtaChoice = EtaChoice.InMinutes(POS_ETA_DEFAULT_MINUTES)

fun clampEtaMinutes(value: Int): Int =
    value.coerceIn(POS_ETA_MIN_MINUTES, POS_ETA_MAX_MINUTES)

/**
 * Выбор → что показать и что отправить.
 *
 * @property minutes столько минут уедет в `etaMinutes`.
 * @property targetMs что показать крупно.
 * @property clamped желаемый час дальше предела и обещание пришлось урезать —
 *   экран обязан сказать об этом словами: молча пообещать не тот час хуже всего.
 */
data class EtaView(val minutes: Int, val targetMs: Long, val clamped: Boolean)

/**
 * В неурезанном виде «к 20:30» крупным показывается РОВНО названный час, а не
 * «сейчас + округлённые минуты»: округление до минуты сдвигало бы подпись на
 * 20:29 при обещании на 20:30.
 */
fun etaView(choice: EtaChoice, nowMs: Long): EtaView {
    val raw = when (choice) {
        is EtaChoice.InMinutes -> choice.minutes
        is EtaChoice.AtTime -> ((choice.ms - nowMs) / 60_000.0).roundToInt()
    }
    val minutes = clampEtaMinutes(raw)
    val clamped = raw != minutes
    val targetMs =
        if (choice is EtaChoice.AtTime && !clamped) choice.ms
        else nowMs + minutes * 60_000L
    return EtaView(minutes, targetMs, clamped)
}

/**
 * ±5. В виде «к 20:30» двигается САМ ЧАС — иначе шаг считался бы от «сейчас» и
 * первое же касание сбрасывало бы желаемое время.
 */
fun shiftEta(choice: EtaChoice, deltaMinutes: Int, nowMs: Long): EtaChoice = when (choice) {
    is EtaChoice.InMinutes ->
        EtaChoice.InMinutes(clampEtaMinutes(choice.minutes + deltaMinutes))
    is EtaChoice.AtTime -> {
        val next = choice.ms + deltaMinutes * 60_000L
        val low = nowMs + POS_ETA_MIN_MINUTES * 60_000L
        val high = nowMs + POS_ETA_MAX_MINUTES * 60_000L
        EtaChoice.AtTime(next.coerceIn(low, high))
    }
}

/**
 * Wunschzeit → начальный выбор экрана. null — подставлять нечего.
 *
 * Прошедший час не подставляем: обещать гостю время, которое уже наступило,
 * нечестно, и кухня должна назвать реальный срок сама.
 */
fun desiredChoice(desiredMs: Long?, nowMs: Long): EtaChoice? {
    if (desiredMs == null) return null
    if (desiredMs - nowMs < POS_ETA_MIN_MINUTES * 60_000L) return null
    return EtaChoice.AtTime(desiredMs)
}
