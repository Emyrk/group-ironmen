use server::combat_achievements::{
    CombatAchievementSnapshot, CombatAchievementSnapshotInput, CombatAchievementSnapshots,
    CombatAchievementTaskId,
};

#[test]
fn plugin_upload_fixture_matches_input_contract() {
    let upload: CombatAchievementSnapshotInput =
        serde_json::from_str(include_str!("fixtures/combat-achievements/v1/upload.json")).unwrap();
    assert_eq!(upload.player_name, "Display Name");
    assert_eq!(upload.client_revision, 123);
    assert_eq!(upload.achievement_points, 321);
}

#[test]
fn frozen_v1_fixtures_match_models() {
    let snapshot: CombatAchievementSnapshot = serde_json::from_str(include_str!(
        "fixtures/combat-achievements/v1/snapshot.json"
    ))
    .unwrap();
    assert_eq!(snapshot.client_revision, 123);
    assert_eq!(snapshot.achievement_points, 321);
    assert_eq!(
        snapshot.completed_task_ids,
        [CombatAchievementTaskId::Legacy(
            "CA_TASK_BARROWS_CHAMPION_COMPLETED".to_owned()
        )]
    );

    let snapshots: CombatAchievementSnapshots = serde_json::from_str(include_str!(
        "fixtures/combat-achievements/v1/snapshots.json"
    ))
    .unwrap();
    assert_eq!(snapshots.schema_version, 1);
    assert_eq!(snapshots.snapshots.len(), 1);
}

#[test]
fn plugin_v2_upload_fixture_matches_numeric_contract() {
    let upload: CombatAchievementSnapshotInput =
        serde_json::from_str(include_str!("fixtures/combat-achievements/v2/upload.json")).unwrap();
    assert_eq!(upload.schema_version, 2);
    assert_eq!(
        upload.completed_task_ids,
        [
            CombatAchievementTaskId::Numeric(521),
            CombatAchievementTaskId::Numeric(523),
            CombatAchievementTaskId::Numeric(525),
        ]
    );
}

#[test]
fn snapshot_rejects_unknown_fields() {
    let mut value: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/combat-achievements/v1/snapshot.json"
    ))
    .unwrap();
    value["accountHash"] = serde_json::json!("not-allowed");
    assert!(serde_json::from_value::<CombatAchievementSnapshot>(value).is_err());
}
