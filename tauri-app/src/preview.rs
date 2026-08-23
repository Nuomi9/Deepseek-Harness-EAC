//! 预览静态文件服务（main.js startPreviewStaticServer 移植）：独立端口的
//! 只读文件服务，供「站内 HTML 预览」iframe 使用，避免占满宿主 6 连接上限。
//! 安全边界与 JS 版一致：仅回环、仅 GET/HEAD、仅绝对路径、仅普通文件。

use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};

pub static PREVIEW_PORT: AtomicU16 = AtomicU16::new(0);

fn mime_of(ext: &str) -> &'static str {
    match ext {
        "html" | "htm" | "xhtml" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "json" | "map" => "application/json",
        "txt" | "md" | "csv" => "text/plain",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogg" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
}

fn is_text_mime(m: &str) -> bool {
    m.starts_with("text/")
        || m.starts_with("application/json")
        || m.starts_with("application/javascript")
        || m.starts_with("application/xhtml+xml")
        || m.starts_with("application/xml")
        || m.starts_with("image/svg")
}

/// 启动只读静态服务（127.0.0.1:0），端口记入 PREVIEW_PORT。失败不致命。
pub fn start(log: std::sync::Arc<crate::logging::Logger>) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", 0)) {
            Ok(l) => l,
            Err(e) => {
                log.log("boot", &format!("预览静态服务失败: {}", e));
                return;
            }
        };
        if let Ok(addr) = listener.local_addr() {
            PREVIEW_PORT.store(addr.port(), Ordering::SeqCst);
            log.log("boot", &format!("预览静态服务已启动: http://127.0.0.1:{}", addr.port()));
        }
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            // 仅接受回环（JS 版逐请求校验 remoteAddress 的等价物）。
            let peer_ok = stream
                .peer_addr()
                .map(|a| a.ip().is_loopback())
                .unwrap_or(false);
            let mut buf = [0u8; 4096];
            let mut raw = Vec::new();
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        raw.extend_from_slice(&buf[..n]);
                        if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.len() > 16384 {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let head = String::from_utf8_lossy(&raw);
            let mut parts = head.split_whitespace();
            let method = parts.next().unwrap_or("");
            let target = parts.next().unwrap_or("");
            if !peer_ok {
                respond(&mut stream, 403, &[], b"");
                continue;
            }
            if method != "GET" && method != "HEAD" {
                respond(
                    &mut stream,
                    405,
                    &[("allow", "GET, HEAD")],
                    b"",
                );
                continue;
            }
            // 解析 pathname 并 decodeURIComponent。
            let path_part = target.split(['?', '#']).next().unwrap_or("/");
            let decoded = url_decode(path_part.trim_start_matches('/'));
            let decoded = strip_windows_root(&decoded);
            let p = PathBuf::from(&decoded);
            if !p.is_absolute() {
                respond(&mut stream, 400, &[], b"");
                continue;
            }
            match std::fs::metadata(&p) {
                Ok(md) if md.is_file() => {
                    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                    let mime = mime_of(&ext);
                    let len = md.len().to_string();
                    let ct = if is_text_mime(mime) { format!("{}; charset=utf-8", mime) } else { mime.to_string() };
                    if method == "HEAD" {
                        respond(
                            &mut stream,
                            200,
                            &[("content-type", &ct), ("content-length", &len), ("cache-control", "no-store")],
                            b"",
                        );
                    } else {
                        match std::fs::read(&p) {
                            Ok(body) => respond(
                                &mut stream,
                                200,
                                &[("content-type", &ct), ("content-length", &len), ("cache-control", "no-store")],
                                &body,
                            ),
                            Err(_) => respond(&mut stream, 404, &[], b""),
                        }
                    }
                }
                _ => respond(&mut stream, 404, &[], b""),
            }
        }
    });
}

/// `/C:/x` 或 `C:/x` 形态归一为绝对 Windows 路径（JS 版 slice(1) 等价）。
fn strip_windows_root(p: &str) -> String {
    if let Some(rest) = p.strip_prefix('/') {
        let bytes = rest.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return rest.to_string();
        }
    }
    p.to_string()
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes.get(i + 1).copied()), hex_val(bytes.get(i + 2).copied())) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: Option<u8>) -> Option<u8> {
    match b? {
        c @ b'0'..=b'9' => Some(c - b'0'),
        c @ b'a'..=b'f' => Some(c - b'a' + 10),
        c @ b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn respond(stream: &mut std::net::TcpStream, code: u16, headers: &[(&str, &str)], body: &[u8]) {
    use std::io::Write;
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "OK",
    };
    let mut resp = format!("HTTP/1.1 {} {}\r\n", code, reason);
    for (k, v) in headers {
        resp.push_str(&format!("{}: {}\r\n", k, v));
    }
    resp.push_str("\r\n");
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_and_windows_root() {
        assert_eq!(url_decode("/a%20b.html"), "/a b.html");
        assert_eq!(strip_windows_root("/C:/x/y.html"), "C:/x/y.html");
        assert_eq!(strip_windows_root("D:/plain/x"), "D:/plain/x");
        assert_eq!(strip_windows_root("relative/x"), "relative/x");
    }

    #[test]
    fn mime_table() {
        assert_eq!(mime_of("html"), "text/html");
        assert_eq!(mime_of("unknownext"), "application/octet-stream");
    }
}
