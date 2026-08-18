package de.dumbospizza.pos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Клиент облачного API.
 *
 * Никаких сторонних библиотек: HttpURLConnection из платформы закрывает задачу,
 * а каждая зависимость в приложении на кухне — ещё одна причина, по которой оно
 * однажды не соберётся или не запустится.
 *
 * Прибор ТОЛЬКО читает. Состояние заказа принадлежит LAN-агенту, который печатает
 * на Epson; прибор — наблюдатель, как и Telegram, и ничего у агента не забирает.
 */
object PosApi {

    /** Как прибор должен печатать. Приходит из настроек в админке. */
    data class Render(
        val width: Int,
        val boldBody: Boolean,
        val bigAccents: Boolean,
        val feedLines: Int,
    )

    data class Config(
        val enabled: Boolean,
        val pollMs: Long,
        val render: Render,
        val copies: Int,
    )

    data class Job(
        val orderId: String,
        val orderNumber: String,
        val printSeq: Int,
        val copies: Int,
        val render: Render,
        val ops: JSONArray,
    ) {
        /**
         * Ключ идемпотентности: orderId+printSeq, а не один orderId. Повторная
         * выдача того же заказа (перекрытие окон опроса) чек не продублирует, а
         * «Напечатать ещё раз» из админки увеличит printSeq и напечатается честно.
         */
        val key: String get() = "$orderId:$printSeq"
    }

    /** Ответ выборки: задания плюс время сервера для сдвига курсора. */
    data class Batch(val jobs: List<Job>, val serverTimeMs: Long, val paused: Boolean)

    private const val TIMEOUT_MS = 15_000

    private fun render(o: JSONObject): Render = Render(
        width = o.optInt("width", 32),
        boldBody = o.optBoolean("boldBody", false),
        bigAccents = o.optBoolean("bigAccents", true),
        feedLines = o.optInt("feedLines", 4),
    )

    private fun open(context: Context, path: String, method: String): HttpURLConnection {
        val conn = URL(PosPrefs.apiBase(context).trimEnd('/') + path)
            .openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.setRequestProperty("X-Pos-Key", PosPrefs.secret(context))
        conn.setRequestProperty("X-Pos-Device", PosPrefs.deviceId(context))
        conn.setRequestProperty("Accept", "application/json")
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        return stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
    }

    fun fetchConfig(context: Context): Config {
        val conn = open(context, "/api/pos/v1/config", "GET")
        try {
            val body = readBody(conn)
            if (conn.responseCode != 200) error("config HTTP " + conn.responseCode)
            val cfg = JSONObject(body).getJSONObject("config")
            return Config(
                enabled = cfg.optBoolean("enabled", true),
                pollMs = cfg.optLong("pollMs", 3000L),
                render = render(cfg.getJSONObject("render")),
                copies = cfg.optInt("copies", 1),
            )
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Свежие заказы после отметки sinceMs. Курсор двигается по времени СЕРВЕРА:
     * часы прибора могут уехать, и тогда он либо пропустит заказы, либо начнёт
     * печатать их повторно.
     */
    fun fetchOrders(context: Context, sinceMs: Long, limit: Int = 3): Batch {
        val conn = open(context, "/api/pos/v1/orders?sinceMs=$sinceMs&limit=$limit", "GET")
        try {
            val body = readBody(conn)
            if (conn.responseCode != 200) error("orders HTTP " + conn.responseCode)
            val root = JSONObject(body)
            val arr = root.optJSONArray("jobs") ?: JSONArray()
            val jobs = (0 until arr.length()).map { i ->
                val j = arr.getJSONObject(i)
                Job(
                    orderId = j.getString("orderId"),
                    orderNumber = j.optString("orderNumber", j.getString("orderId")),
                    printSeq = j.optInt("printSeq", 0),
                    copies = j.optInt("copies", 1),
                    render = render(j.getJSONObject("render")),
                    ops = j.getJSONArray("ops"),
                )
            }
            return Batch(
                jobs = jobs,
                serverTimeMs = root.optLong("serverTimeMs", sinceMs),
                paused = root.optBoolean("paused", false),
            )
        } finally {
            conn.disconnect()
        }
    }
}
