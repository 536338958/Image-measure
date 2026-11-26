// CamMeasure 桌面壳。
// 网页本体（CamMeasure.html）原样运行；这里只解决三平台 WebView 的相机权限差异：
//   Windows/WebView2  —— getUserMedia 开箱即用，无需处理；
//   macOS/WKWebView   —— 由 src-tauri/Info.plist（NSCameraUsageDescription，
//                        Tauri 打包时自动与默认 Info.plist 合并）+ Entitlements.plist 声明；
//   Linux/WebKitGTK   —— media-stream 默认关闭、permission-request 默认拒绝，必须在 Rust 侧接管，
//                        见 linux_media.rs（模式取自 Pake/tw93 的成熟实现，MIT/GPL 兼容用法）。
#[cfg(target_os = "linux")]
mod linux_media;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // tauri.conf.json 里声明的窗口在 setup 之前已创建，这里逐个拿到 WebviewWindow。
            // Linux 上给每个 webview 装 getUserMedia 权限处理器；其它平台无需处理。
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                for window in app.webview_windows().values() {
                    linux_media::enable_media_capture(window);
                }
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CamMeasure");
}
