use server::combat_achievements::{
    CombatAchievementSnapshot, CombatAchievementSnapshotInput, CombatAchievementSnapshots,
};

#[test]
fn plugin_upload_fixture_matches_input_contract() {
    let upload: CombatAchievementSnapshotInput =
        serde_json::from_str(include_str!("fixtures/combat-achievements/v1/upload.json")).unwrap();
    assert_eq!(upload.player_name, "Display Name");
    assert_eq!(upload.client_revision, 123);
}

#[test]
fn frozen_v1_fixtures_match_models() {
    let snapshot: CombatAchievementSnapshot = serde_json::from_str(include_str!(
        "fixtures/combat-achievements/v1/snapshot.json"
    ))
    .unwrap();
    assert_eq!(snapshot.client_revision, 123);
    assert_eq!(
        snapshot.completed_task_ids,
        ["CA_TASK_BARROWS_CHAMPION_COMPLETED"]
    );

    let snapshots: CombatAchievementSnapshots = serde_json::from_str(include_str!(
        "fixtures/combat-achievements/v1/snapshots.json"
    ))
    .unwrap();
    assert_eq!(snapshots.schema_version, 1);
    assert_eq!(snapshots.snapshots.len(), 1);
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
