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
        versionCode = 3
        versionName = "0.3.0-native"
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

    buildFeatures {
        compose = true
    }

    composeOptions {
        // Версия компилятора привязана к Kotlin: 1.5.15 — пара к Kotlin 1.9.25
        // из корневого build.gradle.kts. Обновлять только вместе.
        kotlinCompilerExtensionVersion = "1.5.15"
    }
}

dependencies {
    // Официальный AAR Sunmi с Maven Central. Берём именно его, а не самописный
    // IWoyouService.aidl: коды транзакций AIDL назначаются по порядку объявления
    // методов, поэтому файл, восстановленный по памяти, скомпилируется и молча
    // будет звать не те методы.
    implementation("com.sunmi:printerlibrary:1.0.24")

    // Нативный терминал (пакет ui/). Служба печати по-прежнему живёт без
    // зависимостей — Compose нужен только интерфейсу, и его отказ не может
    // отобрать у кухни чеки. BOM держит версии androidx согласованными;
    // 2024.06 — последняя линейка, проверенная с Kotlin 1.9.2x.
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Только ради PATCH /api/pos/v1/menu: HttpURLConnection проверяет метод по
    // белому списку времён HTTP/1.0 и PATCH не пропускает вовсе. Печать
    // остаётся на платформенном стеке — OkHttp нужен интерфейсу.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
