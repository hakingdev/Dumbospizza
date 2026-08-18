plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

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
        versionCode = 1
        versionName = "0.1.0-probe"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        debug {
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
