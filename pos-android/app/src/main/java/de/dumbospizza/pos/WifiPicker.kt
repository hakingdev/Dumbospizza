package de.dumbospizza.pos

import android.Manifest
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log

/**
 * Подключение к Wi-Fi ИЗНУТРИ киоска.
 *
 * Зачем свой выбор сети, когда в Android есть штатный. Прибор назначен device
 * owner и заперт в lock task: системные настройки открываются только со
 * служебного экрана, то есть из-под PIN. Получается замкнутый круг — сеть
 * пропала, терминал показывает экран отказа, а чтобы выбрать другую сеть, надо
 * знать PIN и уметь ходить по служебному экрану. На кухне в этот момент стоит
 * повар, а не тот, кто настраивал прибор.
 *
 * Поэтому список сетей и ввод пароля живут в самом киоске: никакого выхода
 * наружу, никакого PIN, lock task не прерывается.
 *
 * Устаревшие WifiConfiguration/addNetwork/setWifiEnabled здесь ЗАКОННЫ. С
 * Android 10 их закрыли обычным приложениям, но владельцу устройства оставили —
 * ровно для таких киосков. Замены для нашего случая нет: WifiNetworkSuggestion
 * лишь предлагает сеть системе и подключается когда-нибудь сам, а нам нужно
 * подключиться сейчас и сказать повару, получилось или нет.
 *
 * Ограничение честно назовём: WPA3/SAE этим путём не настроить. Кухонные
 * роутеры — WPA2, и когда попадётся WPA3, останется системная панель.
 */
object WifiPicker {

    private const val TAG = "DumboPos"

    /** Код запроса разрешения. Нужен только на приборе без владельца устройства. */
    private const val REQ_LOCATION = 4711

    /** Одна строка списка. Точки с одинаковым именем схлопнуты в сильнейшую. */
    data class Network(val ssid: String, val secured: Boolean, val level: Int)

    private fun wifi(context: Context): WifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    /**
     * Привести прибор в состояние, в котором сети вообще видно.
     *
     * Возвращает null, когда всё готово, иначе — причину словами для экрана.
     *
     * Три условия, и все три чинятся правами владельца устройства:
     *   1. модуль Wi-Fi включён;
     *   2. выдано разрешение на точное местоположение — без него Android с 10-й
     *      версии отдаёт ПУСТОЙ список сетей и не объясняет почему;
     *   3. включена сама геолокация — то же самое, но уже на уровне прибора.
     *
     * Владелец выдаёт разрешение себе сам, без диалога: спрашивать повара
     * «разрешить доступ к местоположению?» посреди смены — гарантированное «нет»
     * и неработающий выбор сети.
     */
    fun ensureReady(activity: Activity): String? {
        val manager = wifi(activity)
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val owner = dpm.isDeviceOwnerApp(activity.packageName)
        val admin = ComponentName(activity, PosAdminReceiver::class.java)

        if (!manager.isWifiEnabled) {
            @Suppress("DEPRECATION") // владельцу устройства метод оставлен
            val turnedOn = runCatching { manager.setWifiEnabled(true) }.getOrDefault(false)
            if (!turnedOn) return "WLAN ist aus und lässt sich nicht einschalten"
        }

        val granted = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            if (!owner) {
                // Прибор без владельца устройства (например, после переустановки
                // без сброса). Права себе не выдать — спрашиваем обычным
                // диалогом; список сетей появится со второго захода.
                runCatching {
                    activity.requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION),
                        REQ_LOCATION
                    )
                }
                return "Standortberechtigung nötig — danach erneut versuchen"
            }
            runCatching {
                dpm.setPermissionGrantState(
                    admin,
                    activity.packageName,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
                )
            }.onFailure { Log.w(TAG, "разрешение на местоположение не выдалось: ${it.message}") }
        }

        // Геолокация прибора. API появился в Android 11 — это ровно наш прибор,
        // на более старых остаётся системная панель.
        if (owner && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching { dpm.setLocationEnabled(admin, true) }
                .onFailure { Log.w(TAG, "геолокация не включилась: ${it.message}") }
        }
        return null
    }

    /**
     * Что видно в эфире. Пустой список — не ошибка: сканирование асинхронно, и
     * первый заход часто приходит до результатов.
     */
    fun scan(context: Context): List<Network> {
        val manager = wifi(context)
        @Suppress("DEPRECATION") // throttling нам не мешает: жмём кнопку руками
        runCatching { manager.startScan() }
        val results = runCatching { manager.scanResults }.getOrNull().orEmpty()
        return results
            .filter { it.SSID.isNotBlank() }
            .groupBy { it.SSID }
            .map { (ssid, points) ->
                Network(
                    ssid = ssid,
                    secured = points.any { point ->
                        val caps = point.capabilities.orEmpty()
                        caps.contains("WPA") || caps.contains("WEP") || caps.contains("SAE")
                    },
                    level = points.maxOf { it.level }
                )
            }
            .sortedByDescending { it.level }
    }

    /** Уже настроенная на приборе сеть с таким именем, иначе -1. */
    private fun existingNetworkId(manager: WifiManager, ssid: String): Int {
        @Suppress("DEPRECATION") // владельцу устройства список отдают целиком
        val configured = runCatching { manager.configuredNetworks }.getOrNull().orEmpty()
        return configured.firstOrNull { it.SSID == quoted(ssid) }?.networkId ?: -1
    }

    private fun quoted(value: String) = "\"" + value + "\""

    /**
     * Подключиться. true — прибор ПРИНЯЛ сеть и начал подключение; удалось ли
     * оно на самом деле, покажет наблюдатель за сетью в киоске: терминал сам
     * перезагрузится, когда интернет окажется проверенным.
     *
     * Разделение намеренное. enableNetwork возвращает управление мгновенно, а
     * ассоциация с точкой, DHCP и проверка интернета занимают секунды — обещать
     * по возврату метода «сеть работает» значило бы врать в половине случаев.
     */
    fun connect(context: Context, ssid: String, password: String): Boolean {
        val manager = wifi(context)

        @Suppress("DEPRECATION") // владельцу устройства класс оставлен
        val config = WifiConfiguration().apply {
            SSID = quoted(ssid)
            if (password.isEmpty()) {
                allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
            } else {
                preSharedKey = quoted(password)
            }
        }

        @Suppress("DEPRECATION")
        var id = runCatching { manager.addNetwork(config) }.getOrDefault(-1)
        if (id == -1) {
            // Сеть уже заведена (например, пароль сменили): переиспользуем её
            // запись, иначе прибор молча откажет и повторить будет нечем.
            id = existingNetworkId(manager, ssid)
            if (id != -1 && password.isNotEmpty()) {
                config.networkId = id
                @Suppress("DEPRECATION")
                runCatching { manager.updateNetwork(config) }
            }
        }
        if (id == -1) {
            Log.w(TAG, "сеть не добавилась: $ssid")
            return false
        }

        @Suppress("DEPRECATION") // тот же список исключений для владельца
        val enabled = runCatching {
            manager.enableNetwork(id, true) && manager.reconnect()
        }.getOrDefault(false)
        if (!enabled) Log.w(TAG, "подключение не стартовало: $ssid")
        return enabled
    }
}
