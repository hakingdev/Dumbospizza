package de.dumbospizza.pos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Поднимает службу печати после перезагрузки прибора и после обновления
 * приложения.
 *
 * Без этого после отключения питания на кухне печать молча не возобновится, и
 * заметят это только по отсутствию чеков — то есть в худший момент. Обновление
 * пакета убивает процесс точно так же: без MY_PACKAGE_REPLACED каждый апдейт
 * оставлял бы кухню без чеков до перезагрузки прибора.
 *
 * Служба стартует, только если её включали раньше: свежеустановленное и ещё не
 * настроенное приложение не должно ломиться в сеть после каждой перезагрузки.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        if (!PosPrefs.serviceEnabled(context) || !PosPrefs.isConfigured(context)) return
        PrintService.start(context)
    }
}
