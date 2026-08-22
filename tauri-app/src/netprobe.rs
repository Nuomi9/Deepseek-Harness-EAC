//! 极简 HTTP 就绪探测（waitUntilUp / watchServerProc 的探测半边）。
//! 手写 GET，不引 HTTP 客户端依赖：只需要「状态码 < 500」一个布尔。

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// 探测 http://127.0.0.1:<port>/ 是否就绪。2xx~4xx 视为就绪（与 JS 版
/// `statusCode < 500` 一致：Web UI 的 404 首页也代表服务活着）。
pub fn probe_localhost(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    let Ok(mut stream) = TcpStream::connect(&addr) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let req = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nUser-Agent: dsh-desktop-probe\r\n\r\n",
        port
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 1024];
    let mut got = Vec::new();
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                got.extend_from_slice(&buf[..n]);
                if got.len() > 4096 {
                    break;
                }
                // 状态行已完整即可停
                if got.windows(2).any(|w| w == b"\r\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    parse_status_ok(&got)
}

/// 从原始响应字节解析状态行并判断 < 500。
pub fn parse_status_ok(raw: &[u8]) -> bool {
    let line = String::from_utf8_lossy(raw.split(|&b| b == b'\n').next().unwrap_or(b""));
    let mut it = line.trim().split_whitespace();
    let _ver = it.next();
    match it.next().and_then(|c| c.parse::<u16>().ok()) {
        Some(code) => code < 500,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_parsing() {
        assert!(parse_status_ok(b"HTTP/1.1 200 OK\r\n\r\n"));
        assert!(parse_status_ok(b"HTTP/1.1 404 Not Found\r\n"));
        assert!(!parse_status_ok(b"HTTP/1.1 502 Bad Gateway\r\n"));
        assert!(!parse_status_ok(b"garbage"));
        assert!(!parse_status_ok(b""));
    }
}
