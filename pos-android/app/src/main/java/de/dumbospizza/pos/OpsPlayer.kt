package de.dumbospizza.pos

import com.sunmi.peripheral.printer.SunmiPrinterService
import com.sunmi.peripheral.printer.WoyouConsts
import org.json.JSONArray

/**
 * Проигрывает операции чека, пришедшие с сервера, вызовами SDK принтера.
 *
 * Приложение НЕ строит чек: оно не знает ни про заказ, ни про категории, ни про
 * порядок блоков. Оно умеет ровно шесть операций, и вся раскладка живёт на
 * сервере в единственном экземпляре (lib/receipt/kitchen-receipt.ts).
 *
 * Почему через SDK, а не сырыми байтами: на POS-V2s немецкий текст сырым
 * потоком недостижим — ESC t прекращает печать, ESC R игнорируется, старшие
 * байты не дают ни одного символа. printText умляуты выводит верно.
 */
object OpsPlayer {

    /** Ширина колонки под цену. Хватает на «EUR 1234,56». */
    private const val PRICE_COLUMN = 11

    fun play(service: SunmiPrinterService, ops: JSONArray, render: PosApi.Render) {
        service.printerInit(null)

        fun style(key: Int, on: Boolean) =
            service.setPrinterStyle(key, if (on) WoyouConsts.ENABLE else WoyouConsts.DISABLE)

        // Двойная ВЫСОТА, не ширина: на этом принтере двойная ширина оставляет
        // 16 колонок, куда не помещается даже название заведения.
        fun big(on: Boolean) = style(WoyouConsts.ENABLE_DOUBLE_HEIGHT, on)
        fun bold(on: Boolean) = style(WoyouConsts.ENABLE_BOLD, on)

        // Базовое начертание всего чека. При плотности принтера 130 обычного
        // хватает; boldBody включают, если оттиск всё же бледный.
        bold(render.boldBody)

        for (i in 0 until ops.length()) {
            val op = ops.optJSONObject(i) ?: continue
            when (op.optString("type")) {
                "align" -> service.setAlignment(
                    if (op.optString("value") == "center") 1 else 0, null
                )

                "line" -> service.printText("-".repeat(render.width) + "\n", null)

                "blank" -> service.printText("\n", null)

                "text" -> {
                    val accent = op.optBoolean("double", false) && render.bigAccents
                    val strong = op.optBoolean("bold", false)
                    if (accent) big(true)
                    if (strong && !render.boldBody) bold(true)
                    service.printText(op.optString("text") + "\n", null)
                    if (strong && !render.boldBody) bold(false)
                    if (accent) big(false)
                }

                "lr" -> {
                    // Нативные колонки принтера: он сам прижимает цену вправо.
                    // Ручная вёрстка пробелами при переполнении слипалась —
                    // ровно та беда, которую обходит scripts/print-agent.js.
                    val strong = op.optBoolean("bold", false)
                    if (strong && !render.boldBody) bold(true)
                    service.printColumnsString(
                        arrayOf(op.optString("left"), op.optString("right")),
                        intArrayOf(render.width - PRICE_COLUMN, PRICE_COLUMN),
                        intArrayOf(0, 2),
                        null
                    )
                    if (strong && !render.boldBody) bold(false)
                }

                // Ножа у прибора нет: вместо отреза штатная выгонка бумаги,
                // чтобы чек вылез из-под крышки и его можно было оторвать.
                "cut" -> {
                    if (render.feedLines > 0) service.lineWrap(render.feedLines, null)
                    service.autoOutPaper(null)
                }
            }
        }

        // Снимаем начертание, чтобы следующее задание начиналось с чистого листа
        // даже если между ними что-то напечатает другой код.
        bold(false)
        big(false)
    }
}
