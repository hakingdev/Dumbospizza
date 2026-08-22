package de.dumbospizza.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

/**
 * Корень нативного терминала. Живёт внутри KioskActivity вместо WebView, когда
 * на служебном экране включён нативный режим; киоск (lock task, спрятанные
 * панели, служебный угол) остаётся общим для обоих режимов.
 */
@Composable
fun PosApp(
    loader: BoardLoader,
    onPlayAlert: () -> Boolean,
    onStopAlert: () -> Unit,
) {
    PosTheme {
        // Опрос ленты живёт на корне, а не в экране: переход на другую вкладку
        // навигации не должен останавливать поллинг и сбрасывать данные.
        LaunchedEffect(loader) { loader.poll() }

        val nowMs = posNow(loader)

        // Сигнал о новом заказе: пока есть непринятые — повтор каждые 10 секунд,
        // как в веб-терминале. Играет прибор (USAGE_ALARM, KioskActivity):
        // беззвучный терминал выглядит исправным ровно до конца смены.
        //
        // НО первое же касание экрана приёма глушит звонок: человек уже у
        // прибора и работает с заказом, звенеть дальше — учить не слышать
        // сигнал. Глушение живёт до развязки: СЛЕДУЮЩИЙ новый заказ (или
        // возврат заказа в «новые») снимает его и звонит снова.
        val board = loader.state.readyOrNull()
        var alertSilenced by remember { mutableStateOf(false) }
        var seenNewIds by remember { mutableStateOf(emptySet<String>()) }
        val newIds = board?.orders
            ?.filter { it.status == PosStatus.NEW }
            ?.map { it.id }
            ?.toSet()
            ?: emptySet()
        LaunchedEffect(newIds) {
            if (newIds.isEmpty() || (newIds - seenNewIds).isNotEmpty()) alertSilenced = false
            seenNewIds = newIds
        }
        val ringing = newIds.isNotEmpty() && !alertSilenced
        LaunchedEffect(ringing) {
            if (ringing) {
                while (isActive) {
                    withContext(Dispatchers.IO) { onPlayAlert() }
                    delay(ALERT_REPEAT_MS)
                }
            } else {
                // Рингтон бывает длиннее паузы между повторами — обрываем его
                // сразу: и когда непринятых не осталось, и когда заглушили.
                onStopAlert()
            }
        }

        var section by rememberSaveable { mutableStateOf(PosSection.ORDERS) }

        // Данные меню живут на корне, как и лента: возврат в раздел не должен
        // начинать с пустого экрана. Опрос при этом стартует только внутри
        // экранов меню — лента заказов важнее, её не разбавляем лишним трафиком.
        val appContext = LocalContext.current.applicationContext
        val menuLoader = remember { MenuLoader(appContext) }
        var menuScreen by rememberSaveable { mutableStateOf(MENU_CATS) }
        var menuCategoryId by rememberSaveable { mutableStateOf<String?>(null) }

        // Приём заказа (01 · Neue Bestellung → 02 · Zeit festlegen) лежит ПОВЕРХ
        // разделов и навигации: экран-тревога перекрывает всё и требует решения.
        val orderLoader = remember { OrderLoader(appContext) }
        var acceptStage by rememberSaveable { mutableStateOf(ACCEPT_NONE) }
        var acceptOrderId by rememberSaveable { mutableStateOf<String?>(null) }

        // Экран заказа (07 · Bestelldetails) — свой загрузчик: пока открыта
        // деталь, тревога может открыться поверх неё со СВОИМ заказом, и один
        // общий опрос дёргался бы между двумя id.
        val detailLoader = remember { OrderLoader(appContext) }
        var detailOrderId by rememberSaveable { mutableStateOf<String?>(null) }

        // Тревога разворачивается САМА и с любого раздела — новый заказ важнее
        // меню и настроек. Не прерывается только уже идущий выбор времени.
        // Закрывается тоже сама, когда непринятых не осталось — принял этот
        // прибор, другой или админка.
        val incomingId = board?.orders?.firstOrNull { it.status == PosStatus.NEW }?.id
        LaunchedEffect(incomingId, acceptStage) {
            if (acceptStage == ACCEPT_NONE && incomingId != null) {
                acceptStage = ACCEPT_ALERT
            }
            if (acceptStage == ACCEPT_ALERT && incomingId == null && board != null) {
                acceptStage = ACCEPT_NONE
            }
        }

        Column(Modifier.fillMaxSize().background(PosColors.bgBase)) {
            PosClockBar(posClock(nowMs))
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        when (section) {
                            PosSection.ORDERS -> OrdersScreen(loader, nowMs) { order ->
                                // Непринятый заказ ведёт в тревогу (там всегда
                                // самый старый из новых), остальные — на экран
                                // заказа.
                                if (order.displayStatus == PosStatus.NEW) {
                                    acceptStage = ACCEPT_ALERT
                                } else {
                                    detailOrderId = order.id
                                }
                            }
                            PosSection.MENU -> when (menuScreen) {
                                MENU_CAT -> menuCategoryId?.let { categoryId ->
                                    MenuCategoryScreen(
                                        menuLoader,
                                        categoryId,
                                        onBack = { menuScreen = MENU_CATS },
                                    )
                                } ?: run { menuScreen = MENU_CATS }
                                MENU_KITCHEN -> KitchenStatusScreen(
                                    menuLoader,
                                    onBack = { menuScreen = MENU_CATS },
                                )
                                MENU_STOP -> KitchenStopScreen(
                                    menuLoader,
                                    nowMs = nowMs,
                                    onBack = { menuScreen = MENU_CATS },
                                    // Стоп встал — уходим на панель состояния:
                                    // видно, что именно встало и до какого часа.
                                    onDone = { menuScreen = MENU_KITCHEN },
                                )
                                else -> MenuScreen(
                                    menuLoader,
                                    onOpenCategory = { id ->
                                        menuCategoryId = id
                                        menuScreen = MENU_CAT
                                    },
                                    onKitchenStatus = { menuScreen = MENU_KITCHEN },
                                    onKitchenStop = { menuScreen = MENU_STOP },
                                )
                            }
                            PosSection.MORE -> PosSectionPlaceholder(PosSection.MORE)
                        }
                    }
                    PosBottomNav(section) { picked ->
                        // Повторный тап по «Speisekarte» возвращает к категориям:
                        // иного пути наверх с глубины раздела на киоске нет.
                        if (picked == PosSection.MENU && section == PosSection.MENU) {
                            menuScreen = MENU_CATS
                        }
                        section = picked
                    }
                }

                // Деталь рисуется ПОД потоком приёма: пришедший новый заказ
                // разворачивает тревогу поверх открытого экрана заказа.
                detailOrderId?.let { id ->
                    OrderDetailScreen(
                        loader = detailLoader,
                        orderId = id,
                        nowMs = nowMs,
                        onBack = { detailOrderId = null },
                        onAcceptFlow = { acceptId ->
                            acceptOrderId = acceptId
                            acceptStage = ACCEPT_TIME
                        },
                    )
                }

                if (acceptStage != ACCEPT_NONE) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            // Первое касание экрана приёма глушит звонок. Событие
                            // читаем на Initial-проходе и НЕ поглощаем: кнопкам
                            // под пальцем оно нужно не меньше.
                            .pointerInput(Unit) {
                                awaitPointerEventScope {
                                    while (true) {
                                        val event = awaitPointerEvent(PointerEventPass.Initial)
                                        if (event.type == PointerEventType.Press && !alertSilenced) {
                                            alertSilenced = true
                                            onStopAlert()
                                        }
                                    }
                                }
                            }
                    ) {
                        when (acceptStage) {
                            ACCEPT_ALERT -> NewOrderScreen(
                                board = loader,
                                order = orderLoader,
                                nowMs = nowMs,
                                onAccept = { id ->
                                    acceptOrderId = id
                                    acceptStage = ACCEPT_TIME
                                },
                                onExit = { acceptStage = ACCEPT_NONE },
                            )
                            ACCEPT_TIME -> acceptOrderId?.let { id ->
                                SetTimeScreen(
                                    order = orderLoader,
                                    orderId = id,
                                    board = loader,
                                    nowMs = nowMs,
                                    onBack = { acceptStage = ACCEPT_ALERT },
                                    onDone = {
                                        acceptStage = ACCEPT_NONE
                                        acceptOrderId = null
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private const val ACCEPT_NONE = "none"
private const val ACCEPT_ALERT = "alert"
private const val ACCEPT_TIME = "time"

private const val MENU_CATS = "cats"
private const val MENU_CAT = "cat"
private const val MENU_KITCHEN = "kitchen"
private const val MENU_STOP = "stop"

/**
 * Тикающие часы прибора с поправкой на сервер (usePosNow). Поправку читаем на
 * каждом тике: она уточняется каждым ответом ленты.
 */
@Composable
private fun posNow(loader: BoardLoader): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis() + loader.skewMs) }
    LaunchedEffect(loader) {
        while (isActive) {
            now = System.currentTimeMillis() + loader.skewMs
            delay(1_000)
        }
    }
    return now
}

/**
 * Материальная тема нужна только как носитель ripple и умолчаний; вся палитра
 * и типографика терминала — свои (Tokens.kt), и компоненты берут их напрямую.
 */
@Composable
private fun PosTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = PosColors.accent,
            onPrimary = PosColors.textOnAccent,
            background = PosColors.bgBase,
            onBackground = PosColors.textPrimary,
            surface = PosColors.bgSurface,
            onSurface = PosColors.textPrimary,
        ),
        content = content,
    )
}

private const val ALERT_REPEAT_MS = 10_000L
