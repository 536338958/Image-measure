//! Linux 专属：让 WebKitGTK 网页视图里的 getUserMedia 可用。
//!
//! WebKitGTK 与 macOS/Windows 不同，有两处必须处理，否则相机【只在 Linux 上】失效：
//!  1. `enable-media-stream` 默认关闭 → `navigator.mediaDevices` 缺失，请求根本发不出去；
//!  2. 默认的 `permission-request` 处理器**拒绝一切请求** → 即使开了 media-stream 也会
//!     收到 NotAllowedError。
//!
//! 处理方式（deny-by-default，仅放行本应用自己的 origin 的音视频请求）：
//! 任何停在其它 origin 的文档都不会继承静默的麦克风/相机权限。Tauri 默认不限制导航，
//! 没有这个 origin 检查的话，任何被加载进来的页面都会拿到进程级的相机访问权。
//!
//! 移植自 buzz 项目 desktop/src-tauri/src/linux_media.rs（MIT）。
//! 生产 origin：Linux 上 Tauri 以 tauri://localhost 提供打包后的资源。
//! dev origin：v2 静态资源 dev 模式走内置服务（http://localhost:1420），仅 debug 构建信任。

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const PROD_ORIGIN: &str = "tauri://localhost";

#[cfg(debug_assertions)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const DEV_ORIGIN: &str = "http://localhost:1420";

/// `uri` 是否是允许使用相机/麦克风的受信 origin。完全相等或路径前缀匹配，
/// 因此 tauri://localhost.evil.com 与 http://localhost:14200 不会漏进来。
/// 纯函数，任何平台都可单测。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn is_trusted_media_origin(uri: &str) -> bool {
    fn matches(uri: &str, origin: &str) -> bool {
        uri == origin
            || uri
                .strip_prefix(origin)
                .is_some_and(|rest| rest.starts_with('/'))
    }

    if matches(uri, PROD_ORIGIN) {
        return true;
    }
    #[cfg(debug_assertions)]
    if matches(uri, DEV_ORIGIN) {
        return true;
    }
    false
}

/// 为 webview 启用音视频采集（仅 Linux WebKitGTK 有效，其它平台 no-op）。
/// 从共享启动代码无条件调用即可。
#[cfg(target_os = "linux")]
pub fn enable_media_capture(webview: &tauri::Webview) {
    use webkit2gtk::{
        glib::prelude::*, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    // with_webview 把闭包排到 UI 线程执行（GTK 调用必须在 UI 线程）。
    let result = webview.with_webview(move |platform_webview| {
        // Linux 上这就是底层的 webkit2gtk::WebView。
        let webview = platform_webview.inner();

        // 老版 WebKitGTK 默认关闭；不开 navigator.mediaDevices 就不存在。
        if let Some(settings) = webview.settings() {
            settings.set_enable_media_stream(true);
        }

        webview.connect_permission_request(move |wv, request| {
            // 只放行 UserMedia（相机/麦克风）；其它类型交给 WebKit 默认处理（拒绝）。
            if !request.is::<UserMediaPermissionRequest>() {
                return false;
            }
            let page = wv.uri();
            if page
                .as_deref()
                .map(is_trusted_media_origin)
                .unwrap_or(false)
            {
                request.allow();
            } else {
                request.deny();
            }
            true // 已处理，阻止默认处理器再次介入
        });
    });
    if let Err(e) = result {
        eprintln!("cammeasure: could not install media permission handler: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::is_trusted_media_origin;

    #[test]
    fn prod_origin_exact_and_paths() {
        assert!(is_trusted_media_origin("tauri://localhost"));
        assert!(is_trusted_media_origin("tauri://localhost/index.html"));
        assert!(is_trusted_media_origin("tauri://localhost/assets/app.js"));
    }

    #[test]
    fn lookalike_hosts_denied() {
        assert!(!is_trusted_media_origin("tauri://localhost.evil.com"));
        assert!(!is_trusted_media_origin("tauri://localhost:8080"));
        assert!(!is_trusted_media_origin("https://tauri.localhost"));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn dev_origin_debug_only() {
        assert!(is_trusted_media_origin("http://localhost:1420/"));
        assert!(!is_trusted_media_origin("http://localhost:14200"));
    }
}
