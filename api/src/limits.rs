//! In-memory rate limits (fixed windows). Keys are an IP or a user, never written to disk:
//! the server keeps no IP addresses beyond these few minutes.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Limiter {
    hits: Mutex<HashMap<String, (Instant, u32)>>,
}

impl Limiter {
    /// Count a hit on `key`; false once it has had `max` hits within the current `window`.
    pub fn allow(&self, key: &str, max: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap();
        if hits.len() > 20_000 {
            hits.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(3600));
        }
        let entry = hits.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= max
    }
}
