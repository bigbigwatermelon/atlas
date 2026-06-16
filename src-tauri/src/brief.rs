//! Seed prompt for a dispatched run.
//!
//! A run is generic: it may be coding work, writing, research, ops, or any other
//! task the human wants to delegate. The brief intentionally avoids old delivery
//! workflow assumptions.

use crate::store::{repo, Db};
use anyhow::Result;

/// Render a generic run brief.
pub fn format_generic_brief(task: &str, kind: &str, run: &str, mandate: &str) -> String {
    let mandate = repo::normalize_mandate(mandate);
    let mut s = String::new();
    s.push_str(&format!("# Run: {run}\n\n"));
    s.push_str(&format!("Task ({kind}): {task}\n"));
    s.push_str(
        "\n## Purpose\n\
         Use this run to work with the human on the current task. This is a \
         general agent run in Atlas: do not assume the work is coding work. \
         Keep outputs practical and tied to the requested result.\n",
    );
    s.push_str(
        "\n## Coordinate\n\
         Use the atlas_bus tools to share concise progress updates, read your \
         inbox, and coordinate with any other runs in this thread. Use \
         ask_human when a decision, missing context, or tradeoff belongs to the \
         human.\n",
    );

    if mandate == "impl-only" {
        s.push_str(
            "\n## Status contract\n\
             This run starts in **working**: begin the focused work now. When \
             the requested result is complete, call set_task_status(\"done\"). \
             If the human sends you back for changes, call \
             set_task_status(\"working\") again.\n\n\
             Start now.\n",
        );
    } else {
        s.push_str(
            "\n## Status contract\n\
             This run starts in **planning**: first clarify the approach for \
             this run and post the essentials to the bus. When you move from \
             planning to doing the work, call set_task_status(\"working\"). \
             When the requested result is complete, call \
             set_task_status(\"done\"). If the human sends you back for \
             changes, call set_task_status(\"working\") again.\n\n\
             Start by planning now.\n",
        );
    }
    s
}

/// Gather a direction's generic brief from the DB.
pub async fn assemble(db: &Db, direction_id: i32) -> Result<String> {
    use sea_orm::EntityTrait;
    let dir = crate::store::entities::direction::Entity::find_by_id(direction_id)
        .one(&db.0)
        .await?
        .ok_or_else(|| anyhow::anyhow!("direction not found"))?;
    let thread = repo::get_thread(db, dir.thread_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("thread not found"))?;

    Ok(format_generic_brief(
        &thread.title,
        &thread.kind,
        &dir.name,
        repo::normalize_mandate(&dir.mandate),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_impl_run_brief_is_generic() {
        let s = format_generic_brief("Draft offer email", "task", "Main run", "plan+impl");
        assert!(s.contains("# Run: Main run"));
        assert!(s.contains("Task (task): Draft offer email"));
        assert!(s.contains("Use this run to work with the human"));
        assert!(s.contains("starts in **planning**"));
        assert!(s.contains("set_task_status(\"working\")"));
        assert!(s.contains("set_task_status(\"done\")"));
        assert!(s.contains("Start by planning now."));
    }

    #[test]
    fn impl_only_run_brief_skips_planning() {
        let s = format_generic_brief("Send a reply", "task", "Main run", "impl-only");
        assert!(s.contains("starts in **working**"));
        assert!(s.contains("set_task_status(\"done\")"));
        assert!(s.contains("Start now."));
        assert!(!s.contains("Start by planning now."));
    }
}
