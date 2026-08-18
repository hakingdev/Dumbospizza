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
import android.graphics.drawable.ColorDrawable
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
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
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import org.json.JSONObject

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
        // Фон ОКНА, а не только вёрстки: пока системные панели уезжают, на их
        // месте видно именно его, и по умолчанию он чёрный — на кухне это
        // выглядело как полосы сверху и снизу.
        window.setBackgroundDrawable(ColorDrawable(BACKGROUND))
        applyDeviceOwnerPolicy()
        setContentView(buildUi())
        watchSystemBars()
        loadTerminal()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        enterLockTask()
    }

    /**
     * Возврат фокуса — снова прячем панели. Свайп сверху показывает их временно,
     * но если в этот момент что-то перехватило фокус (диалог, звонок), система
     * оставляет их висеть, и терминал остаётся с полосами.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
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
            // Мост в приложение. Страница не может ни открыть системные
            // настройки, ни проиграть системный звук — только нативный код.
            // Интерфейс держим коротким: всё, что здесь появится, станет
            // доступно любой открытой в киоске странице.
            addJavascriptInterface(TerminalBridge(), "DumboPos")
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
        // Документ запрашиваем с обязательной перепроверкой на сервере.
        //
        // Раньше здесь стоял clearCache(), и он не работал: метод асинхронный,
        // загрузка стартовала раньше очистки, и прибор снова показывал ту же
        // закэшированную страницу — в нашем случае 404, снятую ДО выката, из
        // которой киоск не выходил сам.
        //
        // Заголовок действует только на сам документ. Ассеты Next именованы по
        // содержимому, поэтому свежая страница подтянет свежие — чистить весь
        // кэш и заново качать всё по кухонному Wi-Fi незачем.
        web.loadUrl(startUrl, mapOf("Cache-Control" to "no-cache"))
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

    /**
     * То, что терминалу нужно от прибора: сети и сигнал о новом заказе.
     *
     * Wi-Fi: запертый киоск иначе не переподключить к другой сети, а кухня
     * переезжает вместе с роутером. Кнопка живёт во вкладке «Mehr», рядом с
     * остальными настройками прибора, — на скрытый служебный экран за ней
     * никто не полезет.
     *
     * Звук: страница умеет только свой синтезированный писк, он короткий и на
     * кухне тонет в вытяжке. Системные звуки лежат по content://-адресам, до
     * которых WebView не дотянется, — проиграть их может лишь нативный код.
     *
     * ВСЕ методы приходят с потока JavaBridge, а не с главного. Всё, что трогает
     * активность (запуск чужого экрана, старт звука), уводим в runOnUiThread;
     * чтение медиатеки, наоборот, оставляем здесь — на главном потоке это диск.
     */
    private inner class TerminalBridge {
        @JavascriptInterface
        fun openWifiSettings() {
            runOnUiThread { openWifi() }
        }

        /**
         * Открыть штатный выбор звука Android. Результат придёт асинхронно в
         * onActivityResult, поэтому метод ничего не возвращает: страница узнает
         * о новом выборе из события `dumbo-alert-sound`.
         */
        @JavascriptInterface
        fun pickAlertSound() {
            runOnUiThread { openAlertSoundPicker() }
        }

        /**
         * Проиграть сигнал. Возвращает false, если на приборе не нашлось ни
         * одного пригодного звука — тогда странице честнее пискнуть самой, чем
         * промолчать: непринятый заказ дороже некрасивого звука.
         */
        @JavascriptInterface
        fun playAlert(): Boolean {
            val ringtone = prepareAlert() ?: return false
            runOnUiThread {
                runCatching {
                    // Сигнал повторяется каждые 10 секунд, а рингтон бывает
                    // длиннее. Без stop() второй запуск накладывается на первый
                    // и превращается в кашу.
                    if (ringtone.isPlaying) ringtone.stop()
                    ringtone.play()
                }.onFailure { Log.w(TAG, "сигнал не проигрался: ${it.message}") }
            }
            return true
        }

        /**
         * Оборвать сигнал. Нужен в момент приёма заказа: рингтон длиной в
         * полминуты иначе продолжает звенеть над уже принятым заказом.
         */
        @JavascriptInterface
        fun stopAlert() {
            runOnUiThread { runCatching { alert?.stop() } }
        }

        /** Имя того звука, который реально прозвучит. Пусто — звучать нечему. */
        @JavascriptInterface
        fun alertSoundName(): String = currentAlertName()
    }

    /**
     * Сети. Сначала панель подключений — она показывает только список сетей и не
     * даёт уйти вглубь настроек прибора. Полный экран Wi-Fi остаётся запасным.
     */
    private fun openWifi() {
        val opened = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { startActivity(Intent(Settings.Panel.ACTION_WIFI)) }.isSuccess
        } else false
        if (!opened) {
            runCatching { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) }
                .onFailure { Log.w(TAG, "настройки Wi-Fi недоступны: ${it.message}") }
        }
    }

    // --- Сигнал о новом заказе -----------------------------------------------

    /**
     * Готовый к проигрыванию звук и ключ, под который он собран (это сам
     * сохранённый URI). Держим один экземпляр на весь сеанс по двум причинам:
     * сборка Ringtone лезет в медиатеку, а повторить сигнал надо каждые 10
     * секунд; и остановить прошлый звук можно только имея его в руках.
     *
     * Замок нужен потому, что готовит звук поток JavaBridge, а играет и
     * останавливает — главный.
     */
    private var alert: Ringtone? = null
    private var alertKey: String? = null
    private val alertLock = Any()

    /**
     * Открыть штатный выбор звука Android.
     *
     * Тип — будильник И рингтон, без уведомлений. Уведомления на Android
     * специально сделаны короткими, а мы чиним ровно это: писк в полсекунды на
     * кухне не слышно за вытяжкой и тестом. Будильники и рингтоны длинные и
     * громкие — из них есть что выбрать.
     *
     * «Без звука» в списке НЕ показываем. Терминал — единственный способ узнать
     * о заказе; беззвучный терминал выглядит как исправный ровно до конца смены,
     * когда обнаруживается пачка непринятых заказов. Захотят тише — есть
     * качелька громкости, и она хотя бы видна.
     *
     * «По умолчанию» тоже убрано: у нас своё «по умолчанию» — пустая настройка,
     * и два одинаковых по смыслу пункта в списке (наш и системный) отличались
     * бы только тем, какое имя потом покажет вкладка «Mehr».
     */
    private fun openAlertSoundPicker() {
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
            putExtra(
                RingtoneManager.EXTRA_RINGTONE_TYPE,
                RingtoneManager.TYPE_ALARM or RingtoneManager.TYPE_RINGTONE
            )
            putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Signalton für neue Bestellungen")
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false)
            // Текущий выбор — чтобы список открылся на нём, а не сверху.
            savedAlertUri()?.let { putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, it) }
        }
        runCatching { startActivityForResult(intent, REQ_ALERT_SOUND) }
            .onFailure { Log.w(TAG, "выбор звука недоступен: ${it.message}") }
    }

    /**
     * Ответ пикера. Имя звука читаем и сохраняем прямо здесь: потом медиатека
     * может быть занята или звук удалён, а показывать во вкладке «Mehr»
     * content://-адрес вместо названия — незачем.
     */
    @Suppress("DEPRECATION") // getParcelableExtra(String) — на targetSdk 30 замены нет
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_ALERT_SOUND || resultCode != RESULT_OK) return

        // null приходит, если звук всё же выключили (у некоторых прошивок пункт
        // «без звука» несмотря на SHOW_SILENT=false). Трактуем как «по
        // умолчанию»: молчащий терминал нам не нужен ни при каких настройках.
        val picked: Uri? = data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        val title = picked?.let { uri ->
            runCatching { RingtoneManager.getRingtone(this, uri)?.getTitle(this) }.getOrNull()
        }.orEmpty()
        PosPrefs.setAlertSound(this, picked?.toString().orEmpty(), title)

        // Страница про выбор сама не узнает: пока был открыт пикер, она стояла
        // на паузе и никаких событий не получала.
        notifyAlertSound(currentAlertName())
    }

    /** Что показать во вкладке «Mehr». Пусто — играть нечего, звука на приборе нет. */
    private fun currentAlertName(): String {
        val saved = PosPrefs.alertSoundName(this)
        if (saved.isNotEmpty()) return saved
        val ringtone = prepareAlert() ?: return ""
        return runCatching { ringtone.getTitle(this) }.getOrNull().orEmpty()
    }

    private fun notifyAlertSound(name: String) {
        val detail = JSONObject().put("name", name).toString()
        runCatching {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('dumbo-alert-sound',{detail:$detail}))",
                null
            )
        }
    }

    private fun savedAlertUri(): Uri? = PosPrefs.alertSoundUri(this)
        .takeIf { it.isNotEmpty() }
        ?.let { runCatching { Uri.parse(it) }.getOrNull() }

    /**
     * Собрать звук под текущий выбор.
     *
     * Поток — БУДИЛЬНИК (USAGE_ALARM), а не уведомление. Это не вкусовщина:
     * на приборе беззвучный режим глушит STREAM_NOTIFICATION и не трогает
     * STREAM_ALARM, а громкость будильника не опускается ниже 1 из 15. То есть
     * уведомление можно случайно свести в ноль и не заметить — терминал будет
     * выглядеть исправным и молчать всю смену, — а будильник нет.
     */
    private fun prepareAlert(): Ringtone? {
        synchronized(alertLock) {
            val key = PosPrefs.alertSoundUri(this)
            alert?.let { if (alertKey == key) return it }
            var built: Ringtone? = null
            for (uri in alertCandidates(key)) {
                built = runCatching { RingtoneManager.getRingtone(this, uri) }.getOrNull()
                if (built != null) break
            }
            if (built == null) {
                Log.w(TAG, "на приборе нет ни одного пригодного звука")
                return null
            }
            built.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            alert = built
            alertKey = key
            return built
        }
    }

    /**
     * Что пробуем проиграть, по порядку. Запасные варианты обязательны: звук
     * могли выбрать с флешки и вынуть её, а «по умолчанию» на конкретной
     * прошивке может оказаться не задано.
     */
    private fun alertCandidates(chosen: String): List<Uri> {
        val list = mutableListOf<Uri>()
        if (chosen.isNotEmpty()) runCatching { Uri.parse(chosen) }.getOrNull()?.let { list.add(it) }
        for (type in intArrayOf(
            RingtoneManager.TYPE_ALARM,
            RingtoneManager.TYPE_RINGTONE,
            RingtoneManager.TYPE_NOTIFICATION,
        )) {
            runCatching { RingtoneManager.getActualDefaultRingtoneUri(this, type) }
                .getOrNull()
                ?.let { list.add(it) }
        }
        return list.distinct()
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
        // Настройки в белом списке ради Wi-Fi: запертый прибор иначе невозможно
        // переподключить к другой сети, а кухня переезжает вместе с роутером.
        // Открыть их можно только со служебного экрана, то есть из-под PIN.
        //
        // Имя пакета берём и резолвом, и константой. Резолва одного мало:
        // Android 11 фильтрует видимость чужих пакетов, и на приборе он вернул
        // null — настройки в список не попали и панель Wi-Fi молча не открывалась.
        val settingsPackage = packageManager
            .resolveActivity(Intent(Settings.ACTION_WIFI_SETTINGS), 0)
            ?.activityInfo
            ?.packageName

        // Выбор звука сигнала. Разрешённых настроек тут НЕ хватает: на приборе
        // ACTION_RINGTONE_PICKER резолвится в com.android.soundpicker (проверено,
        // /system/priv-app/SoundPicker), а не в com.android.settings — в Android 11
        // пикер вынесли из MediaProvider в отдельное приложение. У его активности
        // lockTaskLaunchMode=DEFAULT, то есть без белого списка в lock task она не
        // стартует, и молча: повар увидит «кнопка не работает». Резолв на всякий
        // случай дополняем константами — прошивки пикер двигают.
        val pickerPackage = packageManager
            .resolveActivity(Intent(RingtoneManager.ACTION_RINGTONE_PICKER), 0)
            ?.activityInfo
            ?.packageName
        val allowed = listOfNotNull(
            packageName,
            dialer,
            settingsPackage,
            SETTINGS_PACKAGE,
            pickerPackage,
            SOUND_PICKER_PACKAGE,
            MEDIA_PACKAGE,
        ).distinct().toTypedArray()
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

    /**
     * Панели, вызванные свайпом, обязаны уйти сами.
     *
     * Android скрывает их по своему таймеру не всегда: после свайпа они могут
     * остаться до следующего касания. На кухне руки заняты, поэтому прячем их
     * сами — с задержкой, чтобы человек успел прочитать заряд и часы, ради
     * которых свайпал.
     */
    /** Заметить, что панели показались, и завести таймер на их скрытие. */
    private fun watchSystemBars() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        window.decorView.setOnApplyWindowInsetsListener { view, insets ->
            if (insets.isVisible(android.view.WindowInsets.Type.systemBars())) scheduleHideBars()
            view.onApplyWindowInsets(insets)
        }
    }

    private fun scheduleHideBars() {
        hideHandler.removeCallbacksAndMessages(null)
        hideHandler.postDelayed({ hideSystemBars() }, BARS_VISIBLE_MS)
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

    private val hideHandler = Handler(Looper.getMainLooper())

    private companion object {
        const val TAG = "PosKiosk"
        /** Штатные настройки Android. Резолв их не всегда видит — см. applyDeviceOwnerPolicy. */
        const val SETTINGS_PACKAGE = "com.android.settings"
        /** Выбор звука с Android 11 живёт здесь. */
        const val SOUND_PICKER_PACKAGE = "com.android.soundpicker"
        /** До Android 11 выбор звука жил в MediaProvider. */
        const val MEDIA_PACKAGE = "com.android.providers.media"
        /** Код ответа пикера звука. */
        const val REQ_ALERT_SOUND = 4201
        /** Сколько держать панели после свайпа, прежде чем спрятать самим. */
        const val BARS_VISIBLE_MS = 4000L
        // Те же значения, что у терминала в app/pos/pos.css: пока грузится
        // страница, экран не должен мигать белым или чёрным.
        val BACKGROUND = Color.parseColor("#faf7f2")
        val TEXT_PRIMARY = Color.parseColor("#3d2f21")
        val TEXT_MUTED = Color.parseColor("#7c6145")
    }
}
