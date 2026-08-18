package de.dumbospizza.pos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Фоновая служба печати: опрашивает облако, печатает задания, отчитывается.
 *
 * Служба именно foreground: кухонный прибор стоит часами, а Android без
 * постоянного уведомления усыпит обычный фон, и заказы начнут печататься
 * пачками с опозданием.
 *
 * Гарантия «один заказ = один чек» держится на трёх уровнях, и это зеркало
 * схемы LAN-агента:
 *   1) сервер — атомарная выдача одним UPDATE с условием на статус;
 *   2) здесь — persistent-хранилище напечатанных ключей (переживает перезапуск);
 *   3) здесь — нереентрантный тик: следующий цикл стартует только после
 *      завершения предыдущего, никаких наложений по таймеру.
 */
class PrintService : Service() {

    companion object {
        private const val TAG = "PosPrint"
        private const val CHANNEL = "pos-print"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            val intent = Intent(context, PrintService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PrintService::class.java))
        }
    }

    private val running = AtomicBoolean(false)
    private var printer: SunmiPrinterService? = null
    private var pollMs = 3000L

    private val printerCallback = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService) {
            printer = service
            Log.i(TAG, "сервис печати привязан")
        }

        override fun onDisconnected() {
            printer = null
            Log.w(TAG, "сервис печати отвалился")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification("Запуск…"))
        try {
            InnerPrinterManager.getInstance().bindService(this, printerCallback)
        } catch (e: Exception) {
            Log.e(TAG, "привязка принтера не удалась: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running.compareAndSet(false, true)) {
            thread(name = "pos-poll", isDaemon = true) { loop() }
        }
        // START_STICKY: если система выгрузит службу под нехватку памяти,
        // она поднимется сама — кухня не должна замечать этого вообще.
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        try {
            InnerPrinterManager.getInstance().unBindService(this, printerCallback)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    private fun loop() {
        Log.i(TAG, "опрос ${PosPrefs.apiBase(this)} каждые $pollMs мс")
        while (running.get()) {
            try {
                tick()
            } catch (e: Exception) {
                // Сеть на кухне моргает, и это не повод падать: следующий тик
                // просто попробует снова.
                Log.w(TAG, "тик не удался: ${e.message}")
                notify("Нет связи с сервером")
            }
            Thread.sleep(pollMs)
        }
    }

    private fun tick() {
        val config = PosApi.fetchConfig(this)
        pollMs = config.pollMs.coerceIn(1000L, 60_000L)
        if (!config.enabled) {
            notify("Печать выключена в админке")
            return
        }

        val service = printer
        if (service == null) {
            notify("Принтер не подключён")
            return
        }

        val batch = PosApi.fetchOrders(this, PosPrefs.cursorMs(this))
        if (batch.jobs.isEmpty()) {
            // Курсор двигаем и на пустой выборке, иначе окно будет расти и
            // сервер начнёт каждый раз перебирать всё больше заказов.
            PosPrefs.setCursorMs(this, batch.serverTimeMs)
            notify("Готов, новых заказов нет")
            return
        }

        for (job in batch.jobs) {
            // Окна опроса перекрываются, и один заказ вполне может прийти дважды.
            // Второй чек кухне не нужен.
            if (PosPrefs.wasPrinted(this, job.key)) continue

            try {
                notify("Печать заказа " + job.orderNumber)
                repeat(job.copies.coerceIn(1, 3)) {
                    OpsPlayer.play(service, job.ops, job.render)
                }
                PosPrefs.markPrinted(this, job.key)
                Log.i(TAG, "напечатан " + job.orderNumber)
            } catch (e: Exception) {
                // Курсор НЕ двигаем дальше этого заказа: следующий тик попробует
                // снова. Молча потерять чек хуже, чем напечатать его с задержкой.
                Log.e(TAG, "печать " + job.orderNumber + " не удалась: " + e.message)
                notify("Ошибка печати " + job.orderNumber)
                return
            }
        }

        // Курсор сдвигается только после того, как ВСЯ пачка напечатана.
        PosPrefs.setCursorMs(this, batch.serverTimeMs)
    }

    private fun buildNotification(text: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL, "Печать заказов", NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Dumbo POS")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
