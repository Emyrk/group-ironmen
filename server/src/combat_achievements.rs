use crate::auth_middleware::Authenticated;
use crate::error::ApiError;
use actix_web::{get, put, web, HttpResponse};
use chrono::{DateTime, Utc};
use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const SCHEMA_VERSION: u32 = 2;
const LEGACY_SCHEMA_VERSION: u32 = 1;
const MAX_TASKS: usize = 1_000;
const MAX_TASK_ID_EXCLUSIVE: u32 = 21 * 32;
const MAX_ACHIEVEMENT_POINTS: i32 = 10_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum CombatAchievementTaskId {
    Legacy(String),
    Numeric(u32),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAchievementSnapshotInput {
    pub schema_version: u32,
    pub player_name: String,
    pub client_revision: i64,
    pub achievement_points: i32,
    pub completed_task_ids: Vec<CombatAchievementTaskId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAchievementSnapshot {
    pub schema_version: u32,
    pub player_name: String,
    pub client_revision: i64,
    pub achievement_points: i32,
    pub completed_task_ids: Vec<CombatAchievementTaskId>,
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

fn valid_legacy_task_id(task_id: &str) -> bool {
    task_id.starts_with("CA_TASK_")
        && task_id.ends_with("_COMPLETED")
        && task_id.len() > "CA_TASK__COMPLETED".len()
        && task_id.bytes().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == b'_'
        })
}

fn valid_task_id(schema_version: u32, task_id: &CombatAchievementTaskId) -> bool {
    match (schema_version, task_id) {
        (LEGACY_SCHEMA_VERSION, CombatAchievementTaskId::Legacy(task_id)) => {
            valid_legacy_task_id(task_id)
        }
        (SCHEMA_VERSION, CombatAchievementTaskId::Numeric(task_id)) => {
            *task_id < MAX_TASK_ID_EXCLUSIVE
        }
        _ => false,
    }
}

fn stored_task_ids(task_ids: &[CombatAchievementTaskId]) -> Vec<String> {
    task_ids
        .iter()
        .map(|task_id| match task_id {
            CombatAchievementTaskId::Legacy(task_id) => task_id.clone(),
            CombatAchievementTaskId::Numeric(task_id) => task_id.to_string(),
        })
        .collect()
}

fn response_task_ids(schema_version: u32, task_ids: Vec<String>) -> Vec<CombatAchievementTaskId> {
    task_ids
        .into_iter()
        .map(|task_id| {
            if schema_version == SCHEMA_VERSION {
                CombatAchievementTaskId::Numeric(
                    task_id
                        .parse()
                        .expect("validated numeric Combat Achievement task ID"),
                )
            } else {
                CombatAchievementTaskId::Legacy(task_id)
            }
        })
        .collect()
}

fn validate_snapshot(snapshot: &CombatAchievementSnapshotInput) -> Result<String, HttpResponse> {
    if ![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].contains(&snapshot.schema_version) {
        return Err(HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "unsupported_schema_version"})));
    }
    let normalized_name = normalize_player_name(&snapshot.player_name);
    if normalized_name.is_empty()
        || normalized_name.len() > 12
        || snapshot.client_revision < 0
        || !(0..=MAX_ACHIEVEMENT_POINTS).contains(&snapshot.achievement_points)
    {
        return Err(HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "invalid_combat_achievement_snapshot"})));
    }
    if snapshot.completed_task_ids.len() > MAX_TASKS
        || snapshot
            .completed_task_ids
            .iter()
            .any(|task_id| !valid_task_id(snapshot.schema_version, task_id))
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

    let stored_task_ids = stored_task_ids(&snapshot.completed_task_ids);
    let row = client
        .query_opt(
            r#"
INSERT INTO groupironman.combat_achievement_snapshots
  (group_id, normalized_player_name, player_name, schema_version, client_revision, achievement_points, completed_task_ids, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
ON CONFLICT (group_id, normalized_player_name) DO UPDATE SET
  player_name=EXCLUDED.player_name,
  schema_version=EXCLUDED.schema_version,
  client_revision=EXCLUDED.client_revision,
  achievement_points=EXCLUDED.achievement_points,
  completed_task_ids=EXCLUDED.completed_task_ids,
  updated_at=NOW()
WHERE groupironman.combat_achievement_snapshots.client_revision <= EXCLUDED.client_revision
RETURNING player_name,schema_version,client_revision,achievement_points,completed_task_ids,updated_at
"#,
            &[
                &auth.group_id,
                &normalized_name,
                &member_name,
                &(snapshot.schema_version as i32),
                &snapshot.client_revision,
                &snapshot.achievement_points,
                &stored_task_ids,
            ],
        )
        .await?;
    let Some(row) = row else {
        return Ok(
            HttpResponse::Conflict().json(serde_json::json!({"error": "stale_client_revision"}))
        );
    };
    let schema_version = row.try_get::<_, i32>("schema_version")? as u32;
    let completed_task_ids = response_task_ids(schema_version, row.try_get("completed_task_ids")?);
    Ok(HttpResponse::Ok().json(CombatAchievementSnapshot {
        schema_version,
        player_name: row.try_get("player_name")?,
        client_revision: row.try_get("client_revision")?,
        achievement_points: row.try_get("achievement_points")?,
        completed_task_ids,
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
SELECT player_name,schema_version,client_revision,achievement_points,completed_task_ids,updated_at
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
            let schema_version = row.try_get::<_, i32>("schema_version")? as u32;
            let completed_task_ids =
                response_task_ids(schema_version, row.try_get("completed_task_ids")?);
            Ok(CombatAchievementSnapshot {
                schema_version,
                player_name: row.try_get("player_name")?,
                client_revision: row.try_get("client_revision")?,
                achievement_points: row.try_get("achievement_points")?,
                completed_task_ids,
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
            achievement_points: 321,
            completed_task_ids: vec![CombatAchievementTaskId::Legacy(
                "CA_TASK_BARROWS_CHAMPION_COMPLETED".to_owned(),
            )],
        };
        assert!(validate_snapshot(&valid).is_ok());
    }

    #[test]
    fn validates_numeric_v2_snapshot_contract() {
        let valid = CombatAchievementSnapshotInput {
            schema_version: 2,
            player_name: "Alice".to_owned(),
            client_revision: 240,
            achievement_points: 45,
            completed_task_ids: vec![
                CombatAchievementTaskId::Numeric(521),
                CombatAchievementTaskId::Numeric(525),
            ],
        };
        assert!(validate_snapshot(&valid).is_ok());
    }
}
