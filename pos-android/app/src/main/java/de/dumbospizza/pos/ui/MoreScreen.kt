package de.dumbospizza.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.unit.dp
import de.dumbospizza.pos.PosPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * «Mehr» — настройки прибора, порт app/pos/more/page.tsx.
 *
 * Содержимое выбрано по тому, за чем сюда реально придут: сеть, звук сигнала,
 * стоп кухни и настройки печати. Блок «DRUCK» правится прямо с прибора (PATCH
 * ключом прибора — открыт по решению владельца); «GERÄT» остаётся справочным:
 * ширина чека измерена печатью линейки, промах разъезжает весь бон.
 */

/** Сколько звучит проверка. Полминуты рингтона на кухне никому не нужны. */
private const val ALERT_TEST_MS = 5_000L

@Composable
fun MoreScreen(
    settings: SettingsLoader,
    bridge: PosBridge,
    onKitchenStatus: () -> Unit,
    onKitchenStop: () -> Unit,
) {
    LaunchedEffect(settings) { settings.poll() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val view = settings.state.readyOrNull()

    // Имя выбранного звука: перечитывается после каждого возврата из пикера.
    // Чтение — SharedPreferences и медиатека, то есть диск: уводим с главного.
    val soundVersion by bridge.alertSoundVersion
    var alertName by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(soundVersion) {
        alertName = withContext(Dispatchers.IO) {
            bridge.alertSoundName().trim().ifEmpty { null }
        }
    }

    // Уход со вкладки обрывает проверочный звук: выбранный сигнал зациклен, и
    // без этого он звенел бы до перезагрузки прибора. Настоящему сигналу о
    // заказе обрыв не страшен — лента повторит его через десять секунд.
    DisposableEffect(bridge) {
        onDispose { bridge.stopAlert() }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PosColors.bgBase)
    ) {
        PosAppBar(title = "Mehr")

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (view == null) {
                item(key = "state") {
                    PosScreenState(settings.state) { scope.launch { settings.refresh() } }
                }
            }

            item(key = "network") {
                MoreCard("GERÄT-NETZWERK") {
                    MoreButton("WLAN einrichten") { bridge.openWifiPicker() }
                    Text(
                        "Öffnet die Netzwerkauswahl des Geräts.",
                        style = PosType.bodyS,
                        color = PosColors.textMuted,
                    )
                }
            }

            item(key = "signal") {
                MoreCard("SIGNAL") {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            "Ton bei neuer Bestellung",
                            style = PosType.titleS,
                            color = PosColors.textPrimary,
                        )
                        // Пусто — повар ничего не выбирал, звучит штатный
                        // будильник прибора (alertCandidates в KioskActivity).
                        Text(
                            alertName ?: "Standard-Alarmton",
                            style = PosType.bodyS,
                            color = PosColors.textMuted,
                        )
                    }
                    MoreButton("Ton auswählen") { bridge.pickAlertSound() }
                    MoreButton("Ton testen") {
                        scope.launch {
                            withContext(Dispatchers.IO) { bridge.playAlert() }
                            delay(ALERT_TEST_MS)
                            bridge.stopAlert()
                        }
                    }
                    Text(
                        "Der Ton wiederholt sich alle 10 Sekunden, bis die Bestellung " +
                            "angenommen ist. Erste Berührung des Bildschirms stoppt ihn.",
                        style = PosType.bodyS,
                        color = PosColors.textMuted,
                    )
                }
            }

            item(key = "kitchen") {
                MoreCard("KÜCHE") {
                    MoreButton("Küchen-Status", onClick = onKitchenStatus)
                    MoreButton("Küche stoppen", onClick = onKitchenStop)
                }
            }

            view?.settings?.let { s ->
                item(key = "print") {
                    MoreCard("DRUCK") {
                        val busy = settings.saving
                        SettingToggle(
                            "Automatisch drucken",
                            "Neue Bestellungen gehen sofort auf den Bondrucker",
                            on = s.enabled,
                            enabled = !busy,
                        ) { scope.launch { settings.save(JSONObject().put("enabled", it)) } }
                        CardLine()
                        SettingStep(
                            "Kopien",
                            "Wie oft jeder Bon gedruckt wird",
                            value = s.copies, min = 1, max = 3,
                            enabled = !busy,
                        ) { scope.launch { settings.save(JSONObject().put("copies", it)) } }
                        CardLine()
                        SettingStep(
                            "Vorschub",
                            "Leerzeilen am Ende — das Gerät hat kein Messer",
                            value = s.feedLines, min = 0, max = 12,
                            enabled = !busy,
                        ) { scope.launch { settings.save(JSONObject().put("feedLines", it)) } }
                        CardLine()
                        SettingToggle(
                            "Fett drucken",
                            "Nur nötig, wenn der Druck zu blass ist",
                            on = s.boldBody,
                            enabled = !busy,
                        ) { scope.launch { settings.save(JSONObject().put("boldBody", it)) } }
                        CardLine()
                        SettingToggle(
                            "Große Überschriften",
                            "Kategorien, Bestellart und HINWEIS doppelt hoch",
                            on = s.bigAccents,
                            enabled = !busy,
                        ) { scope.launch { settings.save(JSONObject().put("bigAccents", it)) } }
                    }
                }

                item(key = "device") {
                    MoreCard("GERÄT") {
                        PosRow("Bonbreite", "${s.width} Zeichen")
                        CardLine()
                        PosRow("Abfrage alle", "${(s.pollMs / 1000)} s")
                        CardLine()
                        PosRow("Gerät", PosPrefs.deviceId(context))
                        MoreButton("Service-Bildschirm") { bridge.openServiceScreen() }
                        Text(
                            "Server-Adresse, Schlüssel, Druckertest und der " +
                                "WebView/Native-Umschalter. PIN erforderlich.",
                            style = PosType.bodyS,
                            color = PosColors.textMuted,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Тумблер настройки с подписью-пояснением — как SettingRow веб-вкладки.
 * Пояснение обязательно: «Vorschub» без слов «Leerzeilen am Ende» на кухне
 * не значит ничего.
 */
@Composable
private fun SettingToggle(
    title: String,
    sub: String,
    on: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = PosType.labelL, color = PosColors.textPrimary)
            Text(sub, style = PosType.bodyS, color = PosColors.textMuted)
        }
        PosSwitch(on, enabled, onChange)
    }
}

/** Число со стрелками ± в границах сервера — как SettingStep веб-вкладки. */
@Composable
private fun SettingStep(
    title: String,
    sub: String,
    value: Int,
    min: Int,
    max: Int,
    enabled: Boolean,
    onChange: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = PosType.labelL, color = PosColors.textPrimary)
            Text(sub, style = PosType.bodyS, color = PosColors.textMuted)
        }
        PosStepButton("−", enabled = enabled && value > min) { onChange(value - 1) }
        Text(
            "$value",
            style = PosType.titleL.num(),
            color = PosColors.textPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(36.dp),
        )
        PosStepButton("+", enabled = enabled && value < max) { onChange(value + 1) }
    }
}

/** Белая карточка с оверлайном — как Card в веб-версии «Mehr». */
@Composable
private fun MoreCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PosColors.bgSurface)
            .border(1.dp, PosColors.border, shape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = PosType.overline, color = PosColors.textMuted)
        content()
    }
}

/** Кнопка карточки, 48 dp — как на веб-вкладке. */
@Composable
private fun MoreButton(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
            .background(PosColors.bgSurface2)
            .border(1.dp, PosColors.borderStrong, shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.labelM, color = PosColors.textPrimary)
    }
}

@Composable
private fun CardLine() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(PosColors.border)
    )
}
