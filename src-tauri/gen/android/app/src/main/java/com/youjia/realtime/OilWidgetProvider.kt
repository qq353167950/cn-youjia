package com.youjia.realtime

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 桌面小组件：显示所选省市的 92# / 95# / 98# / 0# 柴油价格。
 *
 * 说明：
 * - 小组件运行在独立的 AppWidget 进程广播里，拿不到 Tauri WebView 里的 Rust 后端，
 *   所以这里用 Kotlin 自己发一次 HTTPS/HTTP 请求（站点数据本身很轻，只有几 KB）。
 * - 结果写入 SharedPreferences，供下次渲染和离线兜底使用。
 * - 断网时显示上次缓存的价格，并标注时间，不会显示空白。
 */
class OilWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.youjia.realtime.WIDGET_REFRESH"

        /**
         * 供外部（主 Activity / 前端桥接）调用：立刻刷新所有小组件。
         * 直接复用内部刷新逻辑，不依赖广播是否被系统冻结。
         */
        fun requestRefresh(context: Context) {
            val app = context.applicationContext
            executor.execute {
                doRefresh(app)
            }
        }

        /**
         * 真正的刷新体：拉数据 → 写缓存 → 重绘所有实例。
         * 放在 companion 里，实例方法和外部调用都能直接访问。
         * 调用方需保证运行在后台线程。
         */
        private fun doRefresh(app: Context) {
            try {
                val slug = prefs(app).getString("slug", "beijing") ?: "beijing"
                val prices = fetchPrices(slug)
                if (prices.isNotEmpty()) {
                    val p = prefs(app).edit()
                    GRADES.forEach { g ->
                        prices[g]?.let { p.putString(g, it.toString()) }
                    }
                    p.putString(
                        "updated",
                        SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date())
                    )
                    p.putString("error", "0")
                    p.apply()
                } else {
                    prefs(app).edit().putString("error", "1").apply()
                }
            } catch (_: Exception) {
                prefs(app).edit().putString("error", "1").apply()
            }

            // 回到主线程重绘
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                val mgr = AppWidgetManager.getInstance(app)
                val ids = mgr.getAppWidgetIds(
                    android.content.ComponentName(app, OilWidgetProvider::class.java)
                )
                ids.forEach { id -> render(app, mgr, id, fromCache = true) }
            }
        }

        private const val PREFS = "yj_widget"
        private const val UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

        /** 小组件只关心的四个标号，顺序固定 */
        private val GRADES = listOf("92#", "95#", "98#", "0#")

        private val executor = Executors.newSingleThreadExecutor()

        private fun prefs(ctx: Context) =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        private fun fetchPrices(slug: String): Map<String, Double> {
            val url = URL("http://www.qiyoujiage.com/$slug.shtml")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                requestMethod = "GET"
                setRequestProperty("User-Agent", UA)
                setRequestProperty("Referer", "http://www.qiyoujiage.com/")
            }
            val html =
                conn.inputStream.use { s ->
                    BufferedReader(InputStreamReader(s, Charsets.UTF_8)).readText()
                }
            conn.disconnect()

            val out = LinkedHashMap<String, Double>()
            val start = html.indexOf("id=\"youjia\"")
            if (start < 0) return out
            val block = html.substring(start)

            // 逐个 <dl> 取 dt/dd 对
            val dlRegex = Regex("<dt>(.*?)</dt>\\s*<dd>(.*?)</dd>", RegexOption.DOT_MATCHES_ALL)
            for (m in dlRegex.findAll(block)) {
                val label = m.groupValues[1]
                val raw = m.groupValues[2]
                val num = raw.filter { it.isDigit() || it == '.' }
                if (num.isEmpty()) continue
                val price = num.toDoubleOrNull() ?: continue
                if (price <= 0.5 || price >= 30.0) continue

                // 从「北京92#汽油」里取出 92#
                val g = Regex("(\\d+)\\s*#").find(label) ?: continue
                val grade = g.groupValues[1] + "#"
                if (GRADES.contains(grade)) out[grade] = price
                if (out.size >= GRADES.size) break
            }
            return out
        }

        /** 渲染一个小组件实例 */
        private fun render(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            fromCache: Boolean
        ) {
            val options = manager.getAppWidgetOptions(widgetId)
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
            // 宽度够就用 4 列，否则两列两行，避免字被挤没
            val wide = minWidth >= 250

            val p = prefs(context)
            val slug = p.getString("slug", "beijing") ?: "beijing"
            val cityName = p.getString("cityName", "北京") ?: "北京"
            val updated = p.getString("updated", null)

            val views = RemoteViews(context.packageName, R.layout.widget_oil)
            views.setTextViewText(R.id.w_city, cityName)
            views.setTextViewText(
                R.id.w_time,
                if (updated != null) "更新 $updated" else "下拉刷新"
            )

            val idMap = mapOf(
                "92#" to R.id.w_p92,
                "95#" to R.id.w_p95,
                "98#" to R.id.w_p98,
                "0#" to R.id.w_p0
            )
            GRADES.forEach { g ->
                val v = p.getString(g, null)
                views.setTextViewText(
                    idMap[g] ?: R.id.w_p92,
                    if (v != null) String.format(Locale.CHINA, "%.2f", v.toDouble()) else "--"
                )
            }
            views.setTextViewText(R.id.w_p0_label, "0# 柴油")

            // 点击整块 → 打开 App
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (launch != null) {
                launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                val pi = PendingIntent.getActivity(
                    context,
                    0,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.w_root, pi)
            }

            manager.updateAppWidget(widgetId, views)
        }
    }

    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        ids: IntArray
    ) {
        ids.forEach { id ->
            // 先用手上已有的缓存立刻渲染，避免出现空白/加载态
            render(context, manager, id, fromCache = true)
        }
        refreshAll(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_REFRESH -> refreshAll(context)
            Intent.ACTION_TIME_TICK -> {
                // 每小时整点顺带刷新一次，属于轻量补偿
            }
        }
    }

    override fun onEnabled(context: Context) {
        refreshAll(context)
    }

    /** 后台拉一次最新价，然后重绘所有实例 */
    private fun refreshAll(context: Context) {
        val app = context.applicationContext
        executor.execute { doRefresh(app) }
    }

    /**
     * 解析省份页的 <div id="youjia"> 区块，提取 (标号 -> 价格)。
     * 页面是 UTF-8，形如：<dt>北京92#汽油</dt><dd>8.61</dd>
     */
}
