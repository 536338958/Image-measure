# CamMeasure 桌面版（Tauri v2）

把 `app/CamMeasure.html`（单一事实源）打包为三平台安装软件。安装包约 8–12MB，
内存占用约为 Electron 方案的 1/3（复用系统 WebView，不捆绑 Chromium）。

| 平台 | WebView | 相机 | 产物 |
| --- | --- | --- | --- |
| Windows | WebView2 | 开箱即用 | `.msi` + `.exe`(NSIS) |
| macOS | WKWebView | Info.plist + Entitlements 已配好 | `.dmg` / `.app`（双架构） |
| Linux | WebKitGTK | Rust 侧已接管 `permission-request` | `.AppImage` + `.deb` + `.rpm` |

## 工作原理

- `copy-ui.js`：构建前把上级目录的 `CamMeasure.html` 复制为 `ui/index.html`。
  **网页版与桌面版永不漂移**；改动 HTML 后重跑 build 即可。
- `src-tauri/src/linux_media.rs`：WebKitGTK 的 `enable-media-stream` 默认关闭、
  `permission-request` 默认拒绝 —— 这里按受信 origin（`tauri://localhost`）白名单放行
  UserMedia 请求，deny-by-default，移植自 buzz 项目（MIT）。含 3 组单元测试
  （`cargo test` 在任何平台可跑，逻辑部分与 GTK 无关）。
- `src-tauri/Info.plist`：macOS 相机/麦克风用途声明（CLI 自动合并进 app bundle）。
- `src-tauri/Entitlements.plist`：App Sandbox + camera + audio-input。
- `icons/app-icon.png`：1024 源图标；CI 里 `npx tauri icon` 自动生成全套 icns/ico/png。

## 本地构建（在自己电脑上跑）

前置：Rust（rustup）+ Node 20+；Linux 另需
`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`。

```bash
cd app/desktop
npm install
npx tauri icon src-tauri/icons/app-icon.png   # 首次：生成图标全套
npm run dev                                   # 开发调试
npm run build                                 # 当前平台安装包 → src-tauri/target/release/bundle/
```

## CI 出三平台安装包（推荐）

1. 把 `app/desktop/.github/workflows/` 移到仓库根 `.github/workflows/`；
2. `git tag v1.0.0 && git push --tags`；
3. Actions 结束后在 Releases 出现 **Draft**，核对后点 Publish。

可选：macOS 签名/公证（无签名时用户需右键打开绕过 Gatekeeper）：

```
secrets: APPLE_CERTIFICATE、APPLE_CERTIFICATE_PASSWORD、APPLE_SIGNING_IDENTITY、
         APPLE_ID、APPLE_PASSWORD、APPLE_TEAM_ID
```

## 已知边界

- Linux：WebKitGTK 的相机采集依赖 GStreamer 插件（主流发行版自带）；AppImage 环境
  异常时可试 `GDK_BACKEND=x11`（WebKitGTK 采集在 X11 下最稳）。
- PDF 导出依赖 jsPDF CDN：离线安装版首次导出 PDF 需联网（其余全离线可用）。
  如需完全离线，可后续把 jspdf.umd.min.js 内嵌进 HTML。
- 录像容器：Windows/Linux 为 WebM，macOS WKWebView 支持 MP4（代码里自动择优）。

## 单元测试

```bash
cd app/desktop/src-tauri
cargo test          # linux_media 的 origin 白名单逻辑（三平台均可跑）
```
