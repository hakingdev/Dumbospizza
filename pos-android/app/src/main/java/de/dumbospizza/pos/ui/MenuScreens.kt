package de.dumbospizza.pos.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.dumbospizza.pos.R
import kotlinx.coroutines.launch

/**
 * Раздел «Speisekarte» — порт страниц app/pos/menu и components/pos/menu.tsx.
 *
 * Смысл: погасить позицию прямо на приборе, когда что-то кончилось. Поэтому
 * переключатели крупные и стоят справа, под большой палец. Выключение — действие
 * с последствиями (позиция мгновенно исчезает с сайта и из приёма заказов) и
 * проходит через шторку с выбором объёма; включение обратно — одним касанием:
 * вернуть доступность безопасно, убрать — нет.
 */

/** Ein/Aus для доступности позиции. Область касания 60×48 dp, как в макете. */
@Composable
fun PosSwitch(on: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val track by animateColorAsState(
        if (on) PosColors.accent else PosColors.borderStrong,
        label = "track",
    )
    val knobX by animateDpAsState(if (on) 24.dp else 4.dp, label = "knob")
    Box(
        modifier = Modifier
            .size(width = 60.dp, height = 48.dp)
            .clip(RoundedCornerShape(24.dp))
            .clickable(enabled = enabled) { onChange(!on) }
            .alpha(if (enabled) 1f else 0.5f),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(width = 52.dp, height = 32.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(track)
        ) {
            Box(
                Modifier
                    .offset(x = knobX, y = 4.dp)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Color.White)
            )
        }
    }
}

/**
 * Категория меню. Подпись под названием говорит не «сколько всего», а «что
 * сейчас не так»: количество в стоп-листе важнее общего числа позиций.
 */
@Composable
fun PosCategoryRow(category: MenuCategory, onClick: () -> Unit) {
    val stopped = category.stoppedCount > 0
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .clickable(onClick = onClick)
            .padding(start = 14.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(PosColors.bgSurface2),
            contentAlignment = Alignment.Center,
        ) {
            Text(category.name.take(1), style = PosType.titleM, color = PosColors.textSecondary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                category.name,
                style = PosType.titleS,
                color = PosColors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(
                            if (stopped) PosColors.statusPreparing else PosColors.statusDelivered
                        )
                )
                Text(
                    "${category.itemCount} Artikel" +
                        if (stopped) " · ${category.stoppedCount} in Stop-Liste" else "",
                    style = PosType.bodyS,
                    color = if (stopped) PosColors.statusPreparing else PosColors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Icon(
            painterResource(R.drawable.pos_chevron),
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = PosColors.textMuted,
        )
    }
}

@Composable
fun PosMenuItemRow(item: MenuItem, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            // Выключенная позиция гасится текстом, а не только переключателем:
            // в ленте из четырнадцати строк одного тумблера мало.
            Text(
                item.name,
                style = if (item.available) PosType.titleS
                else PosType.titleS.copy(textDecoration = TextDecoration.LineThrough),
                color = if (item.available) PosColors.textPrimary else PosColors.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                item.sub,
                style = PosType.bodyS,
                color = PosColors.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        PosSwitch(on = item.available, enabled = enabled, onChange = onToggle)
    }
}

/** Фильтр ленты позиций: всё / активные / в стоп-листе. */
@Composable
fun PosFilterChip(label: String, active: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    val skin =
        if (active) Modifier.clip(shape).background(PosColors.accent)
        else Modifier
            .clip(shape)
            .background(PosColors.bgSurface2)
            .border(1.dp, PosColors.border, shape)
    Box(
        modifier = skin
            .height(34.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = PosType.bodyS,
            color = if (active) PosColors.textOnAccent else PosColors.textSecondary,
        )
    }
}

/** Выбор одного варианта в шторке. */
@Composable
fun PosRadioOption(title: String, sub: String, selected: Boolean, onSelect: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .clickable(onClick = onSelect)
            .padding(14.dp),
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
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = PosType.titleS, color = PosColors.textPrimary)
            Text(sub, style = PosType.bodyS, color = PosColors.textMuted)
        }
    }
}

// --- Экраны -------------------------------------------------------------------

/** 09 · Speisekarte · Kategorien. Наверху — состояние кухни, не поиск ради поиска. */
@Composable
fun MenuScreen(
    loader: MenuLoader,
    onOpenCategory: (String) -> Unit,
    onKitchenStatus: () -> Unit,
    onKitchenStop: () -> Unit,
    onStopList: () -> Unit,
) {
    LaunchedEffect(loader) { loader.pollCategories() }
    val scope = rememberCoroutineScope()
    val ready = loader.categories is PosLoad.Ready
    val categories = loader.categories.readyOrNull() ?: emptyList()
    val stoppedTotal = categories.sumOf { it.stoppedCount }

    /** Самый долгий из активных стопов — о нём и говорит плашка наверху. */
    val stop = loader.kitchen.filter { it.minutesLeft > 0 }.maxByOrNull { it.minutesLeft }

    Column(Modifier.fillMaxSize()) {
        PosAppBar(title = "Speisekarte")
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!ready) {
                item(key = "state") {
                    PosScreenState(loader.categories) {
                        scope.launch { loader.refreshCategories() }
                    }
                }
            }

            if (stop != null) {
                item(key = "stop") {
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
                            "${scopeTitle(stop.scope)} · noch ${stop.minutesLeft} Min",
                            style = PosType.bodyS,
                            color = PosColors.statusPreparing,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "Ändern",
                            style = PosType.bodyS,
                            color = PosColors.accent,
                            modifier = Modifier.clickable(onClick = onKitchenStatus),
                        )
                    }
                }
            }

            item(key = "kitchen-buttons") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MenuHeaderButton("Küche stoppen", Modifier.weight(1f), onKitchenStop)
                    // Стоп-лист — это ПОЗИЦИИ, а не стоп цехов: цеховый стоп
                    // живёт за «Küche stoppen» и за «Ändern» на плашке.
                    MenuHeaderButton("Stop-Liste $stoppedTotal", Modifier.weight(1f), onStopList)
                }
            }

            items(categories, key = { it.id }) { category ->
                PosCategoryRow(category) { onOpenCategory(category.id) }
            }

            if (ready && categories.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "Keine Kategorien vorhanden.",
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
}

/**
 * Стоп-лист: все погашенные позиции меню одним списком, группами по
 * категориям. «Stop-Liste N» ведёт сюда — N это ровно эти позиции. Вернуть в
 * продажу — одно касание; выключать отсюда нечего, всё уже выключено.
 */
@Composable
fun StopListScreen(loader: MenuLoader, onBack: () -> Unit) {
    LaunchedEffect(loader) { loader.pollStopList() }
    val scope = rememberCoroutineScope()
    val entries = loader.stopList.readyOrNull()

    Column(Modifier.fillMaxSize()) {
        PosAppBar(title = "Stop-Liste", onBack = onBack)
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (entries == null) {
                item(key = "state") {
                    PosScreenState(loader.stopList) { scope.launch { loader.refreshStopList() } }
                }
            } else {
                entries.groupBy { it.categoryName }.forEach { (categoryName, group) ->
                    item(key = "cat-$categoryName") {
                        Text(
                            categoryName.uppercase(),
                            style = PosType.overline,
                            color = PosColors.textMuted,
                        )
                    }
                    items(group, key = { it.item.id }) { entry ->
                        PosMenuItemRow(entry.item, enabled = !loader.busy) { next ->
                            // Отсюда только ВОЗВРАЩАЮТ в продажу — включение
                            // безопасно и идёт одним касанием, как и в категории.
                            if (next) {
                                scope.launch {
                                    loader.apply(entry.item.id, available = true)
                                    loader.refreshStopList()
                                }
                            }
                        }
                    }
                }
                if (entries.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            "Die Stop-Liste ist leer — alles ist bestellbar.",
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
    }
}

/** Кнопка над категориями, 50 dp — вход в стоп кухни и статус. */
@Composable
private fun MenuHeaderButton(label: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier
            .height(50.dp)
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.labelM, color = PosColors.textPrimary, maxLines = 1)
    }
}

/** Что именно гасим: всё блюдо или один его размер. */
private const val WHOLE_ITEM = "all"

private enum class MenuFilter { ALL, ACTIVE, STOPPED }

/** 10 · Speisekarte · Artikel и 11 · Sheet · Artikel in Stop-Liste. */
@Composable
fun MenuCategoryScreen(loader: MenuLoader, categoryId: String, onBack: () -> Unit) {
    LaunchedEffect(categoryId) { loader.pollItems(categoryId) }
    val scope = rememberCoroutineScope()

    var filter by rememberSaveable { mutableStateOf(MenuFilter.ALL) }
    var pendingId by rememberSaveable { mutableStateOf<String?>(null) }
    var stopScope by rememberSaveable { mutableStateOf(WHOLE_ITEM) }

    val data = loader.items.readyOrNull()
    val items = data?.items ?: emptyList()
    val activeCount = items.count { it.available }
    val visible = when (filter) {
        MenuFilter.ALL -> items
        MenuFilter.ACTIVE -> items.filter { it.available }
        MenuFilter.STOPPED -> items.filter { !it.available }
    }
    val pending = items.firstOrNull { it.id == pendingId }

    Column(Modifier.fillMaxSize()) {
        PosAppBar(title = data?.name ?: "Artikel", onBack = onBack)
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (data == null) {
                item(key = "state") {
                    PosScreenState(loader.items) { scope.launch { loader.refreshItems() } }
                }
            }

            item(key = "chips") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PosFilterChip("Alle ${items.size}", filter == MenuFilter.ALL) {
                        filter = MenuFilter.ALL
                    }
                    PosFilterChip("Aktiv $activeCount", filter == MenuFilter.ACTIVE) {
                        filter = MenuFilter.ACTIVE
                    }
                    PosFilterChip("Stop-Liste ${items.size - activeCount}", filter == MenuFilter.STOPPED) {
                        filter = MenuFilter.STOPPED
                    }
                }
            }

            item(key = "whole") {
                val shape = RoundedCornerShape(14.dp)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .background(PosColors.bgSurface)
                        .border(1.dp, PosColors.border, shape)
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Ganze Kategorie", style = PosType.titleS, color = PosColors.textPrimary)
                        Text(
                            "Schaltet alle ${items.size} Artikel auf einmal",
                            style = PosType.bodyS,
                            color = PosColors.textMuted,
                        )
                    }
                    // Категорию переключаем по одной позиции — см. applyWholeCategory.
                    PosSwitch(on = activeCount > 0, enabled = !loader.busy && items.isNotEmpty()) { next ->
                        scope.launch { loader.applyWholeCategory(items, next) }
                    }
                }
            }

            items(visible, key = { it.id }) { item ->
                PosMenuItemRow(item, enabled = !loader.busy) { next ->
                    // Включение — сразу. Выключение спрашивает объём: у пиццы
                    // гасят размер, а не всё блюдо, и ошибиться здесь дороже,
                    // чем лишний раз нажать.
                    if (next) {
                        scope.launch { loader.apply(item.id, available = true) }
                    } else {
                        stopScope = WHOLE_ITEM
                        pendingId = item.id
                    }
                }
            }

            if (data != null && visible.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "Keine Artikel in dieser Auswahl.",
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

    PosSheet(
        open = pending != null,
        title = "${pending?.name ?: ""} in die Stop-Liste?",
        subtitle = "Verschwindet sofort aus Web, App und Bestellannahme.",
        onClose = { pendingId = null },
        actions = {
            PosButton(
                "Abbrechen",
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.GHOST,
            ) { pendingId = null }
            PosButton(
                "In Stop-Liste",
                modifier = Modifier.weight(1f),
                enabled = !loader.busy,
            ) {
                val target = pending ?: return@PosButton
                scope.launch {
                    if (stopScope == WHOLE_ITEM) loader.apply(target.id, available = false)
                    else loader.apply(target.id, sizeId = stopScope, active = false)
                    pendingId = null
                }
            }
        },
    ) {
        Text("WAS AUSSCHALTEN?", style = PosType.overline, color = PosColors.textMuted)
        PosRadioOption(
            title = "Ganzer Artikel",
            sub = "Alle Größen und Varianten",
            selected = stopScope == WHOLE_ITEM,
        ) { stopScope = WHOLE_ITEM }
        (pending?.sizes ?: emptyList()).forEach { size ->
            PosRadioOption(
                title = "Nur ${size.name}",
                sub = "${size.price} · andere Größen bleiben bestellbar",
                selected = stopScope == size.id,
            ) { stopScope = size.id }
        }
        Text(
            "Keine automatische Rückkehr: der Artikel bleibt aus, bis Sie ihn wieder aktivieren.",
            style = PosType.bodyS,
            color = PosColors.textMuted,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(PosColors.bgSurface2)
                .padding(12.dp),
        )
    }
}
