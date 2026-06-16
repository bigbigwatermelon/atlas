use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "direction")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub thread_id: i32,
    pub name: String,
    pub slug: String,
    pub tool: String,
    /// Agent/human-driven lifecycle: queued | planning | working | done.
    /// Reversible; atlas never forces it (an open ask overlays Needs-you in the UI).
    #[sea_orm(default_value = "queued")]
    pub status: String,
    /// Worker mandate, assigned with the role: "plan+impl" (plan its own
    /// direction first, then build) or "impl-only" (build straight away).
    /// The brief renders per-mandate.
    #[sea_orm(default_value = "plan+impl")]
    pub mandate: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
