package de.dumbospizza.pos

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.TelecomManager
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Киоск: прибор показывает терминал приёма заказов и больше ничего.
 *
 * Терминал — это веб под `/pos` на нашем сервере, а не нативные экраны: правка
 * вёрстки не должна означать пересборку APK и поход на кухню. Приложение здесь
 * ровно оболочка — полный экран, никакого адресного поля и никакого выхода
 * наружу по ссылке.
 *
 * Активность объявлена ДОМАШНИМ экраном (`category.HOME`). Это и есть «чтобы
 * только он был»: кнопка «домой» возвращает в терминал, а после перезагрузки
 * Android сам поднимает лаунчер — отдельно стартовать активность из
 * BootReceiver нельзя, фоновый запуск активностей с Android 10 запрещён.
 *
 * Поверх этого включается lock task. Он ведёт себя по-разному, и оба поведения
 * рабочие:
 *   - прибор назначен device owner (`dpm set-device-owner`) — выйти нельзя
 *     совсем, системные кнопки не работают;
 *   - без device owner — обычное «закрепление экрана»: система покажет подсказку,
 *     и выйти можно долгим Назад+Обзор.
 * Поэтому сброс прибора не обязателен: без него киоск слабее, но работает.
 *
 * Служебный экран (адрес сервера, ключ, диагностика принтера) остаётся доступен
 * ДОЛГИМ нажатием на левый верхний угол — там у страницы только часы, живых
 * элементов нет, и случайно туда не попадёшь — и ПИНом поверх жеста. Жеста
 * одного мало: со служебного экрана останавливается печать, а угол рано или
 * поздно нащупают.
 */
class KioskActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var offline: View

    /** Куда смотрит терминал. Адрес тот же, что у службы печати. */
    private val startUrl: String
        get() = PosPrefs.apiBase(this).trimEnd('/') + "/pos/orders"

    private val host: String?
        get() = runCatching { Uri.parse(PosPrefs.apiBase(this)).host }.getOrNull()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Кухонный экран не должен гаснуть: разбудить его мокрыми руками в
        // перчатках — отдельная операция, а заказ ждать не будет.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyDeviceOwnerPolicy()
        setContentView(buildUi())
        loadTerminal()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        enterLockTask()
    }

    override fun onPause() {
        // Кука сессии живёт 30 дней, но только если успела лечь на диск. На
        // кухне прибор выключают из розетки, а не кнопкой — без flush вход
        // пришлось бы повторять после каждого отключения питания.
        CookieManager.getInstance().flush()
        super.onPause()
    }

    /**
     * Кнопка «домой» на уже запущенном киоске. Активность singleTask, поэтому
     * система не пересоздаёт её, а зовёт сюда — и терминал обязан вернуться на
     * ленту заказов. Иначе «домой» с экрана деталей не делала бы ничего.
     */
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        loadTerminal()
    }

    /** Назад листает историю терминала и НИКОГДА не закрывает киоск. */
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
    }

    // --- UI ------------------------------------------------------------------

    private fun buildUi(): ViewGroup {
        val root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }

        web = WebView(this).apply {
            setBackgroundColor(BACKGROUND)
            overScrollMode = View.OVER_SCROLL_NEVER
            // Выделение текста и его контекстное меню на кухне бесполезны, а
            // всплывающая «копировать» перекрывает кнопки.
            isLongClickable = false
            setOnLongClickListener { true }
            configure(this)
            webViewClient = TerminalClient()
        }
        root.addView(web, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        offline = buildOfflineView()
        offline.visibility = View.GONE
        root.addView(offline, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        root.addView(buildServiceCorner())
        return root
    }

    /**
     * Настройки WebView. Принимает сам view, а НЕ его settings: куки третьих
     * сторон отключаются для конкретного view, а поле `web` в этот момент ещё
     * не присвоено — вызов через него падал бы на старте активности.
     */
    private fun configure(view: WebView) {
        val settings: WebSettings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // Масштабирование запрещено: случайный щипок двумя пальцами уводит
        // вёрстку, а вернуть её обратно жирными руками трудно.
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        // Системный масштаб шрифта ломает раскладку под 360 dp: терминал
        // рассчитан на свои размеры и не должен зависеть от настроек прибора.
        settings.textZoom = 100
        settings.userAgentString = settings.userAgentString + " DumboPOS/kiosk"
        // Сигнал о новом заказе должен зазвучать сам. Браузер по умолчанию
        // запрещает звук до касания экрана — на кухне это означало бы, что
        // первый заказ смены придёт молча.
        settings.mediaPlaybackRequiresUserGesture = false

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    }

    private fun buildOfflineView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(BACKGROUND)
        setPadding(dp(24), dp(24), dp(24), dp(24))

        addView(TextView(this@KioskActivity).apply {
            text = "Keine Verbindung zum Server"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.CENTER
        })
        addView(TextView(this@KioskActivity).apply {
            text = "WLAN der Küche prüfen. Angenommene Bestellungen laufen weiter."
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(TEXT_MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(20))
        })
        addView(Button(this@KioskActivity).apply {
            text = "Erneut versuchen"
            setOnClickListener { loadTerminal() }
        })
    }

    /**
     * Невидимая площадка под служебный экран: 48×28 dp в левом верхнем углу.
     * Там у терминала только строка с часами — живых элементов нет, поэтому
     * перехват долгого нажатия ничего не ломает.
     */
    private fun buildServiceCorner(): View = View(this).apply {
        layoutParams = FrameLayout.LayoutParams(dp(48), dp(28), Gravity.TOP or Gravity.START)
        setOnLongClickListener {
            openService()
            true
        }
    }

    // --- Загрузка ------------------------------------------------------------

    private fun loadTerminal() {
        offline.visibility = View.GONE
        // Кэш чистим перед КАЖДОЙ явной загрузкой (старт киоска и кнопка
        // «повторить»). Оба случая редки, а цена ошибки высокая: после выката
        // прибор иначе показывает прошлую сборку — а однажды показал
        // закэшированную 404 и не вышел из неё сам.
        web.clearCache(true)
        web.loadUrl(startUrl)
    }

    private inner class TerminalClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url ?: return true
            // Телефон с карточки гостя: на приборе есть SIM, и звонок курьеру
            // или клиенту — обычное действие смены, а не уход из киоска.
            if (url.scheme == "tel") {
                runCatching { startActivity(Intent(Intent.ACTION_DIAL, url)) }
                    .onFailure { Log.w(TAG, "звонок недоступен: ${it.message}") }
                return true
            }
            // Всё, что не наш сервер, киоск не открывает: единственная внешняя
            // ссылка на приборе — это способ из него выйти.
            return url.host != host
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (!request.isForMainFrame) return
            Log.w(TAG, "загрузка не удалась: ${error.errorCode}")
            offline.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (url?.startsWith("data:") != true) offline.visibility = View.GONE
        }
    }

    // --- Киоск ---------------------------------------------------------------

    private fun enterLockTask() {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val already = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
        } else {
            @Suppress("DEPRECATION")
            manager.isInLockTaskMode
        }
        if (already) return
        runCatching { startLockTask() }
            .onFailure { Log.w(TAG, "lock task недоступен: ${it.message}") }
    }

    /**
     * Настройки, доступные только назначенному device owner.
     *
     * Вызываем каждый раз, а не однократно: прибор могут назначить владельцем
     * уже после установки, и тогда киоск обязан подтянуться сам, без переустановки.
     */
    private fun applyDeviceOwnerPolicy() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(packageName)) return
        val admin = ComponentName(this, PosAdminReceiver::class.java)

        // Звонилка в списке разрешённых: иначе в lock task кнопка «anrufen»
        // на карточке гостя молча ничего не сделает.
        val dialer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            (getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage
        } else null
        val allowed = listOfNotNull(packageName, dialer).toTypedArray()
        runCatching { dpm.setLockTaskPackages(admin, allowed) }
            .onFailure { Log.w(TAG, "setLockTaskPackages: ${it.message}") }

        // Домашним экраном назначаем себя навсегда: иначе после каждой
        // перезагрузки система спрашивает, каким лаунчером открыть, и прибор
        // ждёт ответа вместо показа заказов.
        val homeFilter = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        runCatching {
            dpm.addPersistentPreferredActivity(
                admin,
                homeFilter,
                ComponentName(this, KioskActivity::class.java)
            )
        }.onFailure { Log.w(TAG, "addPersistentPreferredActivity: ${it.message}") }
    }

    /** Служебный экран: жест открывает диалог PIN, а не сам экран. */
    private fun openService() {
        val pin = PosPrefs.servicePin(this)
        if (pin.isEmpty()) {
            // PIN ещё не задан — идёт первая настройка прибора, и запирать
            // единственную дверь до того, как от неё сделали ключ, нельзя.
            launchService()
            return
        }
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "PIN"
        }
        AlertDialog.Builder(this)
            .setTitle("Service")
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                if (input.text.toString() == pin) launchService()
                else Log.w(TAG, "неверный PIN служебного экрана")
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun launchService() {
        // Выходим из lock task: без этого служебный экран не откроется — система
        // не пустит вторую активность поверх закреплённой.
        runCatching { stopLockTask() }
        startActivity(Intent(this, MainActivity::class.java))
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(android.view.WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "PosKiosk"
        // Те же значения, что у терминала в app/pos/pos.css: пока грузится
        // страница, экран не должен мигать белым или чёрным.
        val BACKGROUND = Color.parseColor("#faf7f2")
        val TEXT_PRIMARY = Color.parseColor("#3d2f21")
        val TEXT_MUTED = Color.parseColor("#7c6145")
    }
}
