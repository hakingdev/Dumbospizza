package de.dumbospizza.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.dumbospizza.pos.R
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Лента заказов — порт app/pos/orders/page.tsx.
 *
 * Четыре экрана макета (11:54…11:380) — это один экран с четырьмя вкладками:
 * шапка, табы и навигация общие, отличается только выборка. Пауза — не пятый
 * экран, а баннер над той же лентой.
 */
@Composable
fun OrdersScreen(loader: BoardLoader, nowMs: Long, onOpenOrder: (BoardOrder) -> Unit) {
    var active by rememberSaveable { mutableStateOf(BoardTab.PREPARING) }
    val scope = rememberCoroutineScope()
    val board = loader.state.readyOrNull()

    /**
     * Прямое действие с карточки ждёт подтверждения в шторке: кнопка двигает
     * заказ и уведомляет гостя, а урок инцидента #260820002 — всё такое обязано
     * отличать нажатую кнопку от случайного касания.
     */
    var pendingAction by remember { mutableStateOf<Pair<BoardOrder, PosStatus>?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        PosAppBar(
            overline = "DUMBO SLICE PIZZA & SUSHI",
            title = "Bestellungen",
            actionIcon = R.drawable.pos_bell,
        )

        val pause = board?.pause
        if (pause != null) {
            PosPauseBanner(
                pause = pause,
                nowMs = nowMs,
                busy = loader.busy,
                // «+30» продлевает от ОСТАТКА, а не от нуля: иначе нажатие «ещё
                // полчаса» на стопе с 24 минутами укоротило бы паузу.
                onExtend = {
                    val leftMin = ((pause.untilMs - nowMs).coerceAtLeast(0) / 60_000.0).roundToInt()
                    scope.launch { loader.setStop(pause.scope, leftMin + 30) }
                },
                onRelease = { scope.launch { loader.setStop(pause.scope, 0) } },
            )
        }

        PosStatusTabs(board?.counts ?: emptyMap(), active) { active = it }

        // Итог смены спрашивают только у закрытых вкладок: у текущих важен таймер.
        val summary = when {
            board == null -> null
            active == BoardTab.DELIVERED ->
                "${board.counts[PosStatus.DELIVERED] ?: 0} Bestellungen heute" to board.dayDelivered
            active == BoardTab.CANCELLED ->
                "${board.counts[PosStatus.CANCELLED] ?: 0} Stornos heute" to board.dayCancelled
            else -> null
        }

        val visible = board?.orders?.filter { it.displayStatus in active.statuses } ?: emptyList()

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (pause != null) {
                item(key = "pause-note") {
                    Text(
                        "LAUFENDE BESTELLUNGEN WERDEN NORMAL FERTIGGESTELLT",
                        style = PosType.overline,
                        color = PosColors.textMuted,
                    )
                }
            }

            if (summary != null) {
                item(key = "summary") { PosSummaryRow(summary.first, summary.second) }
            }

            if (summary != null && active == BoardTab.DELIVERED) {
                item(key = "heute") {
                    Text("HEUTE", style = PosType.overline, color = PosColors.textMuted)
                }
            }

            actionError?.let { message ->
                item(key = "action-error") {
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

            if (board == null) {
                item(key = "state") {
                    PosScreenState(loader.state) { scope.launch { loader.refresh() } }
                }
            }

            items(visible, key = { it.id }) { order ->
                PosOrderCard(
                    order,
                    nowMs,
                    onOpen = { onOpenOrder(order) },
                    // Прямое действие — следующий шаг заказа (detail-actions):
                    // готовится → «Ist unterwegs», ждёт у стойки → «Abgeholt»,
                    // в пути → «Zugestellt». У закрытых прямого действия нет.
                    onAction = when (order.displayStatus) {
                        PosStatus.NEW -> ({ onOpenOrder(order) })
                        PosStatus.PREPARING ->
                            ({ pendingAction = order to PosStatus.DELIVERING })
                        PosStatus.READY, PosStatus.DELIVERING ->
                            ({ pendingAction = order to PosStatus.DELIVERED })
                        else -> null
                    },
                )
            }

            // Пустая вкладка — не ошибка, а нормальное состояние смены.
            if (board != null && visible.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "Keine Bestellungen in diesem Status.",
                        style = PosType.bodyM,
                        color = PosColors.textMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 24.dp),
                    )
                }
            }
        }
    }

    pendingAction?.let { (order, next) ->
        val pickupDone = next == PosStatus.DELIVERED && order.pickup
        PosSheet(
            open = true,
            title = when {
                next == PosStatus.DELIVERING -> "Ist die Bestellung unterwegs?"
                pickupDone -> "Als abgeholt markieren?"
                else -> "Als zugestellt markieren?"
            },
            subtitle =
                if (next == PosStatus.DELIVERING)
                    "Der Gast bekommt sofort die Nachricht, dass die Lieferung unterwegs ist."
                else "Bestellung #${order.number} wird abgeschlossen.",
            onClose = { pendingAction = null },
            actions = {
                PosButton(
                    "Abbrechen",
                    modifier = Modifier.weight(1f),
                    variant = ButtonVariant.GHOST,
                ) { pendingAction = null }
                PosButton(
                    when {
                        next == PosStatus.DELIVERING -> "Ist unterwegs"
                        pickupDone -> "Abgeholt"
                        else -> "Zugestellt"
                    },
                    modifier = Modifier.weight(1f),
                    enabled = !loader.busy,
                ) {
                    scope.launch {
                        actionError = loader.actOnOrder(order.id, next)
                        pendingAction = null
                    }
                }
            },
        ) {}
    }
}
