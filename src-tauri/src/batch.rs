//! Frame batching for PTY output. Claude Code (Ink) and other TUIs repaint at
//! high frequency; forwarding every chunk makes xterm.js flicker. We coalesce
//! bytes into frames and let a ~16ms flusher drain them, so a burst of repaints
//! collapses into one write to the renderer.
//!
//! This type is intentionally timing-free and pure, so it is unit-testable;
//! the 16ms cadence lives in the flusher thread in `pty.rs`.

/// Accumulates PTY bytes and yields them as a single coalesced frame.
pub struct FrameBatcher {
    buf: Vec<u8>,
    /// Force a flush when the buffer reaches this size, bounding latency under
    /// heavy output instead of waiting for the next tick.
    max_bytes: usize,
}

impl FrameBatcher {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            buf: Vec::new(),
            max_bytes,
        }
    }

    /// Append a chunk. Returns true if the buffer is now large enough that the
    /// caller should flush immediately rather than wait for the tick.
    pub fn push(&mut self, chunk: &[u8]) -> bool {
        self.buf.extend_from_slice(chunk);
        self.buf.len() >= self.max_bytes
    }

    /// Take the accumulated frame, if any. Returns None when empty so the
    /// flusher can skip emitting on idle ticks.
    pub fn take_frame(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buf))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_multiple_pushes_into_one_frame() {
        let mut b = FrameBatcher::new(1024);
        assert!(!b.push(b"hel"));
        assert!(!b.push(b"lo"));
        assert_eq!(b.take_frame().as_deref(), Some(&b"hello"[..]));
    }

    #[test]
    fn empty_take_yields_none() {
        let mut b = FrameBatcher::new(1024);
        assert!(b.take_frame().is_none());
    }

    #[test]
    fn signals_flush_when_over_max() {
        let mut b = FrameBatcher::new(4);
        assert!(!b.push(b"ab"));
        assert!(b.push(b"cd")); // now 4 bytes >= max -> flush now
    }

    #[test]
    fn take_resets_buffer() {
        let mut b = FrameBatcher::new(1024);
        b.push(b"x");
        let _ = b.take_frame();
        assert!(b.take_frame().is_none());
    }
}
