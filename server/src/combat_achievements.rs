use crate::auth_middleware::Authenticated;
use crate::error::ApiError;
use actix_web::{get, put, web, HttpResponse};
use chrono::{DateTime, Utc};
use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const SCHEMA_VERSION: u32 = 1;
const MAX_TASKS: usize = 1_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAchievementSnapshotInput {
    pub schema_version: u32,
    pub player_name: String,
    pub client_revision: i64,
    pub completed_task_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAchievementSnapshot {
    pub schema_version: u32,
    pub player_name: String,
    pub client_revision: i64,
    pub completed_task_ids: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAchievementSnapshots {
    pub schema_version: u32,
    pub snapshots: Vec<CombatAchievementSnapshot>,
}

pub fn normalize_player_name(name: &str) -> String {
    name.trim()
        .chars()
        .map(|character| if character == '_' { ' ' } else { character })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn valid_task_id(task_id: &str) -> bool {
    task_id.starts_with("CA_TASK_")
        && task_id.ends_with("_COMPLETED")
        && task_id.len() > "CA_TASK__COMPLETED".len()
        && task_id.bytes().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == b'_'
        })
}

fn validate_snapshot(snapshot: &CombatAchievementSnapshotInput) -> Result<String, HttpResponse> {
    if snapshot.schema_version != SCHEMA_VERSION {
        return Err(HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "unsupported_schema_version"})));
    }
    let normalized_name = normalize_player_name(&snapshot.player_name);
    if normalized_name.is_empty() || normalized_name.len() > 12 || snapshot.client_revision < 0 {
        return Err(HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "invalid_combat_achievement_snapshot"})));
    }
    if snapshot.completed_task_ids.len() > MAX_TASKS
        || snapshot
            .completed_task_ids
            .iter()
            .any(|task_id| !valid_task_id(task_id))
        || snapshot
            .completed_task_ids
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != snapshot.completed_task_ids.len()
    {
        return Err(HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "invalid_combat_achievement_snapshot"})));
    }
    Ok(normalized_name)
}

#[put("/combat-achievements/snapshot")]
pub async fn put_snapshot(
    auth: Authenticated,
    snapshot: web::Json<CombatAchievementSnapshotInput>,
    db_pool: web::Data<Pool>,
) -> Result<HttpResponse, ApiError> {
    let normalized_name = match validate_snapshot(&snapshot) {
        Ok(name) => name,
        Err(response) => return Ok(response),
    };
    let client = db_pool.get().await.map_err(ApiError::PoolError)?;
    let member_rows = client
        .query(
            "SELECT member_name FROM groupironman.members WHERE group_id=$1",
            &[&auth.group_id],
        )
        .await?;
    let member_name = member_rows
        .iter()
        .filter_map(|row| row.try_get::<_, String>(0).ok())
        .find(|name| normalize_player_name(name) == normalized_name);
    let Some(member_name) = member_name else {
        return Ok(
            HttpResponse::BadRequest().json(serde_json::json!({"error": "invalid_player_name"}))
        );
    };

    let row = client
        .query_opt(
            r#"
INSERT INTO groupironman.combat_achievement_snapshots
  (group_id, normalized_player_name, player_name, client_revision, completed_task_ids, updated_at)
VALUES ($1,$2,$3,$4,$5,NOW())
ON CONFLICT (group_id, normalized_player_name) DO UPDATE SET
  player_name=EXCLUDED.player_name,
  client_revision=EXCLUDED.client_revision,
  completed_task_ids=EXCLUDED.completed_task_ids,
  updated_at=NOW()
WHERE groupironman.combat_achievement_snapshots.client_revision <= EXCLUDED.client_revision
RETURNING player_name,client_revision,completed_task_ids,updated_at
"#,
            &[
                &auth.group_id,
                &normalized_name,
                &member_name,
                &snapshot.client_revision,
                &snapshot.completed_task_ids,
            ],
        )
        .await?;
    let Some(row) = row else {
        return Ok(
            HttpResponse::Conflict().json(serde_json::json!({"error": "stale_client_revision"}))
        );
    };
    Ok(HttpResponse::Ok().json(CombatAchievementSnapshot {
        schema_version: SCHEMA_VERSION,
        player_name: row.try_get("player_name")?,
        client_revision: row.try_get("client_revision")?,
        completed_task_ids: row.try_get("completed_task_ids")?,
        updated_at: row.try_get("updated_at")?,
    }))
}

#[get("/combat-achievements/snapshots")]
pub async fn get_snapshots(
    auth: Authenticated,
    db_pool: web::Data<Pool>,
) -> Result<HttpResponse, ApiError> {
    let client = db_pool.get().await.map_err(ApiError::PoolError)?;
    let rows = client
        .query(
            r#"
SELECT player_name,client_revision,completed_task_ids,updated_at
FROM groupironman.combat_achievement_snapshots
WHERE group_id=$1
ORDER BY normalized_player_name
"#,
            &[&auth.group_id],
        )
        .await?;
    let snapshots = rows
        .into_iter()
        .map(|row| {
            Ok(CombatAchievementSnapshot {
                schema_version: SCHEMA_VERSION,
                player_name: row.try_get("player_name")?,
                client_revision: row.try_get("client_revision")?,
                completed_task_ids: row.try_get("completed_task_ids")?,
                updated_at: row.try_get("updated_at")?,
            })
        })
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()?;
    Ok(HttpResponse::Ok().json(CombatAchievementSnapshots {
        schema_version: SCHEMA_VERSION,
        snapshots,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_runescape_names() {
        assert_eq!(normalize_player_name("  Iron__Alice  "), "iron alice");
    }

    #[test]
    fn validates_snapshot_contract() {
        let valid = CombatAchievementSnapshotInput {
            schema_version: 1,
            player_name: "Alice".to_owned(),
            client_revision: 123,
            completed_task_ids: vec!["CA_TASK_BARROWS_CHAMPION_COMPLETED".to_owned()],
        };
        assert!(validate_snapshot(&valid).is_ok());
    }
}
