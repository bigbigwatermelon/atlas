//! Scan assistant text for atlas control sentinels so the engine can fork them
//! out of the timeline body. Pure string scanning — no regex dep, no allocs
//! beyond the cleaned output. One marker today:
//!   `<atlas:action_card>{json}</atlas:action_card>` — assistant proposes a card.
//! Malformed (unclosed) action_card stays inline as plain text so a half-typed
//! sentinel never silently swallows assistant output.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sentinel {
    /// Raw JSON payload (the text between the open and close tags).
    ActionCard(String),
}

const OPEN_AC: &str = "<atlas:action_card>";
const CLOSE_AC: &str = "</atlas:action_card>";

enum Next {
    ActionCard(usize),
}

/// Scan `text` left-to-right; returns the cleaned body (sentinels stripped) and
/// the sentinels in encounter order. Unknown `<…/>` tags and unclosed
/// action_cards are left in the body verbatim.
pub fn extract_sentinels(text: &str) -> (String, Vec<Sentinel>) {
    let mut out = String::with_capacity(text.len());
    let mut found = Vec::new();
    let mut rest = text;
    loop {
        let ac = rest.find(OPEN_AC);
        let next = match ac {
            None => {
                out.push_str(rest);
                break;
            }
            Some(a) => Next::ActionCard(a),
        };
        match next {
            Next::ActionCard(pos) => {
                let after_open = pos + OPEN_AC.len();
                if let Some(close_rel) = rest[after_open..].find(CLOSE_AC) {
                    out.push_str(&rest[..pos]);
                    let json = &rest[after_open..after_open + close_rel];
                    found.push(Sentinel::ActionCard(json.to_string()));
                    rest = &rest[after_open + close_rel + CLOSE_AC.len()..];
                } else {
                    // Unclosed — keep the rest as plain text so a half-typed
                    // sentinel never eats the tail of the assistant message.
                    out.push_str(rest);
                    break;
                }
            }
        }
    }
    (out, found)
}
