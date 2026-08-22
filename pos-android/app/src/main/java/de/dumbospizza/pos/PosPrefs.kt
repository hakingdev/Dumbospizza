package de.dumbospizza.pos

import android.content.Context
import java.util.UUID

/**
 * Локальные настройки прибора и хранилище напечатанных ключей.
 *
 * Адрес сервера и секрет лежат здесь, а не в коде: во втором заходе их заменит
 * привязка по коду из админки, и менять придётся только этот файл.
 *
 * Хранилище напечатанного — persistent, и это принципиально. Оно переживает
 * перезапуск приложения и защищает от второго чека, когда подтверждение до
 * сервера не дошло и задание выдалось повторно.
 */
object PosPrefs {

    private const val FILE = "pos"
    private const val KEY_API = "apiBase"
    private const val KEY_SECRET = "secret"
    private const val KEY_DEVICE = "deviceId"
    private const val KEY_PRINTED = "printed"
    private const val KEY_RUNNING = "serviceEnabled"
    private const val KEY_CURSOR = "cursorMs"
    private const val KEY_PIN = "servicePin"
    private const val KEY_ALERT_URI = "alertSoundUri"
    private const val KEY_ALERT_NAME = "alertSoundName"
    private const val KEY_UI = "uiMode"

    /** ВАЖНО: www, не apex. dumbospizza.de отдаёт 308-редирект, а он способен
     *  продублировать печать при повторе запроса. Та же грабля описана в
     *  scripts/print-agent.js. */
    private const val DEFAULT_API = "https://www.dumbospizza.de"

    /** Сколько ключей держим. Заказов в день сотни, тысячи хватает с запасом. */
    private const val PRINTED_LIMIT = 1000

    private fun prefs(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun apiBase(c: Context): String = prefs(c).getString(KEY_API, DEFAULT_API) ?: DEFAULT_API
    fun setApiBase(c: Context, value: String) =
        prefs(c).edit().putString(KEY_API, value.trim()).apply()

    fun secret(c: Context): String = prefs(c).getString(KEY_SECRET, "") ?: ""
    fun setSecret(c: Context, value: String) =
        prefs(c).edit().putString(KEY_SECRET, value.trim()).apply()

    fun isConfigured(c: Context): Boolean = secret(c).isNotBlank()

    /**
     * PIN служебного экрана. Пусто — экран открывается без него: так проходит
     * первая настройка, когда PIN ещё некому задать.
     *
     * Проверяется НА ПРИБОРЕ, а не на сервере: выйти из киоска надо уметь и
     * тогда, когда Wi-Fi кухни лежит — а именно в этот момент туда и полезут.
     */
    fun servicePin(c: Context): String = prefs(c).getString(KEY_PIN, "") ?: ""

    fun setServicePin(c: Context, value: String) =
        prefs(c).edit().putString(KEY_PIN, value.trim()).apply()

    /**
     * Сигнал о новом заказе: URI выбранного системного звука. Пусто — повар
     * ничего не выбирал, и звучит штатный будильник прибора.
     *
     * Рядом с URI лежит ЕГО ИМЯ, и это не дублирование. Прочитать название по
     * content://-адресу можно только запросом в медиатеку: это диск, это
     * миллисекунды, и это отваливается, когда провайдер звуков занят или звук
     * успели удалить. Вкладка «Mehr» обязана нарисовать выбранное сразу и
     * всегда, поэтому имя сохраняем в момент выбора.
     */
    fun alertSoundUri(c: Context): String = prefs(c).getString(KEY_ALERT_URI, "") ?: ""

    fun alertSoundName(c: Context): String = prefs(c).getString(KEY_ALERT_NAME, "") ?: ""

    fun setAlertSound(c: Context, uri: String, name: String) =
        prefs(c).edit()
            .putString(KEY_ALERT_URI, uri.trim())
            .putString(KEY_ALERT_NAME, name.trim())
            .apply()

    /**
     * Каким интерфейсом рисовать терминал: true — нативные экраны (пакет ui/),
     * false — WebView на /pos. Переключается со служебного экрана.
     *
     * По умолчанию НАТИВНЫЙ: с 0.4.0 это основной режим терминала, WebView
     * остаётся резервом на случай отката без переустановки. Пока нативный
     * дозревал, умолчанием был WebView — прибор с тех времён мог сохранить
     * «web» явно, поэтому смена умолчания сама по себе никого не переключает.
     * Значение храним строкой — на случай третьего режима.
     */
    fun nativeUi(c: Context): Boolean = prefs(c).getString(KEY_UI, "native") == "native"

    fun setNativeUi(c: Context, value: Boolean) =
        prefs(c).edit().putString(KEY_UI, if (value) "native" else "web").apply()

    fun serviceEnabled(c: Context): Boolean = prefs(c).getBoolean(KEY_RUNNING, false)
    fun setServiceEnabled(c: Context, value: Boolean) =
        prefs(c).edit().putBoolean(KEY_RUNNING, value).apply()


    /**
     * Курсор выборки: время сервера, до которого заказы уже просмотрены.
     *
     * Ставится в «сейчас» при настройке прибора — иначе первое же подключение
     * напечатало бы всю историю заказов за последние часы.
     */
    fun cursorMs(c: Context): Long = prefs(c).getLong(KEY_CURSOR, 0L)

    fun setCursorMs(c: Context, value: Long) =
        prefs(c).edit().putLong(KEY_CURSOR, value).apply()
    /** Идентификатор прибора: генерируется один раз и живёт до переустановки. */
    fun deviceId(c: Context): String {
        val p = prefs(c)
        p.getString(KEY_DEVICE, null)?.let { return it }
        val generated = "sunmi-" + UUID.randomUUID().toString().take(8)
        p.edit().putString(KEY_DEVICE, generated).apply()
        return generated
    }

    fun wasPrinted(c: Context, key: String): Boolean =
        prefs(c).getStringSet(KEY_PRINTED, emptySet())?.contains(key) == true

    fun markPrinted(c: Context, key: String) {
        val p = prefs(c)
        val current = p.getStringSet(KEY_PRINTED, emptySet())?.toMutableSet() ?: mutableSetOf()
        current.add(key)
        // SharedPreferences читается в память целиком, поэтому набор не должен
        // расти бесконечно. Обрезаем грубо: точный порядок здесь не важен —
        // старые заказы повторно не выдаются, их защищает статус на сервере.
        val trimmed = if (current.size > PRINTED_LIMIT) {
            current.toList().takeLast(PRINTED_LIMIT).toMutableSet()
        } else current
        p.edit().putStringSet(KEY_PRINTED, trimmed).apply()
    }
}
