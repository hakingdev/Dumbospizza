package de.dumbospizza.pos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Поднимает службу печати после перезагрузки прибора.
 *
 * Без этого после отключения питания на кухне печать молча не возобновится, и
 * заметят это только по отсутствию чеков — то есть в худший момент.
 *
 * Служба стартует, только если её включали раньше: свежеустановленное и ещё не
 * настроенное приложение не должно ломиться в сеть после каждой перезагрузки.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!PosPrefs.serviceEnabled(context) || !PosPrefs.isConfigured(context)) return
        PrintService.start(context)
    }
}
