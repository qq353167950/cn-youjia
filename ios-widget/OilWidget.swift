//
//  OilWidget.swift
//  油价 · iOS 桌面小组件（WidgetKit）
//
//  说明：
//  - iOS 与 Android 的小组件机制完全不同，Android 是 RemoteViews + AppWidgetProvider，
//    iOS 是 SwiftUI + WidgetKit，两者无法共用代码，必须分别实现。
//  - 这里用 TimelineProvider 定时刷新，并直接请求数据源，不依赖主 App 运行。
//  - 与主 App 的城市联动：主 App 把当前城市写入 App Group 共享容器，
//    小组件从这里读取。需要在两个 target 上都配置同一个 App Group。
//
//  集成步骤（在 macOS + Xcode 上）：
//    1. npx tauri ios init 生成 ios 工程；
//    2. Xcode 中 File > New > Target > Widget Extension，命名 OilWidget；
//    3. 把本文件加入该 target；
//    4. 主 App target 与 OilWidget target 都勾选同一个 App Group
//       （例如 group.com.youjia.realtime）；
//    5. 主 App 侧启动时调用 OilWidgetBridge.saveCity(slug:name:)。
//

import WidgetKit
import SwiftUI

// MARK: - 数据模型

/// 单个油品
struct FuelPrice: Codable, Identifiable {
    var id: String { grade }
    let grade: String
    let price: Double
}

/// 小组件展示所需的一整份数据
struct OilEntry: TimelineEntry {
    let date: Date
    let cityName: String
    /// 只保留 92# / 95# / 98# / 0#
    let fuels: [FuelPrice]
    /// 无网络、也无缓存时为 true
    let isStale: Bool
}

// MARK: - App Group 共享存储

enum SharedStore {
    /// 必须与主 App 保持一致
    static let appGroup = "group.com.youjia.realtime"
    private static let cityKey = "widget.cityName"
    private static let slugKey = "widget.citySlug"
    private static let cacheKey = "widget.fuels"
    private static let dateKey = "widget.updatedAt"

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static var cityName: String {
        defaults?.string(forKey: cityKey) ?? "北京"
    }

    static var citySlug: String {
        defaults?.string(forKey: slugKey) ?? "beijing"
    }

    /// 读上次缓存的价格（断网兜底）
    static func cachedFuels() -> [FuelPrice] {
        guard let data = defaults?.data(forKey: cacheKey),
              let list = try? JSONDecoder().decode([FuelPrice].self, from: data)
        else { return [] }
        return list
    }

    static func save(_ fuels: [FuelPrice]) {
        guard let data = try? JSONEncoder().encode(fuels) else { return }
        defaults?.set(data, forKey: cacheKey)
        defaults?.set(Date(), forKey: dateKey)
    }
}

// MARK: - 网络请求与解析

enum OilAPI {
    /// 只关心这四种
    static let wanted = ["92#", "95#", "98#", "0#"]

    static func fetch(slug: String) async -> [FuelPrice] {
        guard let url = URL(string: "http://www.qiyoujiage.com/\(slug).shtml") else {
            return []
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        req.setValue("http://www.qiyoujiage.com/", forHTTPHeaderField: "Referer")

        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            guard let html = String(data: data, encoding: .utf8) else { return [] }
            return parse(html)
        } catch {
            return []
        }
    }

    /// 解析 <dt>北京92#汽油</dt><dd>8.61</dd>
    static func parse(_ html: String) -> [FuelPrice] {
        guard let start = html.range(of: "id=\"youjia\"") else { return [] }
        let block = String(html[start.lowerBound...])

        var result: [FuelPrice] = []
        // 用正则抓 dt/dd 对
        let pattern = "<dt>(.*?)</dt>\\s*<dd>(.*?)</dd>"
        guard let regex = try? NSRegularExpression(
            pattern: pattern,
            options: [.dotMatchesLineSeparators]
        ) else { return [] }

        let ns = block as NSString
        let matches = regex.matches(
            in: block,
            range: NSRange(location: 0, length: ns.length)
        )

        for m in matches {
            guard m.numberOfRanges >= 3 else { continue }
            let label = ns.substring(with: m.range(at: 1))
            let raw = ns.substring(with: m.range(at: 2))

            // 取标号，如「北京92#汽油」→ 92#
            guard let g = label.range(of: "([0-9]+)\\s*#", options: .regularExpression)
            else { continue }
            let grade = String(label[g]).replacingOccurrences(
                of: "\\s",
                with: "",
                options: .regularExpression
            )

            let digits = raw.filter { $0.isNumber || $0 == "." }
            guard let price = Double(digits), price > 0.5, price < 30 else { continue }

            if wanted.contains(grade), !result.contains(where: { $0.grade == grade }) {
                result.append(FuelPrice(grade: grade, price: price))
            }
            if result.count == wanted.count { break }
        }
        return result
    }
}

// MARK: - TimelineProvider

struct OilProvider: TimelineProvider {
    /// 占位数据（首次加载时显示）
    func placeholder(in context: Context) -> OilEntry {
        OilEntry(
            date: Date(),
            cityName: SharedStore.cityName,
            fuels: [
                FuelPrice(grade: "92#", price: 8.61),
                FuelPrice(grade: "95#", price: 9.17),
                FuelPrice(grade: "98#", price: 10.67),
                FuelPrice(grade: "0#", price: 8.36),
            ],
            isStale: false
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (OilEntry) -> Void) {
        // 快照要快：优先用缓存，避免小组件库里转圈
        let cached = SharedStore.cachedFuels()
        completion(
            OilEntry(
                date: Date(),
                cityName: SharedStore.cityName,
                fuels: cached.isEmpty ? placeholder(in: context).fuels : cached,
                isStale: cached.isEmpty
            )
        )
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OilEntry>) -> Void) {
        Task {
            let slug = SharedStore.citySlug
            var fuels = await OilAPI.fetch(slug: slug)
            var stale = false

            if fuels.isEmpty {
                // 网络失败 → 用缓存
                fuels = SharedStore.cachedFuels()
                stale = true
            } else {
                SharedStore.save(fuels)
            }

            let entry = OilEntry(
                date: Date(),
                cityName: SharedStore.cityName,
                fuels: fuels,
                isStale: stale
            )

            // 每 30 分钟刷新一次（系统会酌情合并，不会精确到点）
            let next = Calendar.current.date(
                byAdding: .minute,
                value: 30,
                to: Date()
            ) ?? Date().addingTimeInterval(1800)

            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - 视图

struct OilWidgetView: View {
    var entry: OilEntry
    @Environment(\.widgetFamily) private var family

    /// 只显示前四个，保证 2x2 布局不溢出
    private var four: [FuelPrice] {
        // 按 92 / 95 / 98 / 0 固定顺序
        let order = ["92#", "95#", "98#", "0#"]
        return order.compactMap { g in entry.fuels.first { $0.grade == g } }
    }

    private func label(_ grade: String) -> String {
        grade == "0#" ? "0# 柴油" : grade
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 顶部：城市
            HStack(spacing: 5) {
                Circle()
                    .fill(Color.cyan)
                    .frame(width: 5, height: 5)
                Text(entry.cityName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                if entry.isStale {
                    Text("离线")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.orange)
                }
            }

            // 2x2 网格
            Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                GridRow {
                    cell(four, 0)
                    cell(four, 1)
                }
                GridRow {
                    cell(four, 2)
                    cell(four, 3)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .padding(13)
        .containerBackground(for: .widget) {
            // 深色渐变底，与 App 内深色主题一致
            LinearGradient(
                colors: [
                    Color(red: 0.078, green: 0.09, blue: 0.13),
                    Color(red: 0.10, green: 0.12, blue: 0.17),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    @ViewBuilder
    private func cell(_ list: [FuelPrice], _ idx: Int) -> some View {
        if idx < list.count {
            let f = list[idx]
            VStack(alignment: .leading, spacing: 1) {
                Text(label(f.grade))
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(gradeColor(f.grade).opacity(0.85))
                    .lineLimit(1)
                Text(String(format: "%.2f", f.price))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Color.clear
        }
    }

    private func gradeColor(_ grade: String) -> Color {
        switch grade {
        case "92#": return Color(red: 0.30, green: 0.55, blue: 1.0)
        case "95#": return Color(red: 0.21, green: 0.83, blue: 0.84)
        case "98#": return Color(red: 0.66, green: 0.48, blue: 1.0)
        default:    return Color(red: 1.0, green: 0.62, blue: 0.27)
        }
    }
}

// MARK: - Widget 声明

@main
struct OilWidget: Widget {
    let kind = "OilWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OilProvider()) { entry in
            OilWidgetView(entry: entry)
        }
        .configurationDisplayName("油价")
        .description("显示 92#、95#、98#、0# 柴油的实时油价")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
