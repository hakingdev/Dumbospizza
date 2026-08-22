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
 * Один заказ целиком: опрос `/api/pos/v1/orders/[id]` и смена его статуса.
 *
 * Опрос нужен и здесь, не только в ленте: заказ может изменить другой прибор
 * или админка, и открытый экран обязан это заметить.
 *
 * Статус меняется тем же PUT `/api/orders/[id]`, что шлёт веб-терминал; прибор
 * проходит по своему ключу (authorizePos на сервере). Ответ действия не
 * разбираем глубже success: правду о заказе покажет перечитка.
 */
class OrderLoader(private val context: Context) {

    var state: PosLoad<OrderDetail> by mutableStateOf(PosLoad.Loading)
        private set

    private var orderId: String? = null

    /** Идёт действие — кнопки на это время гаснут, двойное касание запрещено. */
    var busy: Boolean by mutableStateOf(false)
        private set

    /** Опрос заказа. Смена id сбрасывает экран в загрузку. */
    suspend fun poll(id: String): Nothing {
        if (orderId != id) {
            orderId = id
            state = PosLoad.Loading
        }
        while (true) {
            refresh()
            delay(BoardLoader.POLL_MS)
        }
    }

    suspend fun refresh() {
        val id = orderId ?: return
        val next = fetchPos(
            context,
            "/api/pos/v1/orders/" + Uri.encode(id),
            ::parseOrderDetail,
        )
        if (next !is PosLoad.Error || state !is PosLoad.Ready) state = next
    }

    /**
     * Перевести заказ в статус (справочник терминала) и, для приёма, назначить
     * обещание. Одним PUT, а не двумя запросами: иначе между ними существует
     * заказ, принятый без времени. null — успех, иначе текст ошибки для экрана.
     */
    suspend fun act(next: PosStatus, etaMinutes: Int? = null): String? {
        val id = orderId ?: return "Keine Bestellung"
        if (busy) return null
        busy = true
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val body = JSONObject().put("status", next.orderWire)
                etaMinutes?.let { body.put("etaMinutes", it) }
                PosApi.put(context, "/api/orders/" + Uri.encode(id), body)
            }
        }
        val error = result.fold(
            onFailure = { it.message ?: "Keine Verbindung" },
            onSuccess = { http ->
                when {
                    http.code == 401 -> "Zugriff verweigert — Schlüssel prüfen"
                    http.code !in 200..299 -> parseError(http.body) ?: "HTTP ${http.code}"
                    else -> null
                }
            },
        )
        if (error == null) refresh()
        busy = false
        return error
    }

    private fun parseError(body: String): String? = runCatching {
        JSONObject(body).optString("error").ifEmpty { null }
    }.getOrNull()
}
