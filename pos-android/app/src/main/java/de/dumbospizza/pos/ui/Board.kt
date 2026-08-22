package de.dumbospizza.pos.ui

import androidx.compose.ui.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Модель ленты заказов и её подписи — порт lib/pos/board.ts и components/pos/
 * data.tsx с сайта. Правила здесь обязаны совпадать с веб-терминалом строка в
 * строку: пока живут оба режима, кухня переключается между ними и не должна
 * видеть два разных терминала.
 *
 * Сервер отдаёт факты (тип доставки, дедлайн, момент закрытия), а слова
 * подбирает экран — поэтому весь немецкий текст карточек живёт в этом файле,
 * как в вебе он живёт в data.tsx.
 */

/**
 * Статусы в том виде, в каком их различает терминал (PosBoardStatus).
 * `orderWire` — имя того же статуса в базе (TO_ORDER из board.ts): его шлёт
 * PUT /api/orders/[id]; справочник в обе стороны, чтобы кнопка терминала не
 * отправила на сервер статус, которого в модели нет.
 */
enum class PosStatus(val wire: String, val orderWire: String, val label: String) {
    NEW("new", "new", "Neu"),
    PREPARING("preparing", "preparing", "In Zubereitung"),
    READY("ready", "ready_for_delivery", "Bereit zur Lieferung"),
    DELIVERING("delivering", "delivering", "Unterwegs"),
    DELIVERED("delivered", "completed", "Geliefert"),
    CANCELLED("cancelled", "cancelled", "Storniert");

    companion object {
        fun from(wire: String): PosStatus? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * Цвет статуса и заливка его бейджа (order-list.tsx POS_STATUS). Непринятый
 * заказ красится акцентом, а не статусным цветом: это не этап приготовления,
 * а требование решения — его видно и боковым зрением.
 */
val PosStatus.textColor: Color
    get() = when (this) {
        PosStatus.NEW -> PosColors.accent
        PosStatus.PREPARING -> PosColors.statusPreparing
        PosStatus.READY -> PosColors.statusReady
        PosStatus.DELIVERING -> PosColors.statusDelivering
        PosStatus.DELIVERED -> PosColors.statusDelivered
        PosStatus.CANCELLED -> PosColors.statusCancelled
    }

val PosStatus.tintColor: Color
    get() = when (this) {
        PosStatus.NEW -> PosColors.accentSubtle
        PosStatus.PREPARING -> PosColors.tintPreparing
        PosStatus.READY -> PosColors.tintReady
        PosStatus.DELIVERING -> PosColors.tintDelivering
        PosStatus.DELIVERED -> PosColors.tintDelivered
        PosStatus.CANCELLED -> PosColors.tintCancelled
    }

/** Строка ленты — PosBoardOrder из board.ts, поле в поле. */
data class BoardOrder(
    val id: String,
    val number: String,
    val status: PosStatus,
    val pickup: Boolean,
    val address: String,
    val channel: String,
    val customerName: String,
    val items: String,
    val total: String,
    val dueMs: Long?,
    val desiredMs: Long?,
    val etaMinutes: Int?,
    val createdMs: Long,
    val closedMs: Long?,
    val paid: Boolean,
) {
    /**
     * Статус, которым заказ ПОКАЗЫВАЮТ (posDisplayStatus): у доставки
     * ready_for_delivery означает «уехал к гостю», и только самовывоз с этим
     * статусом остаётся «ждёт у стойки».
     */
    val displayStatus: PosStatus
        get() = if (status == PosStatus.READY && !pickup) PosStatus.DELIVERING else status
}

/** Активный стоп приёма — баннер паузы. Область: "all" | "pizza" | "sushi". */
data class Pause(val scope: String, val untilMs: Long)

data class Board(
    val serverTimeMs: Long,
    val orders: List<BoardOrder>,
    val counts: Map<PosStatus, Int>,
    val dayDelivered: String,
    val dayCancelled: String,
    val pause: Pause?,
)

/**
 * Вкладки ленты (POS_TAB_STATUSES). «Zubereitung» держит и непринятые, и
 * готовый самовывоз: для кухни это всё ещё работа на столе.
 */
enum class BoardTab(val label: String, val statuses: Set<PosStatus>) {
    PREPARING("Zubereitung", setOf(PosStatus.NEW, PosStatus.PREPARING, PosStatus.READY)),
    DELIVERING("Unterwegs", setOf(PosStatus.DELIVERING)),
    DELIVERED("Geliefert", setOf(PosStatus.DELIVERED)),
    CANCELLED("Storniert", setOf(PosStatus.CANCELLED)),
}

/** Число на вкладке. Сервер считает counts по экранному статусу — просто суммируем. */
fun BoardTab.count(counts: Map<PosStatus, Int>): Int = statuses.sumOf { counts[it] ?: 0 }

// --- Разбор ответа сервера ---------------------------------------------------

/** GET /api/pos/v1/board → модель. Неизвестный статус выбрасывает заказ, не экран. */
fun parseBoard(root: JSONObject): Board {
    val ordersJson = root.optJSONArray("orders") ?: JSONArray()
    val orders = (0 until ordersJson.length()).mapNotNull { parseOrder(ordersJson.getJSONObject(it)) }

    val countsJson = root.optJSONObject("counts")
    val counts = PosStatus.entries.associateWith { countsJson?.optInt(it.wire, 0) ?: 0 }

    val dayTotal = root.optJSONObject("dayTotal")
    val pause = root.optJSONObject("pause")?.let { json ->
        parseIsoMs(json.optString("untilIso"))?.let { until ->
            Pause(scope = json.optString("scope", "all"), untilMs = until)
        }
    }

    return Board(
        serverTimeMs = root.optLong("serverTimeMs", System.currentTimeMillis()),
        orders = orders,
        counts = counts,
        dayDelivered = dayTotal?.optString("delivered") ?: "0,00 €",
        dayCancelled = dayTotal?.optString("cancelled") ?: "0,00 €",
        pause = pause,
    )
}

fun parseOrder(o: JSONObject): BoardOrder? {
    val status = PosStatus.from(o.optString("status")) ?: return null
    fun optMs(key: String): Long? =
        if (o.isNull(key)) null else o.optLong(key).takeIf { it > 0 }
    return BoardOrder(
        id = o.optString("id"),
        number = o.optString("number"),
        status = status,
        pickup = o.optString("deliveryType") == "pickup",
        address = o.optString("address"),
        channel = o.optString("channel", "Telefon"),
        customerName = o.optString("customerName"),
        items = o.optString("items"),
        total = o.optString("total"),
        dueMs = optMs("dueMs"),
        desiredMs = optMs("desiredMs"),
        etaMinutes = if (o.isNull("etaMinutes")) null else o.optInt("etaMinutes"),
        createdMs = o.optLong("createdMs"),
        closedMs = optMs("closedMs"),
        paid = o.optBoolean("paid", true),
    )
}

/** Строка состава на экране деталей: количество, имя, цена за все штуки. */
data class OrderItem(val qty: Int, val name: String, val price: String)

/**
 * Заказ целиком (PosOrderDetail): строка ленты плюс то, что нужно только
 * открытому экрану — состав, телефон, заметка. В ленту это не тащат.
 */
data class OrderDetail(
    val summary: BoardOrder,
    val phone: String,
    val note: String,
    val paymentMethod: String,
    val items: List<OrderItem>,
    val receiptLines: List<String>,
)

/** GET /api/pos/v1/orders/[id] → модель. null — сервер прислал не заказ. */
fun parseOrderDetail(root: JSONObject): OrderDetail {
    val o = root.optJSONObject("order") ?: error("kein Bestellobjekt")
    val summary = parseOrder(o) ?: error("unbekannter Status")
    val itemsArr = o.optJSONArray("items") ?: JSONArray()
    val linesArr = o.optJSONArray("receiptLines") ?: JSONArray()
    return OrderDetail(
        summary = summary,
        phone = o.optString("phone"),
        note = o.optString("note"),
        paymentMethod = o.optString("paymentMethod"),
        items = (0 until itemsArr.length()).map { i ->
            val item = itemsArr.getJSONObject(i)
            OrderItem(
                qty = item.optInt("qty", 1),
                name = item.optString("name"),
                price = item.optString("price"),
            )
        },
        receiptLines = (0 until linesArr.length()).map { linesArr.getString(it) },
    )
}

/**
 * ISO-строка сервера → epoch ms. Формат ровно один — `Date.toISOString()`
 * всегда отдаёт миллисекунды и Z. java.time на minSdk 24 недоступен (API 26+),
 * поэтому SimpleDateFormat.
 */
fun parseIsoMs(iso: String): Long? = runCatching {
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .parse(iso)?.time
}.getOrNull()

// --- Формат времени и подписи карточек (data.tsx) ------------------------------

private const val BERLIN_TZ = "Europe/Berlin"

/** «19:20» по времени заведения, а не по часовому поясу прибора. */
fun posClock(ms: Long?): String {
    if (ms == null || ms <= 0) return "—"
    return SimpleDateFormat("HH:mm", Locale.GERMANY)
        .apply { timeZone = TimeZone.getTimeZone(BERLIN_TZ) }
        .format(Date(ms))
}

/** «12:30» — минуты и секунды до срока. */
fun posCountdown(msLeft: Long): String {
    val total = (abs(msLeft) / 1000.0).roundToLong().coerceAtLeast(0)
    val mm = (total / 60).toString().padStart(2, '0')
    val ss = (total % 60).toString().padStart(2, '0')
    return "$mm:$ss"
}

/** «Lieferung · Musterstr. 12 · via Lieferando» */
fun orderMeta(order: BoardOrder): String {
    val where =
        if (order.pickup) "Abholung · Theke"
        else "Lieferung · ${order.address.ifEmpty { "—" }}"
    return "$where · via ${order.channel}"
}

data class OrderNote(val text: String, val overdue: Boolean)

/**
 * Левая нижняя строка карточки: таймер там, где он есть, и внятная замена там,
 * где его нет (posOrderNote). `overdue` подсвечивает просрочку независимо от
 * статуса. Ветвление — по ЭКРАННОМУ статусу, как и вкладки.
 */
fun orderNote(order: BoardOrder, nowMs: Long): OrderNote {
    val left = order.dueMs?.let { it - nowMs }
    return when (order.displayStatus) {
        PosStatus.NEW -> OrderNote(
            if (order.desiredMs == null) "Neu · noch nicht angenommen"
            else "Neu · Wunschzeit ${posClock(order.desiredMs)}",
            overdue = false,
        )

        PosStatus.PREPARING -> when {
            left == null -> OrderNote("Zeit noch nicht gesetzt", overdue = false)
            left >= 0 -> OrderNote(
                "Noch ${posCountdown(left)} Min · fertig ${posClock(order.dueMs)}",
                overdue = false,
            )
            else -> OrderNote("Überfällig · +${posCountdown(left)} Min", overdue = true)
        }

        // Сюда доходит только самовывоз: доставку displayStatus увёл в DELIVERING.
        PosStatus.READY -> OrderNote("Fertig · wartet auf Abholung", overdue = false)

        PosStatus.DELIVERING -> OrderNote(
            if (order.dueMs != null) "Unterwegs · Ankunft ${posClock(order.dueMs)}" else "Unterwegs",
            overdue = false,
        )

        PosStatus.DELIVERED -> {
            val verb = if (order.pickup) "Abgeholt" else "Zugestellt"
            val closed = order.closedMs
                ?: return OrderNote(verb, overdue = false)
            val minutes = ((closed - order.createdMs) / 60_000.0).roundToInt().coerceAtLeast(0)
            OrderNote("$verb ${posClock(closed)} · $minutes Min", overdue = false)
        }

        PosStatus.CANCELLED -> OrderNote(
            if (order.closedMs != null) "Storniert ${posClock(order.closedMs)}" else "Storniert",
            overdue = false,
        )
    }
}

/**
 * Название области стопа. Те же слова, что видит гость в сообщении о стопе и
 * персонал в Telegram (lib/kitchen/workshops.ts WORKSHOPS.*.de).
 */
fun scopeTitle(scope: String): String = when (scope) {
    "pizza" -> "Pizza & Beilagen"
    "sushi" -> "MakiLove (Sushi)"
    else -> "Alles"
}

/** Заголовок баннера паузы над лентой. */
fun pauseTitle(scope: String): String = "${scopeTitle(scope)} gestoppt"

fun pauseReason(scope: String): String =
    if (scope == "all") "Küche überlastet" else "Werkstatt gestoppt"
