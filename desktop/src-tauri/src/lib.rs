// CamMeasure 桌面壳。
// 网页本体（CamMeasure.html）原样运行；这里只解决三平台 WebView 的相机权限差异：
//   Windows/WebView2  —— getUserMedia 开箱即用，无需处理；
//   macOS/WKWebView   —— 由 src-tauri/Info.plist（NSCameraUsageDescription）+ Entitlements.plist 声明；
//   Linux/WebKitGTK   —— media-stream 默认关闭、permission-request 默认拒绝，必须在 Rust 侧接管，
//                        见 linux_media.rs（移植自 buzz 项目的成熟实现，MIT）。
#[cfg(target_os = "linux")]
mod linux_media;

pub fn run() {
    tauri::Builder::default()
        .on_webview_ready(|webview| {
            #[cfg(target_os = "linux")]
            linux_media::enable_media_capture(webview);
            #[cfg(not(target_os = "linux"))]
            let _ = webview;
        })
        .run(tauri::generate_context!())
        .expect("error while running CamMeasure");
}
