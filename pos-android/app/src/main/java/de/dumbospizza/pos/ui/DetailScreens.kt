package de.dumbospizza.pos.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.dumbospizza.pos.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * 07 · Bestelldetails и его шторки: 08 · Zeit verlängern, 15 · Küchenbon
 * erneut drucken — порт app/pos/orders/[id]/page.tsx и order-detail.tsx.
 *
 * В макете это девять кадров, но экран один: меняются шапка со временем, набор
 * кнопок внизу и состояние бона. Что показывать и что предлагать нажать — в
 * одном справочнике detailView: статус, крупное число и кнопки обязаны
 * меняться вместе.
 *
 * Действия идут в СУЩЕСТВУЮЩИЕ маршруты персонала: смена статуса — PUT
 * /api/orders/[id], продление — POST .../delay, повтор печати — POST
 * .../reprint. Свои копии означали бы, что заказ, переведённый с прибора, не
 * доедет ни до Telegram, ни до гостя.
 */

// --- Справочник действий (порт lib/pos/detail-actions.ts) ----------------------

private data class DetailAction(
    val label: String,
    val ghost: Boolean = false,
    /** Куда переводим заказ. null — действие не про статус. */
    val next: PosStatus? = null,
    /** Обязательно для всего, что немедленно уведомляет гостя (#260820002). */
    val confirm: Boolean = false,
)

private data class DetailView(
    val step: Int?,
    val canExtend: Boolean,
    val actions: List<DetailAction>,
)

private val ACTION_CANCEL =
    DetailAction("Stornieren", ghost = true, next = PosStatus.CANCELLED, confirm = true)
private val ACTION_BACK = DetailAction("Zurück zur Liste", ghost = true)

private fun detailView(display: PosStatus): DetailView = when (display) {
    // Принять заказ = назначить время: отдельной кнопки «принять без времени» нет.
    PosStatus.NEW -> DetailView(1, canExtend = false, listOf(ACTION_CANCEL, DetailAction("Annehmen")))
    // Сразу в «Unterwegs», минуя «Bereit»: для ресторана это один шаг.
    PosStatus.PREPARING -> DetailView(
        2, canExtend = true,
        listOf(ACTION_CANCEL, DetailAction("Ist unterwegs", next = PosStatus.DELIVERING, confirm = true)),
    )
    // Готовый САМОВЫВОЗ, который ждёт гостя у стойки.
    PosStatus.READY -> DetailView(
        3, canExtend = false,
        listOf(ACTION_CANCEL, DetailAction("Abgeholt", next = PosStatus.DELIVERED)),
    )
    PosStatus.DELIVERING -> DetailView(
        3, canExtend = false,
        listOf(DetailAction("Zurück", ghost = true), DetailAction("Zugestellt", next = PosStatus.DELIVERED)),
    )
    PosStatus.DELIVERED -> DetailView(4, canExtend = false, listOf(ACTION_BACK))
    // Отменённый заказ прогресс не показывает: ему некуда двигаться.
    PosStatus.CANCELLED -> DetailView(null, canExtend = false, listOf(ACTION_BACK))
}

private data class ConfirmTexts(
    val title: String,
    val subtitle: String,
    val confirmLabel: String,
    val danger: Boolean,
)

private fun confirmTexts(next: PosStatus): ConfirmTexts? = when (next) {
    PosStatus.CANCELLED -> ConfirmTexts(
        "Bestellung stornieren?",
        "Der Gast bekommt eine Nachricht. Das lässt sich nicht zurücknehmen.",
        "Stornieren",
        danger = true,
    )
    PosStatus.DELIVERING -> ConfirmTexts(
        "Ist die Bestellung unterwegs?",
        "Der Gast bekommt sofort die Nachricht, dass die Lieferung unterwegs ist.",
        "Ist unterwegs",
        danger = false,
    )
    else -> null
}

// --- Шапка со временем ---------------------------------------------------------

private data class Headline(val bigValue: String, val subTop: String, val subBottom: String)

/** Крупное число и две строки под ним — своё на каждый ЭКРАННЫЙ статус. */
private fun headline(detail: OrderDetail, nowMs: Long): Headline {
    val order = detail.summary
    val left = order.dueMs?.let { it - nowMs }
    return when (order.displayStatus) {
        PosStatus.NEW -> Headline(
            bigValue = posClock(order.createdMs),
            subTop = "Eingegangen",
            subBottom =
                if (order.desiredMs == null) "Zeit noch nicht gesetzt"
                else "Wunschzeit ${posClock(order.desiredMs)}",
        )
        PosStatus.PREPARING ->
            if (left == null) Headline("—", "Ohne Zeit", "Zeit festlegen")
            else Headline(
                bigValue = posCountdown(left),
                subTop = if (left >= 0) "Minuten übrig" else "Minuten überfällig",
                subBottom = "Fertig um ${posClock(order.dueMs)} Uhr",
            )
        PosStatus.READY -> {
            val since = order.closedMs?.let { ((nowMs - it) / 60_000.0).roundToInt() }
            Headline(
                bigValue = posClock(order.closedMs ?: order.dueMs),
                subTop = if (since == null) "Fertig" else "Fertig seit $since Minuten",
                subBottom = "Wartet auf den Gast",
            )
        }
        PosStatus.DELIVERING -> Headline(
            bigValue = posClock(order.dueMs),
            subTop = "Ankunft geplant",
            subBottom = order.address.ifEmpty { "Unterwegs" },
        )
        PosStatus.DELIVERED -> {
            val total = order.closedMs
                ?.let { ((it - order.createdMs) / 60_000.0).roundToInt().coerceAtLeast(0) }
            Headline(
                bigValue = posClock(order.closedMs),
                subTop = if (order.pickup) "Abgeholt" else "Zugestellt",
                subBottom = if (total == null) "" else "Gesamtdauer $total Minuten",
            )
        }
        PosStatus.CANCELLED -> Headline(
            bigValue = posClock(order.closedMs),
            subTop = "Storniert",
            subBottom = if (order.paid) "Online bezahlt — Rückerstattung prüfen" else "",
        )
    }
}

// --- Печать --------------------------------------------------------------------

/**
 * kitchenPrintStatus из базы → состояние карточки бона. `pending` и `printing`
 * РАЗНЫЕ: в `pending` заказ лежит сколько угодно (автопечать выключена или
 * агент не дошёл), блокировать кнопку имеет смысл только на `printing`.
 */
private enum class PrintState(val label: String, val action: String, val busy: Boolean) {
    PRINTED("Gedruckt", "Erneut drucken", busy = false),
    PENDING("Noch nicht gedruckt", "Jetzt drucken", busy = false),
    QUEUED("Wird gedruckt", "Wird gedruckt …", busy = true),
    FAILED("Fehler", "Erneut versuchen", busy = false),
}

private fun toPrintState(status: String): PrintState = when (status) {
    "completed" -> PrintState.PRINTED
    "failed" -> PrintState.FAILED
    "printing" -> PrintState.QUEUED
    else -> PrintState.PENDING
}

private fun printColor(state: PrintState): Pair<Color, Color> = when (state) {
    PrintState.PRINTED -> PosColors.statusDelivered to PosColors.tintDelivered
    PrintState.PENDING -> PosColors.textMuted to PosColors.bgSurface2
    PrintState.QUEUED -> PosColors.statusPreparing to PosColors.tintPreparing
    PrintState.FAILED -> PosColors.statusCancelled to PosColors.tintCancelled
}

private val PAYMENT_LABEL = mapOf(
    "cash" to "Barzahlung",
    "card" to "Kartenzahlung",
    "online" to "Online",
)

/** «19:25» + 15 → «19:40». Через полночь крутится по кругу. */
fun addMinutesToClock(clock: String, minutes: Int): String {
    val parts = clock.split(":")
    val h = parts.getOrNull(0)?.toIntOrNull() ?: return clock
    val m = parts.getOrNull(1)?.toIntOrNull() ?: return clock
    val total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
    return "%02d:%02d".format(total / 60, total % 60)
}

// --- Блоки экрана --------------------------------------------------------------

/** Шаги заказа: у самовывоза последний называется «Abgeholt». */
@Composable
private fun PosOrderProgress(step: Int, pickup: Boolean) {
    val steps = listOf("Angenommen", "Zubereitung", "Fertig", if (pickup) "Abgeholt" else "Geliefert")
    Row(
        Modifier
            .fillMaxWidth()
            .height(32.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        steps.forEachIndexed { i, label ->
            val done = i < step
            // Ближайший будущий шаг подсвечен сильнее дальних.
            val bar = when {
                done -> PosColors.accent
                i == step -> PosColors.borderStrong
                else -> PosColors.border
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(bar)
                )
                Text(
                    label,
                    style = PosType.label2xs,
                    color = if (done) PosColors.textSecondary else PosColors.textMuted,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun StatusTimeCard(
    detail: OrderDetail,
    nowMs: Long,
    step: Int?,
) {
    val order = detail.summary
    val display = order.displayStatus
    val head = headline(detail, nowMs)
    val tone = display.textColor

    // Полоса обратного отсчёта — только пока заказ готовится и срок известен.
    val progress: Float? =
        if (order.status == PosStatus.PREPARING && order.dueMs != null &&
            (order.etaMinutes ?: 0) > 0
        ) {
            val eta = order.etaMinutes!! * 60_000f
            (100f - (order.dueMs - nowMs) / eta * 100f).coerceIn(0f, 100f)
        } else null

    DetailBlock(gap = 12.dp) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PosStatusBadge(display)
            Spacer(Modifier.weight(1f))
            Text(
                "Angenommen ${posClock(order.createdMs)}",
                style = PosType.bodyS,
                color = PosColors.textMuted,
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(head.bigValue, style = PosType.displayM.num(), color = tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(head.subTop, style = PosType.bodyS, color = PosColors.textSecondary)
                Text(head.subBottom, style = PosType.labelM, color = PosColors.textPrimary)
            }
        }
        if (progress != null) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(PosColors.bgSurface2)
            ) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(progress / 100f)
                        .clip(RoundedCornerShape(50))
                        .background(tone)
                )
            }
        }
        if (step != null) PosOrderProgress(step, order.pickup)
    }
}

/** Кухонный бон: витрина очереди печати. Чек печатает боннер у кассы. */
@Composable
private fun KitchenReceiptCard(
    state: PrintState,
    lineOne: String,
    lineTwo: String,
    onPrint: () -> Unit,
) {
    val (color, tint) = printColor(state)
    DetailBlock {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("KÜCHENBON", style = PosType.overline, color = PosColors.textMuted)
            Spacer(Modifier.weight(1f))
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(tint)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(color)
                )
                Text(state.label, style = PosType.labelS, color = color)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(lineOne, style = PosType.bodyM, color = PosColors.textSecondary)
            Text(lineTwo, style = PosType.bodyS, color = PosColors.textMuted)
        }
        val shape = RoundedCornerShape(12.dp)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .clip(shape)
                .background(PosColors.bgSurface2)
                .border(1.dp, PosColors.borderStrong, shape)
                .alpha(if (state.busy) 0.6f else 1f)
                .clickable(enabled = !state.busy, onClick = onPrint),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                painterResource(R.drawable.pos_printer),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = PosColors.textPrimary,
            )
            Text(state.action, style = PosType.labelM, color = PosColors.textPrimary)
        }
        if (state == PrintState.FAILED) {
            Text(
                "Papierrolle und Kassen-PC prüfen. Der Auftrag bleibt in der Warteschlange " +
                    "und wird automatisch wiederholt.",
                style = PosType.bodyS,
                color = PosColors.textSecondary,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(PosColors.tintCancelled)
                    .padding(12.dp),
            )
        }
    }
}

/** Продление времени: три быстрых шага плюс произвольная длительность. */
@Composable
private fun ExtendTimeCard(enabled: Boolean, onExtend: (Int) -> Unit, onOther: () -> Unit) {
    DetailBlock(gap = 12.dp) {
        Text("ZEIT VERLÄNGERN", style = PosType.overline, color = PosColors.textMuted)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(10, 15, 20).forEach { m ->
                val shape = RoundedCornerShape(12.dp)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(shape)
                        .background(PosColors.bgSurface2)
                        .border(1.dp, PosColors.border, shape)
                        .alpha(if (enabled) 1f else 0.5f)
                        .clickable(enabled = enabled) { onExtend(m) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+$m Min", style = PosType.labelL, color = PosColors.textPrimary)
                }
            }
        }
        Text(
            "Andere Dauer (5–60 Min, Schritt 5)",
            style = PosType.bodyS,
            color = PosColors.textMuted,
            modifier = Modifier.clickable(enabled = enabled, onClick = onOther),
        )
    }
}

/** Белая плашка деталей — общий контейнер блоков экрана. */
@Composable
private fun DetailBlock(
    gap: androidx.compose.ui.unit.Dp = 10.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(gap),
        content = content,
    )
}

// --- Шторки --------------------------------------------------------------------

private val EXTEND_QUICK = listOf(10, 15, 20, 30, 45)
private const val EXTEND_MIN = 5
private const val EXTEND_MAX = 60

/**
 * 08 · Zeit verlängern. Крупно показано НЕ «+15», а новое время готовности:
 * гостю уходит именно оно, и сверять оператор будет его.
 */
@Composable
private fun ExtendSheet(
    open: Boolean,
    finishAt: String,
    busy: Boolean,
    onClose: () -> Unit,
    onConfirm: (Int) -> Unit,
) {
    var minutes by remember { mutableStateOf(15) }
    /** «Andere» — режим набора шагом ±5, а не отдельное значение. */
    var custom by remember { mutableStateOf(false) }

    PosSheet(
        open = open,
        centered = true,
        title = "Zeit verlängern",
        subtitle = "Bisher fertig um $finishAt Uhr",
        onClose = onClose,
        actions = {
            PosButton("Abbrechen", modifier = Modifier.weight(1f), variant = ButtonVariant.GHOST) {
                onClose()
            }
            PosButton("Verlängern", modifier = Modifier.weight(1f), enabled = !busy) {
                onConfirm(minutes)
            }
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(PosColors.accentSubtle)
                .padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                "${addMinutesToClock(finishAt, minutes)} Uhr",
                style = PosType.displayM.num(),
                color = PosColors.accent,
            )
            Text("+$minutes Minuten", style = PosType.labelM, color = PosColors.textSecondary)
        }

        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                EXTEND_QUICK.take(3).forEach { m ->
                    PosTimeChip(
                        "+$m Min",
                        selected = !custom && minutes == m,
                        modifier = Modifier.weight(1f),
                    ) {
                        custom = false
                        minutes = m
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                EXTEND_QUICK.drop(3).forEach { m ->
                    PosTimeChip(
                        "+$m Min",
                        selected = !custom && minutes == m,
                        modifier = Modifier.weight(1f),
                    ) {
                        custom = false
                        minutes = m
                    }
                }
                PosTimeChip("Andere", selected = custom, modifier = Modifier.weight(1f)) {
                    custom = true
                }
            }
        }

        if (custom) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                PosStepButton("−5", enabled = minutes > EXTEND_MIN) {
                    minutes = (minutes - 5).coerceAtLeast(EXTEND_MIN)
                }
                Text(
                    "+$minutes Min",
                    style = PosType.titleL.num(),
                    color = PosColors.textPrimary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
                PosStepButton("+5", enabled = minutes < EXTEND_MAX) {
                    minutes = (minutes + 5).coerceAtMost(EXTEND_MAX)
                }
            }
        }

        Text(
            "Erlaubt sind $EXTEND_MIN–$EXTEND_MAX Min. Kunde bekommt automatisch eine " +
                "WhatsApp-Nachricht.",
            style = PosType.bodyS,
            color = PosColors.textMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * 15 · Küchenbon erneut drucken. Показывает не «печатаю», а «встаёт в очередь
 * под номером N»: чек выходит из боннера у кассы, обратной связи от него нет.
 */
@Composable
private fun PrintSheet(
    open: Boolean,
    lines: List<String>,
    lastPrintedAt: String,
    printSeq: Int,
    busy: Boolean,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
) {
    PosSheet(
        open = open,
        title = "Küchenbon erneut drucken",
        onClose = onClose,
        actions = {
            PosButton("Abbrechen", modifier = Modifier.weight(1f), variant = ButtonVariant.GHOST) {
                onClose()
            }
            PosButton("Bon drucken", modifier = Modifier.weight(1f), enabled = !busy) {
                onConfirm()
            }
        },
    ) {
        Text(
            "Geht als neuer Druckauftrag an den Bondrucker an der Kasse. Der Druck startet " +
                "in ca. 5 Sekunden.",
            style = PosType.bodyS,
            color = PosColors.textSecondary,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(PosColors.bgSurface2)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Zuletzt gedruckt $lastPrintedAt",
                style = PosType.bodyM,
                color = PosColors.textSecondary,
            )
            Spacer(Modifier.weight(1f))
            Text("Druck Nr. $printSeq", style = PosType.labelM.num(), color = PosColors.textPrimary)
        }

        // Ширина чека фиксированная, а экран уже — предпросмотр прокручивается
        // вбок, а не переносит строки: перенос показал бы раскладку, которой не
        // будет на бумаге.
        val shape = RoundedCornerShape(10.dp)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(PosColors.bgSurface)
                .border(1.dp, PosColors.border, shape)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 14.dp),
        ) {
            Text(
                lines.joinToString("\n"),
                color = PosColors.textSecondary,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                softWrap = false,
            )
        }

        Text(
            "Wird als Druck Nr. ${printSeq + 1} eingereiht · Bon-Inhalt unverändert",
            style = PosType.labelS,
            color = PosColors.textMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// --- Экран ---------------------------------------------------------------------

@Composable
fun OrderDetailScreen(
    loader: OrderLoader,
    orderId: String,
    nowMs: Long,
    onBack: () -> Unit,
    onAcceptFlow: (String) -> Unit,
) {
    LaunchedEffect(orderId) { loader.poll(orderId) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val detail = loader.state.readyOrNull()
    val display = detail?.summary?.displayStatus
    val view = display?.let { detailView(it) }

    var sheet by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf<DetailAction?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(3_000)
            toast = null
        }
    }

    fun say(ok: Boolean, okMessage: String, error: String?) {
        toast = if (ok) okMessage else "Fehlgeschlagen: ${error ?: "Unbekannt"}"
    }

    fun changeStatus(next: PosStatus) {
        scope.launch {
            val error = loader.act(next)
            confirming = null
            say(error == null, "Status aktualisiert", error)
        }
    }

    fun extend(minutes: Int) {
        scope.launch {
            val error = loader.request("/delay", JSONObject().put("delayMinutes", minutes))
            sheet = null
            say(error == null, "Neue Zeit gesetzt · +$minutes Min", error)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        PosAppBar(
            title = detail?.let { "Bestellung #${it.summary.number}" } ?: "Bestellung",
            onBack = onBack,
            actionIcon = R.drawable.pos_printer,
            onAction = { if (detail != null) sheet = "print" },
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (detail == null) {
                item(key = "state") {
                    PosScreenState(loader.state) { scope.launch { loader.refresh() } }
                }
            }

            if (detail != null && view != null) {
                item(key = "status") { StatusTimeCard(detail, nowMs, view.step) }

                item(key = "print") {
                    KitchenReceiptCard(
                        state = toPrintState(detail.printStatus),
                        lineOne = orderMeta(detail.summary),
                        lineTwo = "Druckauftrag Nr. ${detail.printSeq + 1}",
                        onPrint = { sheet = "print" },
                    )
                }

                if (view.canExtend) {
                    item(key = "extend") {
                        ExtendTimeCard(
                            enabled = !loader.busy,
                            onExtend = ::extend,
                            onOther = { sheet = "extend" },
                        )
                    }
                }

                item(key = "customer") {
                    DetailBlock(gap = 4.dp) {
                        Text(
                            detail.summary.customerName.ifEmpty { "Gast" },
                            style = PosType.titleS,
                            color = PosColors.textPrimary,
                        )
                        Text(
                            if (detail.summary.pickup) "Abholung an der Theke"
                            else detail.summary.address.ifEmpty { "—" },
                            style = PosType.bodyM,
                            color = PosColors.textSecondary,
                        )
                        if (detail.phone.isNotEmpty()) {
                            Text(
                                "${detail.phone} · anrufen",
                                style = PosType.labelM.num(),
                                color = PosColors.statusDelivering,
                                modifier = Modifier.clickable {
                                    runCatching {
                                        context.startActivity(
                                            Intent(
                                                Intent.ACTION_DIAL,
                                                Uri.parse("tel:" + detail.phone.replace(" ", "")),
                                            )
                                        )
                                    }
                                },
                            )
                        }
                    }
                }

                item(key = "items") {
                    val payLabel = PAYMENT_LABEL[detail.paymentMethod] ?: "Zahlung"
                    val paidLabel = if (detail.summary.paid) "bezahlt" else "offen"
                    DetailBlock {
                        detail.items.forEach { line ->
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    "${line.qty}×",
                                    style = PosType.labelL.num(),
                                    color = PosColors.accent,
                                )
                                Text(
                                    line.name,
                                    style = PosType.bodyM,
                                    color = PosColors.textPrimary,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    line.price,
                                    style = PosType.labelM.num(),
                                    color = PosColors.textSecondary,
                                )
                            }
                        }
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(PosColors.border)
                        )
                        if (detail.note.isNotEmpty()) {
                            Text(
                                "Notiz: ${detail.note}",
                                style = PosType.bodyS,
                                color = PosColors.textMuted,
                            )
                        }
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Summe · $payLabel $paidLabel",
                                style = PosType.bodyM,
                                color = PosColors.textSecondary,
                            )
                            Spacer(Modifier.weight(1f))
                            Text(
                                detail.summary.total,
                                style = PosType.numberM.num(),
                                color = PosColors.textPrimary,
                            )
                        }
                    }
                }
            }
        }

        // Тост живёт над панелью действий: он сообщает о фоновом событии и не
        // должен перекрывать кнопку, которую человек в этот момент ищет.
        toast?.let { message ->
            Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) {
                Text(
                    message,
                    style = PosType.bodyS,
                    color = PosColors.textOnAccent,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(PosColors.textPrimary)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                )
            }
        }

        if (view != null) {
            PosActionBar {
                view.actions.forEach { action ->
                    PosButton(
                        action.label,
                        modifier = Modifier.weight(1f),
                        variant = if (action.ghost) ButtonVariant.GHOST else ButtonVariant.PRIMARY,
                        enabled = !loader.busy,
                    ) {
                        when {
                            action.confirm && action.next != null -> confirming = action
                            action.next != null -> changeStatus(action.next)
                            action.label == "Annehmen" -> onAcceptFlow(orderId)
                            else -> onBack()
                        }
                    }
                }
            }
        }
    }

    if (detail != null) {
        ExtendSheet(
            open = sheet == "extend",
            finishAt = posClock(detail.summary.dueMs),
            busy = loader.busy,
            onClose = { sheet = null },
            onConfirm = ::extend,
        )

        PrintSheet(
            open = sheet == "print",
            lines = detail.receiptLines,
            lastPrintedAt = posClock(detail.summary.createdMs),
            printSeq = detail.printSeq,
            busy = loader.busy,
            onClose = { sheet = null },
            onConfirm = {
                scope.launch {
                    val error = loader.request("/reprint", JSONObject())
                    sheet = null
                    say(error == null, "Bon in die Warteschlange gestellt", error)
                }
            },
        )
    }

    // Подтверждений в макете нет, но последствия необратимы: заказ уходит гостю
    // сообщением. Нажатие мимо кнопки не должно этого делать (#260820002).
    confirming?.next?.let { next ->
        confirmTexts(next)?.let { texts ->
            PosSheet(
                open = true,
                centered = true,
                title = texts.title,
                subtitle = texts.subtitle,
                onClose = { confirming = null },
                actions = {
                    PosButton(
                        "Zurück",
                        modifier = Modifier.weight(1f),
                        variant = ButtonVariant.GHOST,
                    ) { confirming = null }
                    PosButton(
                        texts.confirmLabel,
                        modifier = Modifier.weight(1f),
                        variant = if (texts.danger) ButtonVariant.DANGER else ButtonVariant.PRIMARY,
                        enabled = !loader.busy,
                    ) { changeStatus(next) }
                },
            ) {}
        }
    }
}
