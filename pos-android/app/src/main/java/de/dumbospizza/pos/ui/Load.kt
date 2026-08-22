package de.dumbospizza.pos.ui

import android.content.Context
import de.dumbospizza.pos.PosApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Четыре состояния любого экрана терминала — PosLoad из веб-версии (data.tsx).
 * Общие для всех загрузчиков, потому что общая и обработка: 401 обязан
 * показаться словами (на кухне «просто ничего не происходит» — худший ответ),
 * а упавший опрос не должен стирать прошлые данные.
 */
sealed interface PosLoad<out T> {
    data object Loading : PosLoad<Nothing>
    data class Ready<T>(val data: T) : PosLoad<T>

    /** Ключ прибора не подошёл. Лечится на служебном экране, а не входом. */
    data object Unauthorized : PosLoad<Nothing>
    data class Error(val message: String) : PosLoad<Nothing>
}

fun <T> PosLoad<T>.readyOrNull(): T? = (this as? PosLoad.Ready)?.data

/**
 * GET к POS-API ключом прибора → разобранное состояние. Правило «ошибка не
 * стирает данные» применяет вызывающий: только ему видно прошлое состояние.
 */
suspend fun <T> fetchPos(
    context: Context,
    path: String,
    parse: (JSONObject) -> T,
): PosLoad<T> = withContext(Dispatchers.IO) {
    val result = runCatching { PosApi.get(context, path) }
    val http = result.getOrNull()
        ?: return@withContext PosLoad.Error(
            result.exceptionOrNull()?.message ?: "Keine Verbindung"
        )
    if (http.code == 401) return@withContext PosLoad.Unauthorized
    runCatching {
        val json = JSONObject(http.body)
        if (http.code != 200 || !json.optBoolean("success")) {
            error(json.optString("error").ifEmpty { "HTTP ${http.code}" })
        }
        parse(json)
    }.fold(
        onSuccess = { PosLoad.Ready(it) },
        onFailure = { PosLoad.Error(it.message ?: "Fehler") },
    )
}
