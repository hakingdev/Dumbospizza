package de.dumbospizza.pos

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Build
import android.os.RemoteException
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.InnerResultCallback
import com.sunmi.peripheral.printer.SunmiPrinterService
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Служебный экран прибора.
 *
 * Заказы кухня принимает в терминале (KioskActivity) — здесь только то, чего со
 * стороны сайта не сделать: привязка к серверу, запуск службы печати и
 * диагностика принтера.
 *
 * Значка в списке приложений у экрана нет: на него попадают ДОЛГИМ нажатием на
 * левый верхний угол киоска. Иначе рядом с терминалом висела бы вторая иконка,
 * ведущая в настройки печати, и однажды на неё нажали бы в смену.
 *
 * Печать сырыми ESC/POS-байтами из приложения убрана: на POS-V2s немецкий текст
 * по этому каналу недостижим (ESC t глушит печать, ESC R игнорируется, старшие
 * байты пусты). Байты остались только для Epson по LAN и собираются на сервере.
 */
class MainActivity : Activity() {

    private var printerService: SunmiPrinterService? = null
    private lateinit var logView: TextView
    private lateinit var apiField: EditText
    private lateinit var secretField: EditText
    private lateinit var pinField: EditText

    private val printerCallback = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService) {
            printerService = service
            runOnUiThread {
                log("✓ принтер подключён")
                showPrinterInfo()
            }
        }

        override fun onDisconnected() {
            printerService = null
            runOnUiThread { log("✗ принтер отвалился") }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        log("Dumbo POS — служебный экран")
        log("прибор: ${PosPrefs.deviceId(this)}")
        log("служба: ${if (PosPrefs.serviceEnabled(this)) "включена" else "выключена"}")
        bindPrinter()
    }

    override fun onDestroy() {
        runCatching { InnerPrinterManager.getInstance().unBindService(this, printerCallback) }
        super.onDestroy()
    }

    // --- UI ------------------------------------------------------------------

    private fun buildUi(): ViewGroup {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }

        root.addView(label("Адрес сервера"))
        apiField = EditText(this).apply {
            setText(PosPrefs.apiBase(this@MainActivity))
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        root.addView(apiField)

        root.addView(label("Ключ доступа"))
        secretField = EditText(this).apply {
            setText(PosPrefs.secret(this@MainActivity))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        root.addView(secretField)

        root.addView(label("PIN служебного экрана (пусто — без PIN)"))
        pinField = EditText(this).apply {
            setText(PosPrefs.servicePin(this@MainActivity))
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setSingleLine()
        }
        root.addView(pinField)

        root.addView(button("СОХРАНИТЬ И ЗАПУСТИТЬ ПЕЧАТЬ") { saveAndStart() })
        root.addView(button("Остановить службу") { stopPrinting() })
        root.addView(button("Параметры принтера") { showPrinterInfo() })
        root.addView(button("Пробный чек") { printProbeReceipt() })
        root.addView(button("Самотест принтера") { selfTest() })
        root.addView(button("Wi-Fi и сеть") { openWifiSettings() })
        // Возврат в киоск — тот же, что по кнопке «Назад», но названный словами:
        // системных кнопок на закреплённом экране может не быть вовсе.
        root.addView(button("← ВЕРНУТЬСЯ В ТЕРМИНАЛ") { finish() })

        logView = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextIsSelectable(true)
            setTextColor(Color.DKGRAY)
        }
        root.addView(
            ScrollView(this).apply { addView(logView) },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        return root
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    }

    private fun button(caption: String, onClick: () -> Unit) = Button(this).apply {
        text = caption
        setOnClickListener { onClick() }
    }

    private fun log(message: String) {
        val stamp = SimpleDateFormat("HH:mm:ss", Locale.GERMANY).format(Date())
        logView.append("[$stamp] $message\n")
    }

    // --- Служба --------------------------------------------------------------

    private fun saveAndStart() {
        val api = apiField.text.toString().trim()
        val secret = secretField.text.toString().trim()
        if (secret.isBlank()) {
            log("✗ без ключа доступа служба не запустится")
            return
        }
        PosPrefs.setApiBase(this, api)
        PosPrefs.setSecret(this, secret)
        PosPrefs.setServicePin(this, pinField.text.toString())
        // Курсор в «сейчас»: прибор напечатает только то, что появится ПОСЛЕ
        // настройки. Иначе первое подключение вывалило бы всю историю заказов.
        if (PosPrefs.cursorMs(this) == 0L) {
            PosPrefs.setCursorMs(this, System.currentTimeMillis())
        }
        PosPrefs.setServiceEnabled(this, true)
        PrintService.start(this)
        log("✓ служба запущена, опрос $api")
        log("  дальше работает сама и переживает перезагрузку прибора")
    }

    private fun stopPrinting() {
        PosPrefs.setServiceEnabled(this, false)
        PrintService.stop(this)
        log("служба остановлена")
    }

    /**
     * Настройки Wi-Fi прибора.
     *
     * Единственный путь к ним с запертого киоска, поэтому кнопка живёт здесь, за
     * PIN. Сначала пробуем панель подключений: она показывает только сети и не
     * даёт разгуляться по всем настройкам прибора. Если панели нет (до Android 10),
     * открываем обычный экран Wi-Fi.
     */
    private fun openWifiSettings() {
        val opened = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { startActivity(Intent(Settings.Panel.ACTION_WIFI)) }.isSuccess
        } else false
        if (!opened) {
            runCatching { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) }
                .onFailure { log("✗ настройки Wi-Fi недоступны: ${it.message}") }
        }
    }

    // --- Диагностика ---------------------------------------------------------

    private fun bindPrinter() {
        try {
            InnerPrinterManager.getInstance().bindService(this, printerCallback)
        } catch (e: Exception) {
            log("✗ привязка принтера: ${e.message}")
        }
    }

    private fun requirePrinter(): SunmiPrinterService? {
        val service = printerService
        if (service == null) log("✗ принтер ещё не подключён")
        return service
    }

    private fun showPrinterInfo() {
        val service = requirePrinter() ?: return
        try {
            val paper = service.printerPaper
            log("модель: ${service.printerModal}, прошивка ${service.printerVersion}")
            log("бумага: ${if (paper == 2) "80 мм" else "58 мм"}, плотность ${service.printerDensity}")
            log("состояние: ${describeState(service.updatePrinterState())}")
        } catch (e: RemoteException) {
            log("✗ опрос принтера: ${e.message}")
        }
    }

    private fun describeState(code: Int): String = when (code) {
        1 -> "готов"
        2 -> "готовится"
        3 -> "ошибка связи"
        4 -> "НЕТ БУМАГИ"
        5 -> "перегрев"
        6 -> "открыта крышка"
        7 -> "не обнаружена бумага"
        8 -> "обновление прошивки"
        else -> "неизвестно ($code)"
    }

    private fun selfTest() {
        val service = requirePrinter() ?: return
        runCatching { service.printerSelfChecking(resultCallback("самотест")) }
            .onFailure { log("✗ самотест: ${it.message}") }
    }

    /**
     * Пробный чек теми же средствами, что и боевая печать: операции собираются
     * локально и проигрываются через OpsPlayer. Если он выглядит правильно,
     * значит и заказ с сервера напечатается правильно — отличаться будет только
     * содержимое операций.
     */
    private fun printProbeReceipt() {
        val service = requirePrinter() ?: return
        try {
            val ops = JSONArray()
            fun op(vararg pairs: Pair<String, Any>) {
                ops.put(JSONObject().apply { pairs.forEach { put(it.first, it.second) } })
            }

            op("type" to "align", "value" to "center")
            op("type" to "text", "text" to "DUMBO SLICE PIZZA", "bold" to true, "double" to true)
            op("type" to "text", "text" to "Kurhausstr. 11A - Bad Kissingen")
            op("type" to "text", "text" to "Tel: +49 163 2165979")
            op("type" to "line")
            op("type" to "align", "value" to "left")
            op("type" to "text", "text" to "PROBEDRUCK", "bold" to true, "double" to true)
            op("type" to "text", "text" to "Kunde: Nicole Schröder")
            op("type" to "text", "text" to "Ümpfingstraße 11B, Nüdlingen")
            op("type" to "line")
            op("type" to "text", "text" to "Pizza", "bold" to true, "double" to true)
            op("type" to "lr", "left" to "1x Margherita", "right" to "EUR 7,90")
            op("type" to "text", "text" to "   - Solo ca. 20x20")
            op("type" to "lr", "left" to "2x Quattro Stagioni mit Käse", "right" to "EUR 25,80")
            op("type" to "line")
            op("type" to "lr", "left" to "GESAMT:", "right" to "EUR 33,70", "bold" to true)
            op("type" to "line")
            op("type" to "text", "text" to "HINWEIS:", "bold" to true, "double" to true)
            op("type" to "text", "text" to "Ohne Zwiebeln, bitte klingeln")
            op("type" to "line")
            op("type" to "align", "value" to "center")
            op("type" to "text", "text" to "Kein Kassenbon")
            op("type" to "cut")

            val paper = service.printerPaper
            OpsPlayer.play(
                service,
                ops,
                PosApi.Render(
                    width = if (paper == 2) 48 else 32,
                    boldBody = false,
                    bigAccents = true,
                    feedLines = 4
                )
            )
            log("→ пробный чек напечатан через OpsPlayer")
        } catch (e: Exception) {
            log("✗ пробный чек: ${e.message}")
        }
    }

    private fun resultCallback(tag: String) = object : InnerResultCallback() {
        override fun onRunResult(isSuccess: Boolean) {
            runOnUiThread { log("[$tag] выполнено: $isSuccess") }
        }

        override fun onReturnString(result: String?) {
            runOnUiThread { log("[$tag] $result") }
        }

        override fun onRaiseException(code: Int, msg: String?) {
            runOnUiThread { log("[$tag] ✗ $code: $msg") }
        }

        override fun onPrintResult(code: Int, msg: String?) {
            runOnUiThread { log("[$tag] результат $code: $msg") }
        }
    }
}
