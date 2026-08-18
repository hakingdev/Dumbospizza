pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Sunmi публикует printerlibrary/printerx именно сюда (проверено:
        // repo1.maven.org/maven2/com/sunmi/printerlibrary). Отдельный репозиторий
        // Sunmi (maven.sunmi.com) не существует — его DNS не резолвится.
        mavenCentral()
    }
}

rootProject.name = "DumboPos"
include(":app")
