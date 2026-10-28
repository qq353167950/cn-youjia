package com.youjia.realtime

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * 主 Activity。
 *
 * 职责：
 * 1) 向 WebView 注入桥接（城市同步 + 主题同步）；
 * 2) 根据主题切换系统状态栏图标颜色。
 *
 * 注入时机的坑：
 *   addJavascriptInterface 必须在页面开始加载前后尽早调用，且 WebView 可能
 *   在 onCreate 之后才被 Wry 创建。只在 onResume 里试一次容易拿不到，
 *   那样前端永远看不到 window.YoujiaNative，城市就同步不到小组件。
 *   这里改为：onCreate / onResume / onWindowFocusChanged 都尝试注入，
 *   注入成功后打标记，避免重复注入。
 */
class MainActivity : TauriActivity() {

  private var bridgeInjected = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applySystemBarStyle(true)
  }

  override fun onResume() {
    super.onResume()
    tryInjectBridge()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) tryInjectBridge()
  }

  /** 找到 WebView 并注入桥接；成功后置位，不再重复注入 */
  private fun tryInjectBridge() {
    if (bridgeInjected) return
    try {
      val wv = findWebView(window.decorView) ?: return
      // 同一个 name 重复 add 会覆盖，安全
      wv.addJavascriptInterface(WidgetBridge(this), "YoujiaNative")
      bridgeInjected = true
      Log.i("YoujiaBridge", "YoujiaNative injected")
    } catch (t: Throwable) {
      Log.w("YoujiaBridge", "inject failed: ${t.message}")
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }

  /**
   * 设置系统栏样式。
   * @param dark true = 深色主题（浅色图标）
   */
  internal fun applySystemBarStyle(dark: Boolean) {
    runOnUiThread {
      try {
        val window = window ?: return@runOnUiThread
        val bg = if (dark) Color.parseColor("#0A0C11") else Color.parseColor("#EEF1F6")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          window.insetsController?.let { ctrl ->
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
              WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            if (dark) {
              ctrl.setSystemBarsAppearance(0, mask)
            } else {
              ctrl.setSystemBarsAppearance(mask, mask)
            }
          }
        } else {
          @Suppress("DEPRECATION")
          var flags = window.decorView.systemUiVisibility
          flags = if (dark) {
            flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
          } else {
            flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
          }
          @Suppress("DEPRECATION")
          window.decorView.systemUiVisibility = flags
        }

        window.statusBarColor = bg
        window.navigationBarColor = bg
      } catch (_: Throwable) {
      }
    }
  }

  /** 暴露给 JS：window.YoujiaNative.* */
  inner class WidgetBridge(private val ctx: MainActivity) {

    @JavascriptInterface
    fun setCity(slug: String?, name: String?) {
      val s = (slug ?: "").trim()
      if (s.isEmpty()) return
      val sp = ctx.getSharedPreferences("yj_widget", MODE_PRIVATE)
      val old = sp.getString("slug", null)
      sp.edit()
        .putString("slug", s)
        .putString("cityName", (name ?: "").trim().ifEmpty { s })
        .apply()
      Log.i("YoujiaBridge", "setCity: $old -> $s")

      // 城市变了才唤醒小组件刷新
      if (old != s) {
        try {
          OilWidgetProvider.requestRefresh(ctx.applicationContext)
        } catch (t: Throwable) {
          Log.w("YoujiaBridge", "refresh failed: ${t.message}")
        }
      }
    }

    @JavascriptInterface
    fun setTheme(theme: String?) {
      ctx.applySystemBarStyle(theme != "light")
    }
  }

  private companion object {
    const val MODE_PRIVATE = android.content.Context.MODE_PRIVATE
  }
}
