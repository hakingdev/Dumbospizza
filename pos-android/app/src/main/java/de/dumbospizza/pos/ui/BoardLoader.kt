package de.dumbospizza.pos.ui

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.dumbospizza.pos.PosApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Данные ленты заказов: опрос `/api/pos/v1/board` ключом прибора.
 *
 * Веб-терминал ходит сессией персонала (вход на приборе раз в 30 дней);
 * нативному вход не нужен вовсе — auth.ts пускает прибор по `X-Pos-Key`, а
 * ключ уже настроен на служебном экране ради печати.
 */
class BoardLoader(private val context: Context) {

    var state: PosLoad<Board> by mutableStateOf(PosLoad.Loading)
        private set

    /**
     * Поправка часов прибора к серверу: serverTimeMs − «сейчас» на момент
     * ответа. Прибор стоит на кухне месяцами и его время уезжает; отсчёт по
     * нему дал бы кухне чужой таймер (та же поправка, что skewRef в data.tsx).
     */
    var skewMs: Long by mutableStateOf(0L)
        private set

    /** Идёт действие (стоп-кнопки) — двойное касание не должно слать два POST. */
    var busy: Boolean by mutableStateOf(false)
        private set

    /** Вечный опрос ленты. Живёт, пока жива композиция нативного терминала. */
    suspend fun poll(): Nothing {
        while (true) {
            refresh()
            delay(POLL_MS)
        }
    }

    suspend fun refresh() {
        when (val next = fetchPos(context, "/api/pos/v1/board", ::parseBoard)) {
            is PosLoad.Ready -> {
                skewMs = next.data.serverTimeMs - System.currentTimeMillis()
                state = next
            }
            is PosLoad.Unauthorized -> state = next
            // Прошлые данные не стираем: лента, устаревшая на секунды,
            // полезнее пустого экрана — заказы на ней всё ещё те же самые.
            is PosLoad.Error -> if (state !is PosLoad.Ready) state = next
            is PosLoad.Loading -> Unit
        }
    }

    /**
     * Поставить, продлить или снять стоп приёма. `minutes = 0` снимает.
     * Пишет в те же настройки, что стоп-бот и админка, — прибор просто ещё
     * одна кнопка к общему выключателю.
     */
    suspend fun setStop(scope: String, minutes: Int) {
        if (busy) return
        busy = true
        withContext(Dispatchers.IO) {
            runCatching {
                PosApi.post(
                    context,
                    "/api/pos/v1/kitchen",
                    JSONObject().put("scope", scope).put("minutes", minutes),
                )
            }
        }
        // Ответ баннеру не нужен — правду покажет свежая лента.
        refresh()
        busy = false
    }

    /**
     * Прямое действие с карточки: перевести заказ в статус тем же PUT, что и
     * экран заказа. null — успех, иначе текст ошибки для полоски над лентой.
     */
    suspend fun actOnOrder(orderId: String, next: PosStatus): String? {
        if (busy) return null
        busy = true
        val result = withContext(Dispatchers.IO) {
            runCatching {
                PosApi.put(
                    context,
                    "/api/orders/" + Uri.encode(orderId),
                    JSONObject().put("status", next.orderWire),
                )
            }
        }
        val error = result.fold(
            onFailure = { it.message ?: "Keine Verbindung" },
            onSuccess = { http ->
                when {
                    http.code == 401 -> "Zugriff verweigert — Schlüssel prüfen"
                    http.code !in 200..299 -> runCatching {
                        JSONObject(http.body).optString("error").ifEmpty { null }
                    }.getOrNull() ?: "HTTP ${http.code}"
                    else -> null
                }
            },
        )
        refresh()
        busy = false
        return error
    }

    companion object {
        /** Насколько часто прибор перечитывает ленту — POS_POLL_MS веба. */
        const val POLL_MS = 5_000L
    }
}
