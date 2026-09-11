use actix_web::{http::header, test, web, App};
use deadpool_postgres::{ManagerConfig, Pool, RecyclingMethod};
use serde_json::{json, Value};
use server::auth_middleware::{AuthenticateMiddlewareFactory, AuthenticationCache};
use server::{crypto, db, inventory_setups};
use std::env;
use std::sync::Arc;
use tokio_postgres::NoTls;

const GROUP: &str = "inventory_test_group";
const TOKEN: &str = "inventory-test-token";
const SETUP_ID: &str = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
const SECOND_SETUP_ID: &str = "f40c4538-b158-4c1c-9c8a-7d930886bc96";
const SECTION_ID: &str = "874dfb26-63b8-42f1-80a2-01a2a7c7779d";
const SECOND_SECTION_ID: &str = "a8691e24-56a0-4fb7-bfd1-04feca5b449a";

async fn test_pool() -> Pool {
    let url = env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required");
    let mut config = deadpool_postgres::Config::new();
    config.url = Some(url);
    config.manager = Some(ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    });
    config.create_pool(None, NoTls).expect("create test pool")
}

async fn prepare_database(pool: &Pool) {
    let mut client = pool.get().await.expect("get database client");
    client
        .batch_execute(
            r#"
DROP SCHEMA IF EXISTS groupironman CASCADE;
CREATE SCHEMA groupironman;
CREATE TABLE groupironman.groups(
    group_id BIGSERIAL UNIQUE,
    group_name TEXT NOT NULL,
    group_token_hash CHAR(64) NOT NULL,
    PRIMARY KEY (group_name, group_token_hash)
);
"#,
        )
        .await
        .expect("create base schema");
    db::update_schema(&mut client)
        .await
        .expect("run migrations");
    let token_hash = crypto::token_hash(TOKEN, GROUP);
    client
        .execute(
            "INSERT INTO groupironman.groups (group_name,group_token_hash,version) VALUES ($1,$2,2)",
            &[&GROUP, &token_hash],
        )
        .await
        .expect("create test group");
}

fn authenticated(request: test::TestRequest) -> test::TestRequest {
    request.insert_header((header::AUTHORIZATION, TOKEN))
}

fn setup(id: &str, name: &str) -> Value {
    json!({
        "schemaVersion": 1,
        "setupId": id,
        "name": name,
        "notes": "Shared notes",
        "payload": {"inventory": [385], "equipment": [4151]}
    })
}

fn section(id: &str, name: &str, setup_ids: &[&str]) -> Value {
    json!({
        "schemaVersion": 1,
        "sectionId": id,
        "name": name,
        "displayColor": -65536,
        "orderedSetupIds": setup_ids
    })
}

#[actix_web::test]
async fn postgres_inventory_setup_protocol_matches_sqlite_contract() {
    let pool = test_pool().await;
    prepare_database(&pool).await;
    let scope = web::scope("/api/group/{group_name}")
        .wrap(AuthenticateMiddlewareFactory::new(Arc::new(
            AuthenticationCache::new(),
        )))
        .service(inventory_setups::get_manifest)
        .service(inventory_setups::get_setup)
        .service(inventory_setups::put_setup)
        .service(inventory_setups::delete_setup)
        .service(inventory_setups::put_setup_order)
        .service(inventory_setups::get_section)
        .service(inventory_setups::put_section)
        .service(inventory_setups::delete_section)
        .service(inventory_setups::put_section_order);
    let app = test::init_service(
        App::new()
            .app_data(web::Data::new(pool))
            .app_data(web::JsonConfig::default().limit(100000))
            .service(scope),
    )
    .await;

    let response = test::call_service(
        &app,
        authenticated(
            test::TestRequest::get().uri(&format!("/api/group/{GROUP}/inventory-setups")),
        )
        .to_request(),
    )
    .await;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers().get(header::ETAG).unwrap(), "\"0\"");
    let manifest: Value = test::read_body_json(response).await;
    assert_eq!(manifest["orderedSetupIds"], json!([]));

    let response = test::call_service(
        &app,
        authenticated(
            test::TestRequest::get().uri(&format!("/api/group/{GROUP}/inventory-setups")),
        )
        .insert_header((header::IF_NONE_MATCH, "\"0\""))
        .to_request(),
    )
    .await;
    assert_eq!(response.status(), 304);
    assert_eq!(response.headers().get(header::ETAG).unwrap(), "\"0\"");

    for (id, name) in [(SETUP_ID, "Vorkath"), (SECOND_SETUP_ID, "Barrows")] {
        let response = test::call_service(
            &app,
            authenticated(
                test::TestRequest::put().uri(&format!("/api/group/{GROUP}/inventory-setups/{id}")),
            )
            .insert_header((header::IF_NONE_MATCH, "*"))
            .set_json(setup(id, name))
            .to_request(),
        )
        .await;
        let status = response.status();
        let etag = response.headers().get(header::ETAG).cloned();
        let body = test::read_body(response).await;
        assert_eq!(
            status,
            201,
            "setup creation response: {}",
            String::from_utf8_lossy(&body)
        );
        assert_eq!(etag.unwrap(), "\"1\"");
    }

    let duplicate = test::call_service(
        &app,
        authenticated(test::TestRequest::put().uri(&format!(
            "/api/group/{GROUP}/inventory-setups/a714e8c9-911b-4a7d-ac2d-351f38156ba8"
        )))
        .insert_header((header::IF_NONE_MATCH, "*"))
        .set_json(setup("a714e8c9-911b-4a7d-ac2d-351f38156ba8", "vOrKaTh"))
        .to_request(),
    )
    .await;
    assert_eq!(duplicate.status(), 409);
    let duplicate_body: Value = test::read_body_json(duplicate).await;
    assert_eq!(duplicate_body["error"], "duplicate_name");

    for (id, name) in [(SECTION_ID, "Bossing"), (SECOND_SECTION_ID, "Favorites")] {
        let response = test::call_service(
            &app,
            authenticated(
                test::TestRequest::put()
                    .uri(&format!("/api/group/{GROUP}/inventory-setup-sections/{id}")),
            )
            .insert_header((header::IF_NONE_MATCH, "*"))
            .set_json(section(id, name, &[SETUP_ID]))
            .to_request(),
        )
        .await;
        assert_eq!(response.status(), 201);
    }

    let stale_order = test::call_service(
        &app,
        authenticated(
            test::TestRequest::put().uri(&format!("/api/group/{GROUP}/inventory-setup-order")),
        )
        .insert_header((header::IF_MATCH, "\"0\""))
        .set_json(json!({
            "schemaVersion": 1,
            "orderedSetupIds": [SECOND_SETUP_ID, SETUP_ID]
        }))
        .to_request(),
    )
    .await;
    assert_eq!(stale_order.status(), 409);

    let deleted = test::call_service(
        &app,
        authenticated(
            test::TestRequest::delete()
                .uri(&format!("/api/group/{GROUP}/inventory-setups/{SETUP_ID}")),
        )
        .insert_header((header::IF_MATCH, "\"1\""))
        .to_request(),
    )
    .await;
    assert_eq!(deleted.status(), 200);
    let deleted: Value = test::read_body_json(deleted).await;
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["payload"], json!({}));

    for id in [SECTION_ID, SECOND_SECTION_ID] {
        let response = test::call_service(
            &app,
            authenticated(
                test::TestRequest::get()
                    .uri(&format!("/api/group/{GROUP}/inventory-setup-sections/{id}")),
            )
            .to_request(),
        )
        .await;
        let section: Value = test::read_body_json(response).await;
        assert_eq!(section["revision"], 2);
        assert_eq!(section["orderedSetupIds"], json!([]));
    }

    let deleted_section = test::call_service(
        &app,
        authenticated(test::TestRequest::delete().uri(&format!(
            "/api/group/{GROUP}/inventory-setup-sections/{SECTION_ID}"
        )))
        .insert_header((header::IF_MATCH, "\"2\""))
        .to_request(),
    )
    .await;
    assert_eq!(deleted_section.status(), 200);

    let preserved_setup = test::call_service(
        &app,
        authenticated(test::TestRequest::get().uri(&format!(
            "/api/group/{GROUP}/inventory-setups/{SECOND_SETUP_ID}"
        )))
        .to_request(),
    )
    .await;
    assert_eq!(preserved_setup.status(), 200);
    let preserved_setup: Value = test::read_body_json(preserved_setup).await;
    assert_eq!(preserved_setup["deleted"], false);
}
