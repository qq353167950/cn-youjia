//
//  OilWidgetBridge.swift
//  油价 · 主 App 侧的小组件联动
//
//  作用：把用户当前选择的城市写入 App Group 共享容器，
//  让 iOS 桌面小组件知道该显示哪个城市的价格。
//
//  与 Android 的 YoujiaNative.setCity 对应，但机制不同：
//    Android → SharedPreferences（由 MainActivity 注入的 JS 桥接写入）
//    iOS     → UserDefaults(suiteName: App Group)
//
//  集成步骤（macOS + Xcode）：
//    1. 把本文件加入主 App target（不是 Widget target）；
//    2. 主 App 与 Widget 两个 target 都勾选同一个 App Group，
//       标识需与 OilWidget.swift 里的 SharedStore.appGroup 一致；
//    3. 在 Tauri 侧注册一个命令，供前端调用本类。
//

import Foundation

#if os(iOS)
import WidgetKit

enum OilWidgetBridge {

    /// 必须与 OilWidget.swift 中的 SharedStore.appGroup 完全一致
    static let appGroup = "group.com.youjia.realtime"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// 保存当前城市并立刻请求刷新小组件。
    /// - Parameters:
    ///   - slug: 数据源用的省名 slug，如 "beijing"、"guangdong"
    ///   - name: 中文显示名，如 "北京"
    static func saveCity(slug: String, name: String) {
        guard let d = defaults else { return }
        let changed = d.string(forKey: "widget.citySlug") != slug
        d.set(slug, forKey: "widget.citySlug")
        d.set(name, forKey: "widget.cityName")

        // 城市变了才刷新，避免无谓唤醒
        if changed {
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadTimelines(ofKind: "OilWidget")
            }
        }
    }

    /// 主动要求小组件刷新（例如主 App 拿到新价格时）
    static func reload() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: "OilWidget")
        }
    }
}
#endif
