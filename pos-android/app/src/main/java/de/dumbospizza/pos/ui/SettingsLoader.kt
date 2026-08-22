package de.dumbospizza.pos.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Настройки печати для вкладки «Mehr» — GET `/api/pos/v1/settings`.
 *
 * С прибора они ТОЛЬКО читаются: PATCH сервер пускает лишь персоналу
 * (веб-режим со входом или админка) — прибор не должен переписывать
 * собственные настройки, иначе сбой на одном устройстве менял бы печать
 * для всех.
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

fun parseSettingsView(root: JSONObject): SettingsView {
    val s = root.optJSONObject("settings") ?: JSONObject()
    return SettingsView(
        settings = PrintSettings(
            enabled = s.optBoolean("enabled", true),
            copies = s.optInt("copies", 1),
            feedLines = s.optInt("feedLines", 4),
            boldBody = s.optBoolean("boldBody", false),
            bigAccents = s.optBoolean("bigAccents", true),
            width = s.optInt("width", 32),
            pollMs = s.optLong("pollMs", 3000L),
        ),
        signedInAs = root.optString("signedInAs").ifEmpty { null },
    )
}

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

    companion object {
        /** Настройки меняются редко — как и меню, раз в 30 секунд. */
        const val POLL_MS = 30_000L
    }
}
