use server::inventory_setups::{
    canonical_object, parse_entity_id, InventorySetup, InventorySetupManifest,
    InventorySetupSection,
};

#[test]
fn frozen_v1_fixtures_match_models() {
    let setup: InventorySetup =
        serde_json::from_str(include_str!("fixtures/inventory-setups/v1/setup.json")).unwrap();
    assert_eq!(setup.revision, 7);
    assert!(setup.payload.is_object());

    let tombstone: InventorySetup = serde_json::from_str(include_str!(
        "fixtures/inventory-setups/v1/setup-tombstone.json"
    ))
    .unwrap();
    assert!(tombstone.deleted);
    assert_eq!(tombstone.payload, serde_json::json!({}));

    let section: InventorySetupSection =
        serde_json::from_str(include_str!("fixtures/inventory-setups/v1/section.json")).unwrap();
    assert_eq!(section.display_color, Some(-65536));
    assert_eq!(section.ordered_setup_ids.len(), 1);

    let manifest: InventorySetupManifest =
        serde_json::from_str(include_str!("fixtures/inventory-setups/v1/manifest.json")).unwrap();
    assert_eq!(manifest.group_revision, 42);
    assert_eq!(manifest.setup_order_revision, 4);
    assert_eq!(manifest.section_order_revision, 2);
}

#[test]
fn documents_serialize_with_only_protocol_fields() {
    let setup: InventorySetup =
        serde_json::from_str(include_str!("fixtures/inventory-setups/v1/setup.json")).unwrap();
    let keys = serde_json::to_value(setup)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        keys,
        [
            "deleted",
            "name",
            "notes",
            "payload",
            "revision",
            "schemaVersion",
            "setupId",
            "updatedAt",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    );

    let section: InventorySetupSection =
        serde_json::from_str(include_str!("fixtures/inventory-setups/v1/section.json")).unwrap();
    let keys = serde_json::to_value(section)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        keys,
        [
            "deleted",
            "displayColor",
            "name",
            "orderedSetupIds",
            "revision",
            "schemaVersion",
            "sectionId",
            "updatedAt",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    );
}

#[test]
fn ids_are_lowercase_uuid_v4() {
    assert!(parse_entity_id("5e4a8e36-e5f4-4daa-ae7a-e510f3e66721").is_ok());
    assert!(parse_entity_id("5E4A8E36-E5F4-4DAA-AE7A-E510F3E66721").is_err());
    assert!(parse_entity_id("00000000-0000-0000-0000-000000000000").is_err());
}

#[test]
fn payloads_are_objects_and_canonicalized() {
    let canonical = canonical_object(serde_json::json!({"z": 1, "a": {"d": 2, "b": 1}})).unwrap();
    assert_eq!(
        serde_json::to_string(&canonical).unwrap(),
        r#"{"a":{"b":1,"d":2},"z":1}"#
    );
    assert!(canonical_object(serde_json::json!([1, 2, 3])).is_err());
}

#[test]
fn section_rejects_is_maximized_and_duplicate_membership() {
    let fixture = include_str!("fixtures/inventory-setups/v1/section.json");
    let with_local_field = fixture.replace(
        "\"displayColor\": -65536,",
        "\"displayColor\": -65536, \"isMaximized\": true,",
    );
    assert!(serde_json::from_str::<InventorySetupSection>(&with_local_field).is_err());

    let mut section: InventorySetupSection = serde_json::from_str(fixture).unwrap();
    section
        .ordered_setup_ids
        .push(section.ordered_setup_ids[0].clone());
    assert!(section.validate_membership().is_err());
}
