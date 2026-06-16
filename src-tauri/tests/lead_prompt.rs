use atlas_app_lib::lead_chat::commands::lead_prompt;

#[test]
fn lead_prompt_is_generic_agent_app_copy() {
    let prompt = lead_prompt();
    assert!(prompt.contains("local Agent App"));
    assert!(prompt.contains("get_task"));
    assert!(prompt.contains("directly in chat"));
    assert!(prompt.contains("general task and agent conversation base"));
    assert!(!prompt.contains("ask_human"));
}
