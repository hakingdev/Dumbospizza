package de.dumbospizza.pos.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.dumbospizza.pos.R
import kotlinx.coroutines.launch

/**
 * Стоп кухни: 12 · Küche stoppen и 13 · Küchen-Status — порт
 * app/pos/kitchen/stop, app/pos/kitchen и components/pos/kitchen.tsx.
 *
 * Экраны НЕ заводят своего понятия «пауза»: они управляют теми же записями в
 * настройках, что стоп-бот в Telegram и админка, — прибор просто ещё одна
 * кнопка к общему выключателю. Поэтому и набор областей тот же: целиком, цех
 * пиццы, цех MakiLove.
 */

// --- Области -------------------------------------------------------------------

/** Порядок на выборе «что стоппим»: «Alles» последним — самое разрушительное
 *  действие не должно стоять под большим пальцем первым. */
private val SCOPES_CHOOSE = listOf("pizza", "sushi", "all")

/** Порядок в «Küchen-Status»: заведение целиком первым — это шапка панели. */
private val SCOPES_STATUS = listOf("all", "pizza", "sushi")

private data class ScopeMeta(
    val title: String,
    val sub: String,
    /** Иконка в «Küchen-Status»: предмет — цех или само заведение. */
    @DrawableRes val icon: Int,
    /** Иконка на выборе: у «Alles» там знак запрета, а не купол. */
    @DrawableRes val chooseIcon: Int,
)

private fun scopeMeta(scope: String): ScopeMeta = when (scope) {
    "pizza" -> ScopeMeta(
        scopeTitle("pizza"),
        "Pizza, Calzone, Beilagen, Crispy Sides",
        R.drawable.pos_scope_pizza,
        R.drawable.pos_scope_pizza,
    )
    "sushi" -> ScopeMeta(
        scopeTitle("sushi"),
        "Alle Sushi-Artikel",
        R.drawable.pos_scope_sushi,
        R.drawable.pos_scope_sushi,
    )
    else -> ScopeMeta(
        "Alles",
        "Kompletter Bestellstopp im Lokal",
        R.drawable.pos_dome,
        R.drawable.pos_scope_all,
    )
}

// --- Что прочитает гость (порт posGuestBlockText/ые builders) -------------------

/**
 * Что прочитает гость, если нажать «стоп» прямо сейчас. Собрано по тем же
 * шаблонам, которыми сайт строит настоящее сообщение (DEFAULT_WORKSHOP_BLOCK_
 * MESSAGE + buildWorkshopAlternative): панель «SO SIEHT ES DER GAST» не должна
 * показывать вымысел — расхождение обнаружил бы гость, а не повар.
 */
fun guestBlockText(scope: String, minutes: Int): String {
    if (scope == "all") {
        // Текст глобального стопа по умолчанию — ровно тот, что показывает
        // checkout, когда в настройках пусто.
        return "Die Küche ist gerade ausgelastet. Bitte versuchen Sie es später."
    }
    val workshop = scopeTitle(scope)
    val alternative =
        if (scope == "pizza") "Bestellen Sie solange Sushi von MakiLove und Getränke."
        else "Bestellen Sie solange Pizza, Beilagen und Getränke."
    val minutesDe = if (minutes == 1) "1 Minute" else "$minutes Minuten"
    return "Wir haben aktuell zu viele Bestellungen für $workshop – derzeit sind keine " +
        "Bestellungen möglich. In ca. $minutesDe nehmen wir sie wieder an. $alternative"
}

/** Приписка под сообщением: у цехового стопа напитки и десерты остаются доступны. */
fun guestBlockNote(scope: String): String =
    if (scope == "all") "Auch Getränke und Desserts sind währenddessen nicht bestellbar."
    else "Getränke und Desserts bleiben immer bestellbar."

// --- Блоки ---------------------------------------------------------------------

/** Плашка «Läuft» / «Gestoppt · noch 24 Min». */
@Composable
private fun ScopeStatePill(minutesLeft: Int) {
    val stopped = minutesLeft > 0
    val color = if (stopped) PosColors.statusCancelled else PosColors.statusDelivered
    val tint = if (stopped) PosColors.tintCancelled else PosColors.tintDelivered
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
        Text(
            if (stopped) "Gestoppt · noch $minutesLeft Min" else "Läuft",
            style = PosType.labelS,
            color = color,
        )
    }
}

/** Квадратик с иконкой области — общий для обоих экранов. */
@Composable
private fun ScopeIconBox(@DrawableRes icon: Int) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(PosColors.bgSurface2),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = PosColors.accent,
        )
    }
}

/**
 * Карточка области в «Küchen-Status»: стоп и снятие живут на одной карточке —
 * искать «где это выключается» человек будет там же, где увидел, что включено.
 */
@Composable
private fun ScopeCard(
    scope: String,
    minutesLeft: Int,
    busy: Boolean,
    onStop: (Int) -> Unit,
    onExtend: () -> Unit,
    onRelease: () -> Unit,
) {
    val meta = scopeMeta(scope)
    val stopped = minutesLeft > 0
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(
                if (stopped) 2.dp else 1.dp,
                if (stopped) PosColors.statusCancelled else PosColors.border,
                shape,
            )
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ScopeIconBox(meta.icon)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(meta.title, style = PosType.titleS, color = PosColors.textPrimary)
                Text(meta.sub, style = PosType.bodyS, color = PosColors.textMuted)
            }
        }

        ScopeStatePill(minutesLeft)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (stopped) {
                PosScopeButton(
                    "+30 Min",
                    tone = ScopeTone.GHOST,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    onClick = onExtend,
                )
                PosScopeButton(
                    "Freigeben",
                    tone = ScopeTone.SUCCESS,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    onClick = onRelease,
                )
            } else {
                PosScopeButton(
                    "30 Min stoppen",
                    tone = ScopeTone.GHOST,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                ) { onStop(30) }
                PosScopeButton(
                    "60 Min stoppen",
                    tone = ScopeTone.GHOST,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                ) { onStop(60) }
            }
        }
    }
}

/** Строка выбора области на экране 12. Рамка всегда 2 dp: смена толщины
 *  заставляла бы строку подпрыгивать под пальцем при каждом выборе. */
@Composable
private fun ScopeOption(scope: String, selected: Boolean, onSelect: () -> Unit) {
    val meta = scopeMeta(scope)
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) PosColors.accentSubtle else PosColors.bgSurface)
            .border(
                2.dp,
                if (selected) PosColors.accent else PosColors.border,
                shape,
            )
            .clickable(onClick = onSelect)
            .padding(start = 12.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .border(
                    2.dp,
                    if (selected) PosColors.accent else PosColors.borderStrong,
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) {
                Box(
                    Modifier
                        .size(9.dp)
                        .clip(CircleShape)
                        .background(PosColors.accent)
                )
            }
        }
        ScopeIconBox(meta.chooseIcon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(meta.title, style = PosType.titleS, color = PosColors.textPrimary)
            Text(meta.sub, style = PosType.bodyS, color = PosColors.textMuted)
        }
    }
}

// --- Экраны --------------------------------------------------------------------

/**
 * 13 · Küchen-Status: панель, на которую приходят с вопросом «почему не идут
 * заказы» и с которой уходят, нажав «Freigeben».
 */
@Composable
fun KitchenStatusScreen(loader: MenuLoader, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }

    // Глобальный стоп сильнее цехового: пока стоит весь приём, цех всё равно
    // ничего не отдаст — показываем больший из двух сроков.
    val scopes = loader.kitchen
    val globalLeft = scopes.firstOrNull { it.scope == "all" }?.minutesLeft ?: 0
    fun leftFor(id: String): Int {
        val own = scopes.firstOrNull { it.scope == id }?.minutesLeft ?: 0
        return if (id == "all") own else maxOf(own, globalLeft)
    }

    fun apply(id: String, minutes: Int) {
        scope.launch { error = loader.setStop(id, minutes) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        PosAppBar(title = "Küchen-Status", onBack = onBack)

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
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

            SCOPES_STATUS.forEach { id ->
                item(key = id) {
                    ScopeCard(
                        scope = id,
                        minutesLeft = leftFor(id),
                        busy = loader.busy,
                        onStop = { minutes -> apply(id, minutes) },
                        // «+30» считается от ОСТАТКА: иначе «ещё полчаса» на
                        // стопе с 40 минутами укоротило бы паузу.
                        onExtend = { apply(id, leftFor(id) + 30) },
                        // Снятие чистит только свой срок: у цеха при активном
                        // глобальном стопе он останется — видно по «Alles».
                        onRelease = { apply(id, 0) },
                    )
                }
            }

            item(key = "hint") {
                Text(
                    "Dieselbe Steuerung gibt es im Telegram-Bot: /start → Küche → Blockieren.",
                    style = PosType.bodyS,
                    color = PosColors.textMuted,
                )
            }
        }
    }
}

private const val STOP_MIN = 5
private const val STOP_MAX = 180

/**
 * 12 · Küche stoppen: что стоппим, насколько — и сразу последствия: во сколько
 * снимется само и что в это время прочитает гость.
 */
@Composable
fun KitchenStopScreen(
    loader: MenuLoader,
    nowMs: Long,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    val coroutine = rememberCoroutineScope()

    var scope by rememberSaveable { mutableStateOf("pizza") }
    var minutes by rememberSaveable { mutableStateOf(30) }
    /** «Andere» — не значение, а режим: длительность набирается шагом ±5. */
    var custom by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        PosAppBar(title = "Küche stoppen", onBack = onBack, actionIcon = R.drawable.pos_bell)

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "what") {
                Text("WAS STOPPEN?", style = PosType.overline, color = PosColors.textMuted)
            }

            SCOPES_CHOOSE.forEach { id ->
                item(key = "scope-$id") {
                    ScopeOption(id, selected = scope == id) { scope = id }
                }
            }

            item(key = "how-long") {
                Text(
                    "WIE LANGE?",
                    style = PosType.overline,
                    color = PosColors.textMuted,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            item(key = "durations") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(30, 60).forEach { m ->
                        PosTimeChip(
                            "$m Min",
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
                item(key = "stepper") {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PosStepButton("−5", enabled = minutes > STOP_MIN) {
                            minutes = (minutes - 5).coerceAtLeast(STOP_MIN)
                        }
                        Text(
                            "$minutes",
                            style = PosType.displayM.num(),
                            color = PosColors.textPrimary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f),
                        )
                        PosStepButton("+5", enabled = minutes < STOP_MAX) {
                            minutes = (minutes + 5).coerceAtMost(STOP_MAX)
                        }
                    }
                }
            }

            item(key = "release") {
                val shape = RoundedCornerShape(14.dp)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .background(PosColors.bgSurface)
                        .border(1.dp, PosColors.borderStrong, shape)
                        .padding(vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        "Wieder ab ${posClock(nowMs + minutes * 60_000L)} Uhr",
                        style = PosType.titleM.num(),
                        color = PosColors.textPrimary,
                    )
                    Text(
                        "Freigabe passiert automatisch",
                        style = PosType.bodyS,
                        color = PosColors.textMuted,
                    )
                }
            }

            item(key = "guest") {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(PosColors.tintPreparing)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "SO SIEHT ES DER GAST",
                        style = PosType.overline,
                        color = PosColors.statusPreparing,
                    )
                    Text(
                        "„${guestBlockText(scope, minutes)}“",
                        style = PosType.bodyS,
                        color = PosColors.textSecondary,
                    )
                    Text(
                        guestBlockNote(scope),
                        style = PosType.labelS,
                        color = PosColors.statusPreparing,
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
            PosButton(
                "Abbrechen",
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.GHOST,
            ) { onBack() }
            // Стоп ставится и уходит на панель состояния: человек должен
            // увидеть, что именно встало и до какого времени.
            PosButton(
                "$minutes Min stoppen",
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.DANGER,
                enabled = !loader.busy,
            ) {
                coroutine.launch {
                    error = null
                    val failure = loader.setStop(scope, minutes)
                    if (failure == null) onDone() else error = failure
                }
            }
        }
    }
}
