use sea_orm::entity::prelude::*;

/// Issue ↔ IM-thread binding (spec §6). One row per (channel, chat_id, im_thread_ref)
/// or per thread_id (issue can only be bound to one IM thread at a time).
/// `channel` is the IM adapter name ("feishu"); `im_thread_ref` is the platform-
/// specific thread id (飞书 thread_id 字符串)。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "im_route")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub channel: String,
    pub chat_id: String,
    pub im_thread_ref: String,
    /// Issue (thread) id. Unique — each issue maps to at most one IM thread.
    #[sea_orm(unique)]
    pub thread_id: i32,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
