package de.dumbospizza.pos.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import de.dumbospizza.pos.R
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Приём заказа: 01 · Neue Bestellung (Figma 9:2) и 02 · Zeit festlegen
 * (Figma 10:18) — порт app/pos/orders/new и .../new/time.
 *
 * 01 — экран-тревога: перекрывает всё и требует решения. Показывает САМЫЙ
 * СТАРЫЙ непринятый заказ, а не «тот, что открыли»: если их пришло три, решать
 * надо с того, который ждёт дольше всех. Счётчик в кружке считает не «сколько
 * осталось», а сколько заказ уже ждёт: жёсткого срока нет, а забытый на десять
 * минут заказ — это остывший гость.
 *
 * «Ablehnen» здесь идёт через шторку подтверждения — веб-версия отменяет одним
 * касанием, но урок инцидента #260820002 общий: всё, что немедленно уведомляет
 * гостя, обязано отличать нажатую кнопку от случайного касания.
 */
@Composable
fun NewOrderScreen(
    board: BoardLoader,
    order: OrderLoader,
    nowMs: Long,
    onAccept: (String) -> Unit,
    onExit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val boardData = board.state.readyOrNull()
    val incoming = boardData?.orders?.firstOrNull { it.status == PosStatus.NEW }

    LaunchedEffect(incoming?.id) { incoming?.let { order.poll(it.id) } }

    val detail = if (incoming != null) order.state.readyOrNull() else null
    var declineSheet by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        // Шапка-тревога: акцентный фон и счётчик, который нельзя не заметить.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(PosColors.accent)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    "NEUE BESTELLUNG",
                    style = PosType.overline,
                    color = PosColors.textOnAccent.copy(alpha = 0.85f),
                )
                Text(
                    when {
                        detail != null -> "Bestellung #${detail.summary.number}"
                        incoming != null -> "Bestellung #${incoming.number}"
                        else -> "Keine offene Bestellung"
                    },
                    style = PosType.titleM,
                    color = PosColors.textOnAccent,
                    maxLines = 1,
                )
            }
            if (incoming != null) {
                Box(
                    modifier = Modifier
                        .size(58.dp)
                        .clip(CircleShape)
                        .background(PosColors.bgBase),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        posCountdown(nowMs - incoming.createdMs),
                        style = PosType.numberM.num(),
                        color = PosColors.textPrimary,
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (incoming != null && detail == null) {
                item(key = "state") {
                    PosScreenState(order.state) { scope.launch { order.refresh() } }
                }
            }

            if (boardData != null && incoming == null) {
                item(key = "done") {
                    Text(
                        "Alle Bestellungen sind angenommen.",
                        style = PosType.bodyM,
                        color = PosColors.textMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 24.dp),
                    )
                }
            }

            if (detail != null) {
                val summary = detail.summary
                item(key = "info") {
                    DetailCard {
                        PosRow("Quelle", summary.channel)
                        CardDivider()
                        PosRow("Art", if (summary.pickup) "Abholung" else "Lieferung")
                        CardDivider()
                        PosRow("Eingegangen", posClock(summary.createdMs))
                        CardDivider()
                        // Заказ на время видно ДО приёма: на следующем экране этот
                        // час уже стоит в окне готовности.
                        if (summary.desiredMs != null) {
                            PosRow("Wunschzeit", posClock(summary.desiredMs), RowTone.WARNING)
                            CardDivider()
                        }
                        PosRow(
                            "Zahlung",
                            if (summary.paid) "bezahlt" else "offen",
                            if (summary.paid) RowTone.PAID else RowTone.DEFAULT,
                        )
                    }
                }

                item(key = "kunde") {
                    DetailCard(gap = 4.dp) {
                        Text(
                            summary.customerName.ifEmpty { "Gast" },
                            style = PosType.titleS,
                            color = PosColors.textPrimary,
                        )
                        Text(
                            if (summary.pickup) "Abholung an der Theke"
                            else summary.address.ifEmpty { "—" },
                            style = PosType.bodyM,
                            color = PosColors.textSecondary,
                        )
                        // Телефон — набор номера одним касанием: на приборе есть SIM.
                        if (detail.phone.isNotEmpty()) {
                            Text(
                                detail.phone,
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

                item(key = "artikel") {
                    DetailCard {
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
                        if (detail.note.isNotEmpty()) {
                            Text(
                                "Notiz: ${detail.note}",
                                style = PosType.bodyS,
                                color = PosColors.statusPreparing,
                            )
                        }
                        CardDivider()
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text("Summe", style = PosType.bodyM, color = PosColors.textSecondary)
                            Spacer(Modifier.weight(1f))
                            Text(
                                summary.total,
                                style = PosType.numberM.num(),
                                color = PosColors.textPrimary,
                            )
                        }
                    }
                }
            }

            actionError?.let { message ->
                item(key = "error") {
                    Text(
                        message,
                        style = PosType.bodyS,
                        color = PosColors.statusCancelled,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PosColors.tintCancelled)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
            }
        }

        PosActionBar {
            if (incoming != null) {
                PosButton(
                    "Ablehnen",
                    modifier = Modifier.weight(1f),
                    variant = ButtonVariant.GHOST,
                    enabled = !order.busy,
                ) { declineSheet = true }
                // Принять = назначить время: без него гость не узнает, когда ждать.
                PosButton(
                    "Annehmen",
                    modifier = Modifier.weight(1f),
                    enabled = !order.busy && detail != null,
                ) { detail?.let { onAccept(it.summary.id) } }
            } else {
                PosButton(
                    "Zur Bestellliste",
                    modifier = Modifier.weight(1f),
                    variant = ButtonVariant.GHOST,
                ) { onExit() }
            }
        }
    }

    PosSheet(
        open = declineSheet,
        title = "Bestellung stornieren?",
        subtitle = "Der Gast bekommt eine Nachricht. Das lässt sich nicht zurücknehmen.",
        onClose = { declineSheet = false },
        actions = {
            PosButton(
                "Abbrechen",
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.GHOST,
            ) { declineSheet = false }
            PosButton(
                "Stornieren",
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.DANGER,
                enabled = !order.busy,
            ) {
                scope.launch {
                    actionError = order.act(PosStatus.CANCELLED)
                    declineSheet = false
                    // Успех закрывает тревогу сам: NEW-заказов не осталось, и
                    // корень приложения уберёт экран (см. PosApp).
                    if (actionError == null) board.refresh()
                }
            }
        },
    ) {}
}

/**
 * 02 · Zeit festlegen: сколько времени кухня просит на заказ. Ответ уезжает
 * гостю, поэтому промах ценой в полчаса дороже лишнего касания — отсюда крупный
 * шаг ±5, пресеты и подтверждение с временем прямо на кнопке.
 */
@Composable
fun SetTimeScreen(
    order: OrderLoader,
    orderId: String,
    board: BoardLoader,
    nowMs: Long,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    LaunchedEffect(orderId) { order.poll(orderId) }
    val scope = rememberCoroutineScope()

    val detail = order.state.readyOrNull()
    val desiredMs = detail?.summary?.desiredMs

    var choice by remember { mutableStateOf(POS_ETA_INITIAL) }
    var error by remember { mutableStateOf<String?>(null) }

    // Wunschzeit подставляется ОДИН раз на заказ: экран перечитывается каждые
    // пять секунд, и без отметки опрос затирал бы правку кухни через ±5.
    var filledFor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(detail?.summary?.id) {
        val summary = detail?.summary ?: return@LaunchedEffect
        if (filledFor == summary.id) return@LaunchedEffect
        filledFor = summary.id
        desiredChoice(summary.desiredMs, nowMs)?.let { choice = it }
    }

    val view = etaView(choice, nowMs)
    val target = posClock(view.targetMs)
    val current = choice
    val atDesired =
        current is EtaChoice.AtTime && desiredMs != null && current.ms == desiredMs

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        PosAppBar(title = "Zeit festlegen", onBack = onBack, actionIcon = R.drawable.pos_bell)

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (detail == null) {
                item(key = "state") {
                    PosScreenState(order.state) { scope.launch { order.refresh() } }
                }
            }

            // Полоска заказа: о каком заказе речь, без ухода назад.
            item(key = "strip") {
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
                        detail?.summary?.let {
                            "#${it.number} · ${if (it.pickup) "Abholung" else "Lieferung"}"
                        } ?: "Bestellung",
                        style = PosType.labelM,
                        color = PosColors.textPrimary,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        detail?.summary?.total ?: "",
                        style = PosType.labelM.num(),
                        color = PosColors.textSecondary,
                    )
                }
            }

            // Заказ на время. Стоит НАД выбором: это условие задачи, а не подсказка.
            if (desiredMs != null) {
                item(key = "desired") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PosColors.tintPreparing)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Bestellung auf Zeit",
                            style = PosType.labelM,
                            color = PosColors.statusPreparing,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "Wunschzeit ${posClock(desiredMs)}",
                            style = PosType.labelM.num(),
                            color = PosColors.statusPreparing,
                        )
                    }
                }
            }

            item(key = "stepper") {
                val shape = RoundedCornerShape(18.dp)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .background(PosColors.bgSurface)
                        .border(1.dp, PosColors.borderStrong, shape)
                        .padding(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("FERTIG GEGEN", style = PosType.overline, color = PosColors.textMuted)
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PosStepButton("−5", enabled = view.minutes > POS_ETA_MIN_MINUTES) {
                            choice = shiftEta(choice, -POS_ETA_STEP, nowMs)
                        }
                        Column(
                            Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(target, style = PosType.displayM.num(), color = PosColors.accent)
                            Text(
                                // У заказа на время подпись короче: полная с
                                // пометкой Wunschzeit не влезает в 360 dp.
                                if (atDesired) "Wunschzeit · ${view.minutes} Min"
                                else "in ${view.minutes} Minuten",
                                style = PosType.bodyS,
                                color = PosColors.textSecondary,
                            )
                        }
                        PosStepButton("+5", enabled = view.minutes < POS_ETA_MAX_MINUTES) {
                            choice = shiftEta(choice, POS_ETA_STEP, nowMs)
                        }
                    }
                }
            }

            item(key = "quick-label") {
                Text("SCHNELLAUSWAHL", style = PosType.overline, color = PosColors.textMuted)
            }

            item(key = "chips") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        POS_ETA_PRESETS.take(3).forEach { preset ->
                            PosTimeChip(
                                "$preset Min",
                                selected = current is EtaChoice.InMinutes && current.minutes == preset,
                                modifier = Modifier.weight(1f),
                            ) { choice = EtaChoice.InMinutes(preset) }
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        POS_ETA_PRESETS.drop(3).forEach { preset ->
                            PosTimeChip(
                                "$preset Min",
                                selected = current is EtaChoice.InMinutes && current.minutes == preset,
                                modifier = Modifier.weight(1f),
                            ) { choice = EtaChoice.InMinutes(preset) }
                        }
                        if (desiredMs != null) {
                            // У заказа на время последняя фишка — возврат к
                            // желаемому часу после правок ±5.
                            PosTimeChip(
                                posClock(desiredMs),
                                selected = atDesired,
                                modifier = Modifier.weight(1f),
                            ) { choice = EtaChoice.AtTime(desiredMs) }
                        } else {
                            // «Andere» — не пресет: подсвечивается, когда
                            // значение задано шагами.
                            PosTimeChip(
                                "Andere",
                                selected = current is EtaChoice.AtTime ||
                                    (current is EtaChoice.InMinutes &&
                                        current.minutes !in POS_ETA_PRESETS),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }

            item(key = "hint") {
                Text(
                    if (desiredMs != null)
                        "Gast wünscht ${posClock(desiredMs)}. Mit ±5 von dieser Zeit verschieben, Presets rechnen ab jetzt."
                    else
                        "Presets aus der Küche: 30 / 45 / 60 / 90 / 120 Min. Feinjustierung mit ±5.",
                    style = PosType.bodyS,
                    color = PosColors.textMuted,
                )
            }

            if (view.clamped) {
                item(key = "clamped") {
                    Text(
                        "Weiter als $POS_ETA_MAX_MINUTES Minuten voraus kann nicht zugesagt " +
                            "werden — Bestellung später annehmen oder $target bestätigen.",
                        style = PosType.bodyS,
                        color = PosColors.statusPreparing,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PosColors.tintPreparing)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
            }

            error?.let { message ->
                item(key = "error") {
                    Text(
                        message,
                        style = PosType.bodyS,
                        color = PosColors.statusCancelled,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PosColors.tintCancelled)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
            }
        }

        PosActionBar {
            // Принять заказ = назначить обещание и перевести в «готовится».
            PosButton(
                "Bestellung annehmen · $target",
                modifier = Modifier.weight(1f),
                enabled = !order.busy && detail != null,
            ) {
                scope.launch {
                    error = null
                    val failure = order.act(PosStatus.PREPARING, view.minutes)
                    if (failure == null) {
                        board.refresh()
                        onDone()
                    } else {
                        error = failure
                    }
                }
            }
        }
    }
}

/** Белая карточка деталей: скругление 16, рамка, внутренний зазор 10. */
@Composable
private fun DetailCard(
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

@Composable
private fun CardDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(PosColors.border)
    )
}
