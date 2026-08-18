import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Постоянный ключ подписи прибора.
 *
 * Пока его не было, сборка подписывалась временным отладочным ключом Android —
 * тем, что Gradle заводит сам и так же сам пересоздаёт. Один раз это уже стоило
 * дорого: ключ сменился, и обновить приложение на приборе стало невозможно —
 * Android не принимает сборку с другой подписью, а снять владельца устройства
 * без сброса до заводских нельзя.
 *
 * Файл ключа и пароли лежат вне git (репозиторий публичный): пути и пароли
 * читаются из pos-android/keystore.properties. Нет файла — собираем как раньше,
 * отладочным ключом: чужая машина и CI должны уметь собрать проект без секретов,
 * просто такой сборкой прибор не обновить.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasSigningKey = keystoreProperties.containsKey("storeFile") &&
    rootProject.file(keystoreProperties.getProperty("storeFile")).exists()

android {
    namespace = "de.dumbospizza.pos"
    compileSdk = 34

    defaultConfig {
        applicationId = "de.dumbospizza.pos"
        minSdk = 24
        // Прибор на кухне — Android 11 (API 30). Держим targetSdk на нём:
        // приложение раздаётся сайдлоадом, требований Play Store нет, а поднимать
        // target выше железа значит без нужды ловить ограничения новых API.
        targetSdk = 30
        versionCode = 2
        versionName = "0.2.0-wlan"
    }

    signingConfigs {
        if (hasSigningKey) {
            create("kiosk") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasSigningKey) signingConfig = signingConfigs.getByName("kiosk")
        }
        debug {
            // Тем же ключом, что и релиз. Прибор обновляют сайдлоадом, и разные
            // подписи у debug и release означали бы, что переход между ними
            // требует удаления приложения — то есть потери настроек и владельца
            // устройства. Именно это однажды и случилось.
            if (hasSigningKey) signingConfig = signingConfigs.getByName("kiosk")

            // Суффикса пакета у отладочной сборки НЕТ намеренно. Приложение
            // раздаётся сайдлоадом в одном экземпляре, а владельца устройства
            // (dpm set-device-owner) назначают КОНКРЕТНОМУ пакету: с суффиксом
            // киоск оказался бы привязан к `…pos.debug`, и переход на релизную
            // сборку означал бы снятие владельца и настройку прибора заново.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Официальный AAR Sunmi с Maven Central. Берём именно его, а не самописный
    // IWoyouService.aidl: коды транзакций AIDL назначаются по порядку объявления
    // методов, поэтому файл, восстановленный по памяти, скомпилируется и молча
    // будет звать не те методы.
    implementation("com.sunmi:printerlibrary:1.0.24")
}
