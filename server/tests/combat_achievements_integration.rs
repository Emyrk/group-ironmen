use actix_web::{http::header, test, web, App};
use deadpool_postgres::{ManagerConfig, Pool, RecyclingMethod};
use serde_json::{json, Value};
use server::auth_middleware::{AuthenticateMiddlewareFactory, AuthenticationCache};
use server::{combat_achievements, crypto, db};
use std::env;
use std::sync::Arc;
use tokio_postgres::NoTls;

const GROUP: &str = "combat_achievement_test_group";
const TOKEN: &str = "combat-achievement-test-token";

async fn test_pool() -> Pool {
    let mut config = deadpool_postgres::Config::new();
    config.url = Some(env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required"));
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
    let group_id: i64 = client
        .query_one(
            "INSERT INTO groupironman.groups (group_name,group_token_hash,version) VALUES ($1,$2,2) RETURNING group_id",
            &[&GROUP, &token_hash],
        )
        .await
        .expect("create test group")
        .get(0);
    client
        .execute(
            "INSERT INTO groupironman.members (group_id,member_name) VALUES ($1,$2),($1,$3)",
            &[&group_id, &"Display Name", &"Bob"],
        )
        .await
        .expect("create members");
}

fn authenticated(request: test::TestRequest) -> test::TestRequest {
    request.insert_header((header::AUTHORIZATION, TOKEN))
}

#[actix_web::test]
async fn snapshots_require_membership_and_replace_exactly() {
    let pool = test_pool().await;
    prepare_database(&pool).await;
    let scope = web::scope("/api/group/{group_name}")
        .wrap(AuthenticateMiddlewareFactory::new(Arc::new(
            AuthenticationCache::new(),
        )))
        .service(combat_achievements::get_snapshots)
        .service(combat_achievements::put_snapshot);
    let app = test::init_service(App::new().app_data(web::Data::new(pool)).service(scope)).await;

    let upload = |revision, player_name: &str, achievement_points, completed: Vec<&str>| {
        authenticated(
            test::TestRequest::put()
                .uri(&format!("/api/group/{GROUP}/combat-achievements/snapshot")),
        )
        .set_json(json!({
            "schemaVersion": 1,
            "playerName": player_name,
            "clientRevision": revision,
            "achievementPoints": achievement_points,
            "completedTaskIds": completed,
        }))
        .to_request()
    };

    let response = test::call_service(
        &app,
        upload(
            123,
            " display_name ",
            321,
            vec!["CA_TASK_BARROWS_CHAMPION_COMPLETED"],
        ),
    )
    .await;
    assert_eq!(response.status(), 200);
    let stored: Value = test::read_body_json(response).await;
    assert_eq!(stored["playerName"], "Display Name");
    assert_eq!(stored["achievementPoints"], 321);

    let response = test::call_service(&app, upload(124, "Display Name", 400, vec![])).await;
    assert_eq!(response.status(), 200);
    let response = test::call_service(
        &app,
        authenticated(
            test::TestRequest::get()
                .uri(&format!("/api/group/{GROUP}/combat-achievements/snapshots")),
        )
        .to_request(),
    )
    .await;
    let snapshots: Value = test::read_body_json(response).await;
    assert_eq!(snapshots["snapshots"].as_array().unwrap().len(), 1);
    assert_eq!(snapshots["snapshots"][0]["achievementPoints"], 400);
    assert_eq!(snapshots["snapshots"][0]["completedTaskIds"], json!([]));

    assert_eq!(
        test::call_service(&app, upload(122, "Display Name", 399, vec![]))
            .await
            .status(),
        409
    );
    assert_eq!(
        test::call_service(&app, upload(1, "Mallory", 1, vec![]))
            .await
            .status(),
        400
    );
    assert_eq!(
        test::call_service(&app, upload(125, "Display Name", 10_001, vec![]))
            .await
            .status(),
        400
    );
}
