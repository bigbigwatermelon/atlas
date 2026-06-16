//! lead_chat::sentinels::extract_sentinels — pulls `<atlas:action_card>{...}`
//! markers out of assistant text so the engine can persist action_card rows.
use atlas_app_lib::lead_chat::sentinels::{extract_sentinels, Sentinel};

#[test]
fn extracts_action_card() {
    let t = "前置 <atlas:action_card>{\"title\":\"T\",\"actions\":[]}</atlas:action_card> 后续";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean.trim(), "前置  后续");
    assert_eq!(found.len(), 1);
    match &found[0] {
        Sentinel::ActionCard(json) => assert!(json.contains("\"title\":\"T\"")),
    }
}

#[test]
fn unknown_atlas_marker_is_plain_text() {
    let t = "before <atlas:legacy/> after";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, t);
    assert!(found.is_empty());
}

#[test]
fn ignores_unknown() {
    let t = "no sentinels <foo:bar/>";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, t);
    assert!(found.is_empty());
}

#[test]
fn extracts_multiple_mixed() {
    let t = "<atlas:action_card>{\"a\":1}</atlas:action_card><atlas:legacy/>";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean.trim(), "<atlas:legacy/>");
    assert_eq!(found.len(), 1);
    assert!(matches!(found[0], Sentinel::ActionCard(_)));
}

#[test]
fn handles_no_sentinel() {
    let t = "plain assistant message";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, t);
    assert!(found.is_empty());
}

#[test]
fn skips_malformed_action_card_unclosed() {
    // 没有 closing tag，整段保持原样、不当作 sentinel
    let t = "before <atlas:action_card>{\"a\":1} no close";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, t);
    assert!(found.is_empty());
}

#[test]
fn action_card_json_can_contain_lt() {
    let t = r#"<atlas:action_card>{"title":"a<b","actions":[]}</atlas:action_card>"#;
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, "");
    assert_eq!(found.len(), 1);
    let Sentinel::ActionCard(j) = &found[0];
    assert!(j.contains("a<b"));
}

#[test]
fn sentinel_butting_text_no_whitespace() {
    let t = "hello<atlas:legacy/>world";
    let (clean, found) = extract_sentinels(t);
    assert_eq!(clean, t);
    assert!(found.is_empty());
}
