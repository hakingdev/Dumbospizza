package de.dumbospizza.pos

import android.app.admin.DeviceAdminReceiver

/**
 * Точка входа для назначения прибора «владельцем устройства».
 *
 * Пустой намеренно: политики нам не нужны, нужен сам факт наличия
 * DeviceAdminReceiver — без него команда
 *
 *     adb shell dpm set-device-owner de.dumbospizza.pos/.PosAdminReceiver
 *
 * не выполнится, а без device owner киоск работает только как «закрепление
 * экрана», из которого можно выйти долгим Назад+Обзор.
 *
 * Права владельца выдаются НЕ здесь, а той самой командой, и только на приборе
 * без заведённых аккаунтов. Что мы с ними делаем — в KioskActivity:
 * разрешаем lock task себе и звонилке и закрепляем себя домашним экраном.
 */
class PosAdminReceiver : DeviceAdminReceiver()
