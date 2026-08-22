package de.dumbospizza.pos.ui

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.dumbospizza.pos.PosApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Данные раздела «Speisekarte»: категории, позиции открытой категории и стопы
 * кухни для плашки. Опрос реже ленты заказов — меню меняется редко
 * (MENU_POLL_MS веба), но каждое действие тут же перечитывает всё заново:
 * правду о доступности знает только сервер.
 */
class MenuLoader(private val context: Context) {

    var categories: PosLoad<List<MenuCategory>> by mutableStateOf(PosLoad.Loading)
        private set

    /** Активные стопы кухни. Ошибку не показываем — плашка просто прячется. */
    var kitchen: List<KitchenScope> by mutableStateOf(emptyList())
        private set

    /** Позиции открытой категории. Loading — категория ещё не открывалась. */
    var items: PosLoad<CategoryItems> by mutableStateOf(PosLoad.Loading)
        private set

    private var itemsCategoryId: String? = null

    /** Идёт запись на сервер: тумблеры на это время отключаются. */
    var busy: Boolean by mutableStateOf(false)
        private set

    suspend fun pollCategories(): Nothing {
        while (true) {
            refreshCategories()
            delay(POLL_MS)
        }
    }

    suspend fun refreshCategories() {
        val next = fetchPos(context, "/api/pos/v1/menu", ::parseMenuCategories)
        // Ошибка не стирает прошлый удачный список — как и у ленты заказов.
        if (next !is PosLoad.Error || categories !is PosLoad.Ready) categories = next
        kitchen = fetchPos(context, "/api/pos/v1/kitchen", ::parseKitchenScopes)
            .readyOrNull() ?: kitchen
    }

    /** Опрос позиций категории. Смена категории сбрасывает экран в загрузку. */
    suspend fun pollItems(categoryId: String): Nothing {
        if (itemsCategoryId != categoryId) {
            itemsCategoryId = categoryId
            items = PosLoad.Loading
        }
        while (true) {
            refreshItems()
            delay(POLL_MS)
        }
    }

    suspend fun refreshItems() {
        val id = itemsCategoryId ?: return
        val next = fetchPos(
            context,
            "/api/pos/v1/menu?category=" + Uri.encode(id),
            ::parseCategoryItems,
        )
        if (next !is PosLoad.Error || items !is PosLoad.Ready) items = next
    }

    /**
     * Включить или погасить позицию либо один её размер и перечитать экран.
     * Оптимизма нет намеренно, как и в вебе: переключатель, показавший «выключено»
     * до ответа сервера, соврал бы кухне при первой же сетевой ошибке.
     */
    suspend fun apply(
        productId: String,
        available: Boolean? = null,
        sizeId: String? = null,
        active: Boolean? = null,
    ) {
        if (busy) return
        busy = true
        patchAvailability(productId, available, sizeId, active)
        refreshItems()
        refreshCategories()
        busy = false
    }

    /**
     * Вся категория одним переключателем. Позиции переключаются по одной:
     * массового маршрута нет намеренно, полтора десятка запросов на редкое
     * действие дешевле лишнего эндпойнта (menu/[category]/page.tsx).
     */
    suspend fun applyWholeCategory(all: List<MenuItem>, next: Boolean) {
        if (busy) return
        busy = true
        coroutineScope {
            all.map { item ->
                async { patchAvailability(item.id, available = next) }
            }.awaitAll()
        }
        refreshItems()
        refreshCategories()
        busy = false
    }

    private suspend fun patchAvailability(
        productId: String,
        available: Boolean? = null,
        sizeId: String? = null,
        active: Boolean? = null,
    ) {
        val body = JSONObject().put("productId", productId)
        available?.let { body.put("available", it) }
        sizeId?.let { body.put("sizeId", it) }
        active?.let { body.put("active", it) }
        withContext(Dispatchers.IO) {
            // Ответ не разбираем: правду покажет перечитка списка следом.
            runCatching { PosApi.patch(context, "/api/pos/v1/menu", body) }
        }
    }

    companion object {
        /** Меню меняется редко — опрашиваем реже ленты заказов (MENU_POLL_MS). */
        const val POLL_MS = 30_000L
    }
}
