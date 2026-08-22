package de.dumbospizza.pos.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import de.dumbospizza.pos.R
import kotlin.math.roundToInt

/**
 * Примитивы нативного терминала — порт components/pos/primitives.tsx и
 * order-list.tsx. Размеры не округлены: 56 dp у кнопки — заявленное в макете
 * касание для рук в перчатках, а не произвольная величина.
 */

/**
 * Строка с часами, 26 dp. В вебе её место занимала имитация системной строки;
 * киоск прячет настоящую, поэтому часы рисуем сами. Левый верхний угол — та же
 * невидимая площадка служебного экрана, что и в веб-режиме (KioskActivity).
 */
@Composable
fun PosClockBar(time: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(26.dp)
            .background(PosColors.bgBase)
            .padding(start = 14.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(time, style = PosType.labelXs.num(), color = PosColors.textSecondary)
    }
}

/** Верхняя панель с заголовком и необязательным действием справа, 56 dp. */
@Composable
fun PosAppBar(
    title: String,
    overline: String? = null,
    onBack: (() -> Unit)? = null,
    @DrawableRes actionIcon: Int? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(PosColors.bgBase)
            .padding(
                start = if (onBack != null) 4.dp else 16.dp,
                end = 4.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (onBack != null) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(R.drawable.pos_back),
                    contentDescription = "Zurück",
                    modifier = Modifier.size(24.dp),
                    tint = PosColors.textPrimary,
                )
            }
        }
        // Колонка забирает всю свободную ширину сама: отдельный Spacer с weight
        // делил бы её с колонкой пополам, и заголовок переносился на полэкрана.
        Column(modifier = Modifier.weight(1f)) {
            if (overline != null) {
                Text(
                    overline,
                    style = PosType.labelXs,
                    color = PosColors.accent,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                title,
                style = PosType.titleM,
                color = PosColors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (actionIcon != null) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .let { if (onAction != null) it.clickable(onClick = onAction) else it },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(actionIcon),
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = PosColors.textSecondary,
                )
            }
        }
    }
}

/** Разделы главной навигации — NAV из order-list.tsx. */
enum class PosSection(val label: String, @DrawableRes val icon: Int) {
    ORDERS("Bestellungen", R.drawable.pos_orders),
    MENU("Speisekarte", R.drawable.pos_menu),
    MORE("Mehr", R.drawable.pos_more),
}

/** Главная навигация, 60 dp. */
@Composable
fun PosBottomNav(active: PosSection, onSelect: (PosSection) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(PosColors.border)
        )
        Row(
            Modifier
                .fillMaxWidth()
                .height(60.dp)
                .background(PosColors.bgSurface)
        ) {
            PosSection.entries.forEach { section ->
                val on = section == active
                val tint = if (on) PosColors.accent else PosColors.textMuted
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable { onSelect(section) }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
                ) {
                    Icon(
                        painterResource(section.icon),
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = tint,
                    )
                    Text(section.label, style = PosType.labelXs, color = tint)
                }
            }
        }
    }
}

/** Четыре статуса с количеством, 62 dp. Число крупнее подписи: его читают первым. */
@Composable
fun PosStatusTabs(
    counts: Map<PosStatus, Int>,
    active: BoardTab,
    onChange: (BoardTab) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(62.dp)
            .background(PosColors.bgBase)
    ) {
        BoardTab.entries.forEach { tab ->
            val on = tab == active
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable { onChange(tab) }
                    .padding(horizontal = 2.dp)
                    .padding(top = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    tab.count(counts).toString(),
                    style = PosType.numberM.num(),
                    color = if (on) PosColors.accent else PosColors.textPrimary,
                )
                Text(
                    tab.label,
                    style = PosType.labelXs,
                    color = if (on) PosColors.accent else PosColors.textMuted,
                    maxLines = 1,
                )
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp))
                        .background(if (on) PosColors.accent else Color.Transparent)
                )
            }
        }
    }
}

/** Бейдж статуса: точка-маркер наследует цвет текста, как bg-current в вебе. */
@Composable
fun PosStatusBadge(status: PosStatus) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(status.tintColor)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(status.textColor)
        )
        Text(status.label, style = PosType.labelS, color = status.textColor, maxLines = 1)
    }
}

/**
 * Карточка ленты (Order Card 63:100): компактная, по образцу приложения
 * курьера — круглый счётчик минут слева, тип и адрес крупно, прямое действие
 * справа, источник и сумма в подвале. Тон карточки (шапка, счётчик, тип) —
 * цвет статуса; просроченный заказ целиком уходит в красный.
 */
@Composable
fun PosOrderCard(
    order: BoardOrder,
    nowMs: Long,
    onOpen: () -> Unit,
    onAction: (() -> Unit)? = null,
) {
    val face = cardFace(order, nowMs)
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .clickable(onClick = onOpen),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("#${order.number}", style = PosType.titleM.num(), color = PosColors.textPrimary)
            Spacer(Modifier.weight(1f))
            Text(face.info, style = PosType.labelM.num(), color = face.tone, maxLines = 1)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(PosColors.border)
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(60.dp)
                    .clip(CircleShape)
                    .background(face.tint)
                    .border(2.dp, face.tone, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (face.badgeIcon != null) {
                    Icon(
                        painterResource(face.badgeIcon),
                        contentDescription = null,
                        modifier = Modifier.size(26.dp),
                        tint = face.tone,
                    )
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            face.badgeText,
                            style = PosType.numberL.num(),
                            color = face.tone,
                            maxLines = 1,
                        )
                        Text("min", style = PosType.labelXs, color = face.tone.copy(alpha = 0.8f))
                    }
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    if (order.pickup) "Abholung" else "Lieferung",
                    style = PosType.labelM,
                    color = face.tone,
                )
                Text(
                    face.place,
                    style = PosType.titleS,
                    color = PosColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (onAction != null) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .border(1.dp, PosColors.borderStrong, CircleShape)
                        .clickable(onClick = onAction),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painterResource(R.drawable.pos_card_check),
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                        tint = face.tone,
                    )
                }
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(PosColors.bgSurface2)
                .padding(horizontal = 14.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                painterResource(R.drawable.pos_scooter),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = PosColors.textSecondary,
            )
            Text(
                "${order.channel} · ${order.total}",
                style = PosType.labelS,
                color = PosColors.textSecondary,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** Лицо карточки: тон, заливка и содержимое счётчика — по экранному статусу. */
private data class CardFace(
    val info: String,
    val tone: Color,
    val tint: Color,
    val place: String,
    val badgeText: String = "–",
    @DrawableRes val badgeIcon: Int? = null,
)

private fun cardFace(order: BoardOrder, nowMs: Long): CardFace {
    // На карточке — улица либо стойка: полный адрес с индексом и городом сюда
    // не помещается, он есть на экране заказа.
    val place =
        if (order.pickup) "Theke · ${order.customerName.ifEmpty { "Abholung" }}"
        else order.address.substringBefore(",").ifBlank { "—" }

    fun minutesLeft(target: Long): Int = ((target - nowMs) / 60_000.0).roundToInt()

    return when (order.displayStatus) {
        PosStatus.NEW -> CardFace(
            info = "noch nicht angenommen",
            tone = PosColors.accent,
            tint = PosColors.accentSubtle,
            place = place,
            badgeText = ((nowMs - order.createdMs) / 60_000.0).roundToInt()
                .coerceAtLeast(0).toString(),
        )

        PosStatus.PREPARING -> {
            val due = order.dueMs
            when {
                due == null -> CardFace(
                    "Zeit noch nicht gesetzt",
                    PosColors.statusPreparing,
                    PosColors.tintPreparing,
                    place,
                )
                // Просрочка красит карточку целиком: её видно боковым зрением.
                due < nowMs -> CardFace(
                    info = "überfällig seit ${posClock(due)}",
                    tone = PosColors.statusCancelled,
                    tint = PosColors.tintCancelled,
                    place = place,
                    badgeText = "−${-minutesLeft(due)}",
                )
                else -> CardFace(
                    info = "fertig ${posClock(due)}",
                    tone = PosColors.statusPreparing,
                    tint = PosColors.tintPreparing,
                    place = place,
                    badgeText = minutesLeft(due).toString(),
                )
            }
        }

        PosStatus.READY -> CardFace(
            info = "wartet auf Abholung",
            tone = PosColors.statusReady,
            tint = PosColors.tintReady,
            place = place,
            badgeIcon = R.drawable.pos_badge_check,
        )

        PosStatus.DELIVERING -> {
            val due = order.dueMs
            if (due != null) CardFace(
                info = "Ankunft ${posClock(due)}",
                tone = PosColors.statusDelivering,
                tint = PosColors.tintDelivering,
                place = place,
                badgeText = minutesLeft(due).toString(),
            ) else CardFace(
                "Unterwegs",
                PosColors.statusDelivering,
                PosColors.tintDelivering,
                place,
            )
        }

        PosStatus.DELIVERED -> {
            val verb = if (order.pickup) "abgeholt" else "zugestellt"
            CardFace(
                info = order.closedMs?.let { "$verb ${posClock(it)}" } ?: verb,
                tone = PosColors.statusDelivered,
                tint = PosColors.tintDelivered,
                place = place,
                badgeIcon = R.drawable.pos_badge_check,
            )
        }

        PosStatus.CANCELLED -> CardFace(
            info = order.closedMs?.let { "storniert ${posClock(it)}" } ?: "storniert",
            tone = PosColors.statusCancelled,
            tint = PosColors.tintCancelled,
            place = place,
            badgeIcon = R.drawable.pos_badge_cross,
        )
    }
}

/**
 * Баннер паузы над лентой (14 · Betrieb pausiert): принятые заказы
 * доготавливаются, и человек видит и их, и причину, по которой новых нет.
 */
@Composable
fun PosPauseBanner(
    pause: Pause,
    nowMs: Long,
    busy: Boolean,
    onExtend: () -> Unit,
    onRelease: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(PosColors.tintCancelled)) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    painterResource(R.drawable.pos_pause),
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = PosColors.statusCancelled,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        pauseTitle(pause.scope),
                        style = PosType.titleS,
                        color = PosColors.statusCancelled,
                    )
                    Text(
                        "Wieder offen um ${posClock(pause.untilMs)} · ${pauseReason(pause.scope)}",
                        style = PosType.bodyS,
                        color = PosColors.textSecondary,
                    )
                }
                Text(
                    posCountdown(pause.untilMs - nowMs),
                    style = PosType.numberM.num(),
                    color = PosColors.statusCancelled,
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PosScopeButton(
                    "+30 Min",
                    tone = ScopeTone.DANGER_OUTLINE,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    onClick = onExtend,
                )
                PosScopeButton(
                    "Jetzt freigeben",
                    tone = ScopeTone.SUCCESS,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    onClick = onRelease,
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(PosColors.statusCancelled)
        )
    }
}

enum class ScopeTone { GHOST, SUCCESS, DANGER_OUTLINE }

/** Кнопка внутри карточки или баннера — 48 dp. Крупные 56 dp у панели действий. */
@Composable
fun PosScopeButton(
    label: String,
    tone: ScopeTone,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    val decorated = when (tone) {
        ScopeTone.GHOST -> modifier
            .clip(shape)
            .background(PosColors.bgSurface2)
            .border(1.dp, PosColors.borderStrong, shape)
        ScopeTone.SUCCESS -> modifier
            .clip(shape)
            .background(PosColors.success)
        ScopeTone.DANGER_OUTLINE -> modifier
            .clip(shape)
            .border(1.dp, PosColors.statusCancelled, shape)
    }
    val text = when (tone) {
        ScopeTone.GHOST -> PosColors.textPrimary
        ScopeTone.SUCCESS -> PosColors.textOnAccent
        ScopeTone.DANGER_OUTLINE -> PosColors.statusCancelled
    }
    Box(
        modifier = decorated
            .height(48.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.labelM, color = text, maxLines = 1)
    }
}

/** Кнопка панели действий, 56 dp (Figma Button 4:10). */
@Composable
fun PosButton(
    label: String,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.PRIMARY,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    val decorated = when (variant) {
        ButtonVariant.PRIMARY -> modifier.clip(shape).background(PosColors.accent)
        ButtonVariant.GHOST -> modifier
            .clip(shape)
            .background(PosColors.bgBase)
            .border(1.dp, PosColors.border, shape)
        ButtonVariant.DANGER -> modifier.clip(shape).background(PosColors.danger)
    }
    val text = when (variant) {
        ButtonVariant.PRIMARY, ButtonVariant.DANGER -> PosColors.textOnAccent
        ButtonVariant.GHOST -> PosColors.textSecondary
    }
    Box(
        modifier = decorated
            .height(56.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.labelL, color = text, maxLines = 1)
    }
}

enum class ButtonVariant { PRIMARY, GHOST, DANGER }

/** Итог смены на закрытых вкладках: «12 Bestellungen heute … 342,80 €». */
@Composable
fun PosSummaryRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PosColors.bgSurface2)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, style = PosType.bodyM, color = PosColors.textSecondary)
        Spacer(Modifier.weight(1f))
        Text(value, style = PosType.labelL.num(), color = PosColors.textPrimary)
    }
}

/**
 * Состояние экрана без данных. У нативного терминала «нет входа» означает
 * непринятый ключ прибора — лечится на служебном экране, поэтому текст другой,
 * чем у веб-версии с её страницей входа персонала.
 */
@Composable
fun PosScreenState(state: PosLoad<*>, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (state) {
            is PosLoad.Loading -> Text(
                "Wird geladen …",
                style = PosType.bodyM,
                color = PosColors.textMuted,
                textAlign = TextAlign.Center,
            )

            is PosLoad.Unauthorized -> {
                Text(
                    "Zugriff verweigert.\nGeräteschlüssel im Service-Bildschirm prüfen.",
                    style = PosType.bodyM,
                    color = PosColors.statusCancelled,
                    textAlign = TextAlign.Center,
                )
                PosButton("Erneut versuchen", variant = ButtonVariant.GHOST, onClick = onRetry)
            }

            is PosLoad.Error -> {
                Text(
                    "Keine Verbindung zum Server.\n${state.message}",
                    style = PosType.bodyM,
                    color = PosColors.textSecondary,
                    textAlign = TextAlign.Center,
                )
                PosButton("Erneut versuchen", variant = ButtonVariant.GHOST, onClick = onRetry)
            }

            is PosLoad.Ready -> Unit
        }
    }
}

/**
 * Нижняя шторка — PosSheet из primitives.tsx: затемнение, ручка, заголовок,
 * содержимое и кнопки. Общая для стоп-листа, продления времени и повтора
 * печати. Затемнение закрывает шторку по нажатию: на приборе это привычнее,
 * чем искать крестик жирным пальцем.
 */
@Composable
fun PosSheet(
    open: Boolean,
    title: String,
    subtitle: String? = null,
    onClose: () -> Unit,
    actions: @Composable RowScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!open) return
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val maxSheet = LocalConfiguration.current.screenHeightDp.dp * 0.85f
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose,
                ),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = maxSheet)
                    .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                    .background(PosColors.bgBase)
                    // Проглотить касание: без этого тап по самой шторке уходил
                    // бы в затемнение под ней и закрывал её.
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {},
                    )
                    .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier
                        .align(Alignment.CenterHorizontally)
                        .size(width = 40.dp, height = 4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(PosColors.borderStrong)
                )
                Text(title, style = PosType.titleL, color = PosColors.textPrimary)
                if (subtitle != null) {
                    Text(subtitle, style = PosType.bodyM, color = PosColors.textSecondary)
                }
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    content()
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    actions()
                }
            }
        }
    }
}

/** Панель действий внизу экрана. Всегда на месте, лента скроллится под ней. */
@Composable
fun PosActionBar(content: @Composable RowScope.() -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(PosColors.border)
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(PosColors.bgSurface)
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            content()
        }
    }
}

/**
 * Строка «подпись … значение» с растянутым зазором: многоточие на 360 dp
 * съедало бы место, которое нужно значению.
 */
enum class RowTone { DEFAULT, PAID, WARNING }

@Composable
fun PosRow(label: String, value: String, tone: RowTone = RowTone.DEFAULT) {
    val valueColor = when (tone) {
        RowTone.PAID -> PosColors.statusDelivered
        RowTone.WARNING -> PosColors.statusPreparing
        RowTone.DEFAULT -> PosColors.textPrimary
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, style = PosType.bodyM, color = PosColors.textSecondary)
        Spacer(Modifier.weight(1f))
        Text(value, style = PosType.labelL.num(), color = valueColor, maxLines = 1)
    }
}

/** Шаг ±5 минут. Квадрат 64 dp — крупнее чипа, потому что нажимают его часто. */
@Composable
fun PosStepButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = Modifier
            .size(64.dp)
            .clip(shape)
            .background(PosColors.bgSurface2)
            .border(1.dp, PosColors.borderStrong, shape)
            .alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.titleL, color = PosColors.textPrimary)
    }
}

/** Быстрый выбор времени. 56 dp — тот же размер касания, что у кнопок. */
@Composable
fun PosTimeChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(12.dp)
    val skin =
        if (selected) modifier.clip(shape).background(PosColors.accent)
        else modifier
            .clip(shape)
            .background(PosColors.bgSurface2)
            .border(1.dp, PosColors.border, shape)
    Box(
        modifier = skin
            .height(56.dp)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = PosType.labelL.num(),
            color = if (selected) PosColors.textOnAccent else PosColors.textPrimary,
            maxLines = 1,
        )
    }
}

/** Пустой раздел на время стройки: честная заглушка вместо сломанной кнопки. */
@Composable
fun PosSectionPlaceholder(section: PosSection) {
    Column(Modifier.fillMaxSize()) {
        PosAppBar(overline = "DUMBO SLICE PIZZA & SUSHI", title = section.label)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text(
                "Dieser Bereich ist im nativen Modus\nnoch nicht verfügbar.",
                style = PosType.bodyM,
                color = PosColors.textMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}
