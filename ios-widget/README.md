# iOS 桌面小组件集成说明

本目录提供 iOS 版本的桌面小组件源码。**Windows 上无法编译和验证**，需在 macOS + Xcode 中集成。

## 文件

| 文件 | 加入哪个 target | 作用 |
| :--- | :--- | :--- |
| `OilWidget.swift` | **Widget Extension**（新建） | WidgetKit 小组件本体：请求数据、解析、渲染 |
| `OilWidgetBridge.swift` | **主 App target** | 把当前城市写入 App Group，供小组件读取 |

## 与 Android 的差异

| | Android | iOS |
| :--- | :--- | :--- |
| 组件机制 | `AppWidgetProvider` + `RemoteViews` | `WidgetKit` + SwiftUI |
| 布局 | XML | SwiftUI 代码 |
| 刷新 | `updatePeriodMillis`（30 分钟） | `Timeline` + `.after(30 分钟)` |
| 城市共享 | `SharedPreferences` | `UserDefaults(suiteName: App Group)` |
| 代码复用 | 无 | 无 |

两者**一行代码都不能共用**，所以必须分别实现。

## 集成步骤

```bash
# 1. 在 macOS 上生成 iOS 工程
npm install
npm run build
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npx tauri ios init
```

2. 用 Xcode 打开 `src-tauri/gen/apple/` 下的工程

3. **File → New → Target → Widget Extension**
   - 命名 `OilWidget`
   - **取消勾选** "Include Configuration App Intent"
   - 把生成的模板文件替换为 `OilWidget.swift`

4. **配置 App Group**（两个 target 都要）
   - 选中 App target → Signing & Capabilities → **+ Capability** → App Groups
   - 添加 `group.com.youjia.realtime`
   - 选中 OilWidget target，重复一次，勾选同一个 group

5. 把 `OilWidgetBridge.swift` 加入**主 App target**

6. 在 Rust 侧注册命令调用桥接，供前端使用（示意）：

```rust
#[tauri::command]
fn set_widget_city(slug: String, name: String) {
    // iOS 侧通过 Swift 桥接调用 OilWidgetBridge.saveCity
}

#[cfg(target_os = "ios")]
mod ios_bridge {
    extern "C" {
        fn oil_widget_save_city(slug: *const c_char, name: *const c_char);
    }
}
```

7. 前端在切换城市时调用（与 Android 的 `YoujiaNative` 并存）：

```javascript
// iOS 环境通过 Tauri invoke
if (window.__TAURI_INTERNALS__ && isIOS) {
  invoke("set_widget_city", { slug, name });
}
```

## 数据来源

小组件直接请求 `http://www.qiyoujiage.com/{slug}.shtml`，与 Android 小组件一致。

⚠️ **iOS 的 ATS（App Transport Security）默认禁止 HTTP**。需要在小组的 `Info.plist` 中放开：

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>qiyoujiage.com</key>
        <dict>
            <key>NSIncludesSubdomains</key>
            <true/>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

## 未验证部分

这部分代码**我无法在当前环境（Windows，无 Xcode）编译验证**。逻辑参考了 Android 版本的成熟实现，Swift 语法和 API 使用按 iOS 17 SDK 编写。集成后若报错，多半是：

- App Group 标识不一致 → 小组件读不到城市，会显示默认「北京」
- 缺少 ATS 配置 → 数据请求失败，显示「离线」+ 缓存
- Widget target 未勾选 App Group → `UserDefaults(suiteName:)` 返回 nil

## 建议的验证顺序

1. 先只放占位数据，确认小组件能加到桌面并正常显示
2. 再验证网络请求（看是否被 ATS 拦截，Xcode 控制台会有明确报错）
3. 最后验证 App Group 联动（主 App 切城市 → 小组件是否跟着变）
