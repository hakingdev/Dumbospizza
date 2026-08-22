package de.dumbospizza.pos.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.dumbospizza.pos.PosApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Настройки печати для вкладки «Mehr» — GET и PATCH `/api/pos/v1/settings`.
 *
 * Запись с прибора открыта по решению владельца: настройки печати меняет тот,
 * кто стоит у принтера. Сервер по-прежнему нормализует значения и пускает с
 * прибора только поля печати — заголовок чека и цеха отсюда не переписать.
 */
data class PrintSettings(
    val enabled: Boolean,
    val copies: Int,
    val feedLines: Int,
    val boldBody: Boolean,
    val bigAccents: Boolean,
    val width: Int,
    val pollMs: Long,
)

data class SettingsView(val settings: PrintSettings, val signedInAs: String?)

fun parsePrintSettings(s: JSONObject): PrintSettings = PrintSettings(
    enabled = s.optBoolean("enabled", true),
    copies = s.optInt("copies", 1),
    feedLines = s.optInt("feedLines", 4),
    boldBody = s.optBoolean("boldBody", false),
    bigAccents = s.optBoolean("bigAccents", true),
    width = s.optInt("width", 32),
    pollMs = s.optLong("pollMs", 3000L),
)

fun parseSettingsView(root: JSONObject): SettingsView = SettingsView(
    settings = parsePrintSettings(root.optJSONObject("settings") ?: JSONObject()),
    signedInAs = root.optString("signedInAs").ifEmpty { null },
)

class SettingsLoader(private val context: Context) {

    var state: PosLoad<SettingsView> by mutableStateOf(PosLoad.Loading)
        private set

    suspend fun poll(): Nothing {
        while (true) {
            refresh()
            delay(POLL_MS)
        }
    }

    suspend fun refresh() {
        val next = fetchPos(context, "/api/pos/v1/settings", ::parseSettingsView)
        if (next !is PosLoad.Error || state !is PosLoad.Ready) state = next
    }

    /** Идёт запись — управление в карточке на это время гасится. */
    var saving: Boolean by mutableStateOf(false)
        private set

    /**
     * Записать одно изменение. Ответ PATCH уже содержит нормализованные
     * сервером настройки — кладём их в состояние сразу, не дожидаясь опроса:
     * тумблер, отскакивающий на 30 секунд назад, выглядит как поломка.
     */
    suspend fun save(patch: JSONObject) {
        if (saving) return
        saving = true
        try {
            val result = withContext(Dispatchers.IO) {
                runCatching { PosApi.patch(context, "/api/pos/v1/settings", patch) }.getOrNull()
            }
            val settings = result
                ?.takeIf { it.code in 200..299 }
                ?.let { runCatching { JSONObject(it.body) }.getOrNull() }
                ?.optJSONObject("settings")
            val prev = state.readyOrNull()
            if (settings != null && prev != null) {
                state = PosLoad.Ready(prev.copy(settings = parsePrintSettings(settings)))
            } else {
                // Запись не удалась или состояние ещё не готово — честный
                // повторный GET вместо слепой веры в отправленное значение.
                refresh()
            }
        } finally {
            saving = false
        }
    }

    companion object {
        /** Настройки меняются редко — как и меню, раз в 30 секунд. */
        const val POLL_MS = 30_000L
    }
}
