# 油价 · cn-youjia

实时油价 App，Android（Tauri 2 + Rust），含桌面小组件。

## 功能

- **31 个省市**实时油价：92# / 95# / 98# / 0# 柴油（部分城市含 -10# / -20# / -35#）
- **油价计算器**：金额 ⇄ 升数双向换算，支持按油品计价
- **城市对比**：自选城市并排比较，跟随首页城市自动同步
- **价格趋势**：纯 SVG 手绘曲线，记录每天价格
- **桌面小组件**：显示 92/95/98/0# 四种油价，跟随 App 选择的城市
- **深/浅双主题**：切换按钮在右上角，系统状态栏同步变色

## 技术栈

| 层 | 技术 |
| :--- | :--- |
| 外壳 | Tauri 2 |
| 后端 | Rust（reqwest + encoding_rs） |
| 前端 | 原生 JS + CSS，零框架、零图表库 |
| Android | Kotlin（小组件 + 状态栏桥接） |
| iOS | Swift + WidgetKit（源码在 `ios-widget/`） |

## 目录结构

```
src/                    前端
  main.js               全部逻辑（状态、渲染、事件）
  style.css             全部样式（双主题变量）
src-tauri/
  src/lib.rs            Rust 后端（抓取、解析、缓存）
  capabilities/         Tauri 权限
  gen/android/          Android 工程（含 Kotlin 定制代码）
ios-widget/             iOS WidgetKit 小组件源码
.github/workflows/      CI：打 tag 自动构建发布
```

## 数据源

`http://www.qiyoujiage.com/`
- 省份页 `{slug}.shtml` —— 汽油与 0# 柴油
- 全国柴油表 `chaiyou.shtml` —— 负标号柴油（-10/-20/-35）

页面为 UTF-8 编码，Rust 侧用状态机解析，10 分钟内存缓存。

## 本地开发

```bash
npm install

# 前端预览（浏览器，使用 mock 数据）
npm run build && cd dist && python -m http.server 8201

# Android 构建（需要 Android SDK + NDK + JDK 17+）
npm run build
npx tauri android init        # 首次
npx tauri android build --target aarch64 --split-per-abi
```

产物：`src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`

## 发版

推 tag 即自动构建并发布：

```bash
git tag v2.0.0
git push origin v2.0.0
```

CI 会：
1. 构建 arm64 APK
2. 用仓库 Secrets 里的密钥签名
3. 创建 GitHub Release 并附上 APK

### 需要的 Secrets

| Secret | 说明 |
| :--- | :--- |
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |

### iOS（可选）

iOS 需要 macOS runner + Apple 开发者账号，默认**不构建**。

要启用：在仓库 Settings → Variables 里设置 `ENABLE_IOS_BUILD=true`，
并添加以下 Secrets：

| Secret | 说明 |
| :--- | :--- |
| `IOS_CERTIFICATE_BASE64` | .p12 证书 base64 |
| `IOS_CERTIFICATE_PASSWORD` | 证书密码 |
| `IOS_KEYCHAIN_PASSWORD` | 临时钥匙串密码 |
| `IOS_PROVISIONING_PROFILE_BASE64` | 描述文件 base64 |

小组件集成步骤见 `ios-widget/README.md`。

## 已知限制

- **趋势图需要积累**：数据源只给当前价，历史靠 App 每次打开时本地记录，第 2 天起才有曲线
- **省级挂牌价**：不是单个加油站实价
- **仅 arm64**：如需 32 位或模拟器，改 `--target all`
- **数据源依赖第三方**：页面结构变更会导致解析失效（代码会降级报错，不崩溃）

## 许可

个人项目，仅供学习参考。
