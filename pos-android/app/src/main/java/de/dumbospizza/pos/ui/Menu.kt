package de.dumbospizza.pos.ui

import org.json.JSONArray
import org.json.JSONObject

/**
 * Модель меню и стоп-листа — порт lib/pos/menu.ts.
 *
 * Смысл экрана: погасить позицию прямо на приборе, когда что-то кончилось.
 * Гасится то же поле `available` (и `sizes[].active`), которым управляет
 * админка, — своего стоп-листа у кухни нет, иначе он разошёлся бы с витриной.
 */

/** Категория в списке: сколько позиций и сколько из них погашено. */
data class MenuCategory(
    val id: String,
    val name: String,
    val itemCount: Int,
    val stoppedCount: Int,
)

data class MenuSize(
    val id: String,
    val name: String,
    val price: String,
    val active: Boolean,
)

data class MenuItem(
    val id: String,
    val name: String,
    /** Размеры и цены одной строкой — на 360 dp таблица не помещается. */
    val sub: String,
    val available: Boolean,
    val sizes: List<MenuSize>,
)

/** Ответ `?category=`: имя для шапки и позиции. */
data class CategoryItems(
    val categoryId: String,
    val name: String,
    val items: List<MenuItem>,
)

/** Активный стоп из `/api/pos/v1/kitchen` — плашка над списком категорий. */
data class KitchenScope(val scope: String, val minutesLeft: Int)

/** Позиция стоп-листа: погашенный товар и категория, в которой он живёт. */
data class StopListEntry(
    val categoryId: String,
    val categoryName: String,
    val item: MenuItem,
)

// --- Разбор ответов сервера ---------------------------------------------------

fun parseMenuCategories(root: JSONObject): List<MenuCategory> {
    val arr = root.optJSONArray("categories") ?: JSONArray()
    return (0 until arr.length()).map { i ->
        val c = arr.getJSONObject(i)
        MenuCategory(
            id = c.optString("id"),
            name = c.optString("name"),
            itemCount = c.optInt("itemCount"),
            stoppedCount = c.optInt("stoppedCount"),
        )
    }
}

fun parseCategoryItems(root: JSONObject): CategoryItems {
    val category = root.optJSONObject("category")
    val arr = root.optJSONArray("items") ?: JSONArray()
    val items = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val sizesArr = o.optJSONArray("sizes") ?: JSONArray()
        MenuItem(
            id = o.optString("id"),
            name = o.optString("name"),
            sub = o.optString("sub"),
            available = o.optBoolean("available", true),
            sizes = (0 until sizesArr.length()).map { j ->
                val s = sizesArr.getJSONObject(j)
                MenuSize(
                    id = s.optString("id"),
                    name = s.optString("name"),
                    price = s.optString("price"),
                    active = s.optBoolean("active", true),
                )
            },
        )
    }
    return CategoryItems(
        categoryId = category?.optString("id") ?: "",
        name = category?.optString("name") ?: "",
        items = items,
    )
}

fun parseKitchenScopes(root: JSONObject): List<KitchenScope> {
    val arr = root.optJSONArray("scopes") ?: JSONArray()
    return (0 until arr.length()).map { i ->
        val s = arr.getJSONObject(i)
        KitchenScope(scope = s.optString("scope"), minutesLeft = s.optInt("minutesLeft"))
    }
}
