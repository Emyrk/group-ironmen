use crate::auth_middleware::Authenticated;
use crate::error::ApiError;
use actix_web::{delete, get, http::header, put, web, Error, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use deadpool_postgres::{Client, GenericClient, Pool, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tokio_postgres::Row;
use uuid::{Uuid, Version};

const SCHEMA_VERSION: i32 = 1;
const MAX_ITEMS: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BankTag {
    pub schema_version: i32,
    #[serde(default)]
    pub tag_id: Option<String>,
    pub name: String,
    pub icon_item_id: i32,
    pub item_ids: Vec<i32>,
    pub layout: Option<Vec<i32>>,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BankTagMetadata {
    pub tag_id: String,
    pub name: String,
    pub revision: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BankTagManifest {
    pub schema_version: i32,
    pub group_revision: i64,
    pub order_revision: i64,
    pub ordered_tag_ids: Vec<String>,
    pub tags: Vec<BankTagMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BankTagOrderRequest {
    pub schema_version: i32,
    pub ordered_tag_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct BankTagErrorBody {
    error: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<Value>,
}

#[derive(Debug)]
enum BankTagError {
    UnsupportedSchema,
    InvalidTagId(String),
    InvalidTag(String),
    InvalidOrder(String),
    DuplicateName(BankTagMetadata),
    TagExists(BankTagMetadata),
    TagNotFound,
    StaleTagRevision {
        expected: i64,
        current: BankTagMetadata,
    },
    StaleOrderRevision(BankTagManifest),
    PreconditionRequired,
    PayloadTooLarge,
    Database(ApiError),
}

impl From<ApiError> for BankTagError {
    fn from(value: ApiError) -> Self {
        Self::Database(value)
    }
}

impl From<tokio_postgres::Error> for BankTagError {
    fn from(value: tokio_postgres::Error) -> Self {
        Self::Database(ApiError::PGError(value))
    }
}

impl BankTagError {
    fn response(self) -> HttpResponse {
        let (status, error, message, current) = match self {
            Self::UnsupportedSchema => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "unsupported_schema",
                "schemaVersion must be 1".to_owned(),
                None,
            ),
            Self::InvalidTagId(message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_tag_id",
                message,
                None,
            ),
            Self::InvalidTag(message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_tag",
                message,
                None,
            ),
            Self::InvalidOrder(message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_order",
                message,
                None,
            ),
            Self::DuplicateName(current) => (
                actix_web::http::StatusCode::CONFLICT,
                "duplicate_name",
                format!(
                    "a non-deleted tag named \"{}\" already exists in this group",
                    current.name
                ),
                serde_json::to_value(current).ok(),
            ),
            Self::TagExists(current) => (
                actix_web::http::StatusCode::CONFLICT,
                "tag_exists",
                "tag id already exists in this group".to_owned(),
                serde_json::to_value(current).ok(),
            ),
            Self::TagNotFound => (
                actix_web::http::StatusCode::NOT_FOUND,
                "tag_not_found",
                "tag was not found in this group".to_owned(),
                None,
            ),
            Self::StaleTagRevision { expected, current } => (
                actix_web::http::StatusCode::CONFLICT,
                "stale_revision",
                format!(
                    "tag revision {expected} is stale; current is {}",
                    current.revision
                ),
                serde_json::to_value(current).ok(),
            ),
            Self::StaleOrderRevision(current) => (
                actix_web::http::StatusCode::CONFLICT,
                "stale_revision",
                "bank tag order revision is stale".to_owned(),
                serde_json::to_value(current).ok(),
            ),
            Self::PreconditionRequired => (
                actix_web::http::StatusCode::PRECONDITION_REQUIRED,
                "precondition_required",
                "If-Match or If-None-Match is required".to_owned(),
                None,
            ),
            Self::PayloadTooLarge => (
                actix_web::http::StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body exceeds 100000 bytes".to_owned(),
                None,
            ),
            Self::Database(error) => return actix_web::ResponseError::error_response(&error),
        };
        HttpResponse::build(status).json(BankTagErrorBody {
            error,
            message,
            current,
        })
    }
}

fn json_body<T>(
    body: Result<web::Json<T>, Error>,
    invalid: impl FnOnce() -> BankTagError,
) -> Result<T, BankTagError> {
    body.map(web::Json::into_inner).map_err(|error| {
        if error.as_response_error().status_code() == actix_web::http::StatusCode::PAYLOAD_TOO_LARGE
        {
            BankTagError::PayloadTooLarge
        } else {
            invalid()
        }
    })
}

fn parse_tag_id(value: &str) -> Result<Uuid, BankTagError> {
    let id = Uuid::parse_str(value)
        .map_err(|_| BankTagError::InvalidTagId("tag id must be a lowercase UUID v4".to_owned()))?;
    if id.get_version() != Some(Version::Random) || id.hyphenated().to_string() != value {
        return Err(BankTagError::InvalidTagId(
            "tag id must be a lowercase UUID v4".to_owned(),
        ));
    }
    Ok(id)
}

fn parse_etag(value: &str) -> Option<i64> {
    value.strip_prefix('"')?.strip_suffix('"')?.parse().ok()
}

fn request_etag(req: &HttpRequest, name: header::HeaderName) -> Option<i64> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_etag)
}

fn validate_tag(path_id: Uuid, mut tag: BankTag) -> Result<BankTag, BankTagError> {
    if tag.schema_version != SCHEMA_VERSION {
        return Err(BankTagError::UnsupportedSchema);
    }
    if let Some(body_id) = &tag.tag_id {
        if parse_tag_id(body_id)? != path_id {
            return Err(BankTagError::InvalidTagId(
                "body tagId must match the path id".to_owned(),
            ));
        }
    }
    tag.name = tag.name.trim().to_lowercase();
    if tag.name.is_empty()
        || tag.name.chars().count() > 50
        || tag
            .name
            .chars()
            .any(|c| matches!(c, '<' | '/' | '>' | ':' | ','))
    {
        return Err(BankTagError::InvalidTag(
            "name must be 1-50 characters and cannot contain <, /, >, :, or ,".to_owned(),
        ));
    }
    if tag.icon_item_id < 0 {
        return Err(BankTagError::InvalidTag(
            "iconItemId must be non-negative".to_owned(),
        ));
    }
    if tag.item_ids.len() > MAX_ITEMS
        || tag.item_ids.contains(&0)
        || tag.item_ids.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(BankTagError::InvalidTag("itemIds must be sorted ascending without duplicates, contain no zero, and have at most 4000 entries".to_owned()));
    }
    if tag.layout.as_ref().is_some_and(|layout| {
        layout.len() > MAX_ITEMS || layout.iter().any(|id| *id < -1 || *id == 0)
    }) {
        return Err(BankTagError::InvalidTag(
            "layout entries must be -1 or positive and have at most 4000 entries".to_owned(),
        ));
    }
    tag.tag_id = Some(path_id.hyphenated().to_string());
    Ok(tag)
}

fn row_metadata(row: &Row) -> Result<BankTagMetadata, BankTagError> {
    let id: Uuid = row.try_get("tag_id")?;
    Ok(BankTagMetadata {
        tag_id: id.hyphenated().to_string(),
        name: row.try_get("name")?,
        revision: row.try_get("revision")?,
        deleted: row
            .try_get::<_, Option<DateTime<Utc>>>("deleted_at")?
            .is_some(),
    })
}

fn row_tag(row: &Row) -> Result<BankTag, BankTagError> {
    let metadata = row_metadata(row)?;
    let deleted = metadata.deleted;
    Ok(BankTag {
        schema_version: SCHEMA_VERSION,
        tag_id: Some(metadata.tag_id),
        name: metadata.name,
        icon_item_id: row.try_get("icon_item_id")?,
        item_ids: if deleted {
            Vec::new()
        } else {
            row.try_get("item_ids")?
        },
        layout: if deleted {
            None
        } else {
            row.try_get("layout")?
        },
        revision: metadata.revision,
        deleted,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn ensure_and_lock_group<'a>(
    transaction: &'a Transaction<'a>,
    group_id: i64,
) -> Result<Row, BankTagError> {
    transaction.execute(
        "INSERT INTO groupironman.bank_tag_groups (group_id, updated_at) VALUES ($1, NOW()) ON CONFLICT (group_id) DO NOTHING",
        &[&group_id],
    ).await?;
    Ok(transaction.query_one(
        "SELECT group_revision, order_revision, ordered_tag_ids FROM groupironman.bank_tag_groups WHERE group_id=$1 FOR UPDATE",
        &[&group_id],
    ).await?)
}

async fn load_manifest(
    client: &impl GenericClient,
    group_id: i64,
) -> Result<BankTagManifest, BankTagError> {
    let group = client.query_opt(
        "SELECT group_revision, order_revision, ordered_tag_ids FROM groupironman.bank_tag_groups WHERE group_id=$1",
        &[&group_id],
    ).await?;
    let (group_revision, order_revision, ordered_ids): (i64, i64, Vec<Uuid>) = match group {
        Some(row) => (row.try_get(0)?, row.try_get(1)?, row.try_get(2)?),
        None => (0, 0, Vec::new()),
    };
    let rows = client.query(
        "SELECT tag_id, name, revision, deleted_at FROM groupironman.bank_tags WHERE group_id=$1 ORDER BY tag_id",
        &[&group_id],
    ).await?;
    Ok(BankTagManifest {
        schema_version: SCHEMA_VERSION,
        group_revision,
        order_revision,
        ordered_tag_ids: ordered_ids
            .into_iter()
            .map(|id| id.hyphenated().to_string())
            .collect(),
        tags: rows.iter().map(row_metadata).collect::<Result<_, _>>()?,
    })
}

async fn find_metadata(
    client: &impl GenericClient,
    group_id: i64,
    tag_id: Uuid,
) -> Result<Option<BankTagMetadata>, BankTagError> {
    let row = client.query_opt(
        "SELECT tag_id, name, revision, deleted_at FROM groupironman.bank_tags WHERE group_id=$1 AND tag_id=$2",
        &[&group_id, &tag_id],
    ).await?;
    row.as_ref().map(row_metadata).transpose()
}

async fn find_live_name(
    client: &impl GenericClient,
    group_id: i64,
    name: &str,
    except: Option<Uuid>,
) -> Result<Option<BankTagMetadata>, BankTagError> {
    let row = client.query_opt(
        "SELECT tag_id, name, revision, deleted_at FROM groupironman.bank_tags WHERE group_id=$1 AND name=$2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR tag_id<>$3)",
        &[&group_id, &name, &except],
    ).await?;
    row.as_ref().map(row_metadata).transpose()
}

#[get("/bank-tags")]
pub async fn get_manifest(
    auth: Authenticated,
    req: HttpRequest,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let client = pool.get().await.map_err(ApiError::PoolError)?;
        let manifest = load_manifest(&client, auth.group_id).await?;
        if request_etag(&req, header::IF_NONE_MATCH) == Some(manifest.group_revision) {
            return Ok(HttpResponse::NotModified().finish());
        }
        Ok(HttpResponse::Ok()
            .insert_header((header::ETAG, format!("\"{}\"", manifest.group_revision)))
            .json(manifest))
    }
    .await;
    result.unwrap_or_else(BankTagError::response)
}

#[get("/bank-tags/{tag_id}")]
pub async fn get_tag(
    auth: Authenticated,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let tag_id = parse_tag_id(&path)?;
        let client = pool.get().await.map_err(ApiError::PoolError)?;
        let row = client.query_opt(
            "SELECT tag_id, name, icon_item_id, item_ids, layout, revision, deleted_at, updated_at FROM groupironman.bank_tags WHERE group_id=$1 AND tag_id=$2",
            &[&auth.group_id, &tag_id],
        ).await?;
        let tag = row.as_ref().map(row_tag).transpose()?.ok_or(BankTagError::TagNotFound)?;
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", tag.revision))).json(tag))
    }.await;
    result.unwrap_or_else(BankTagError::response)
}

#[put("/bank-tags/{tag_id}")]
pub async fn put_tag(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    body: Result<web::Json<BankTag>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let tag_id = parse_tag_id(&path)?;
        let tag = validate_tag(
            tag_id,
            json_body(body, || {
                BankTagError::InvalidTag("request body is not a valid bank tag document".to_owned())
            })?,
        )?;
        let create = req.headers().get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some("*");
        let expected = request_etag(&req, header::IF_MATCH);
        if !create && expected.is_none() {
            return Err(BankTagError::PreconditionRequired);
        }
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let mut order: Vec<Uuid> = group.try_get("ordered_tag_ids")?;
        let existing = find_metadata(&transaction, auth.group_id, tag_id).await?;
        if create {
            if let Some(current) = existing { return Err(BankTagError::TagExists(current)); }
        } else {
            let current = existing.ok_or(BankTagError::TagNotFound)?;
            if current.revision != expected.unwrap() {
                return Err(BankTagError::StaleTagRevision { expected: expected.unwrap(), current });
            }
        }
        if let Some(current) = find_live_name(&transaction, auth.group_id, &tag.name, Some(tag_id)).await? {
            return Err(BankTagError::DuplicateName(current));
        }
        let revision = if create { 1 } else { expected.unwrap() + 1 };
        let row = if create {
            order.push(tag_id);
            transaction.query_one(
                "INSERT INTO groupironman.bank_tags (tag_id, group_id, name, icon_item_id, item_ids, layout, revision, deleted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NOW()) RETURNING tag_id,name,icon_item_id,item_ids,layout,revision,deleted_at,updated_at",
                &[&tag_id, &auth.group_id, &tag.name, &tag.icon_item_id, &tag.item_ids, &tag.layout, &revision],
            ).await?
        } else {
            transaction.query_one(
                "UPDATE groupironman.bank_tags SET name=$3, icon_item_id=$4, item_ids=$5, layout=$6, revision=$7, deleted_at=NULL, updated_at=NOW() WHERE group_id=$1 AND tag_id=$2 RETURNING tag_id,name,icon_item_id,item_ids,layout,revision,deleted_at,updated_at",
                &[&auth.group_id, &tag_id, &tag.name, &tag.icon_item_id, &tag.item_ids, &tag.layout, &revision],
            ).await?
        };
        if create {
            transaction.execute("UPDATE groupironman.bank_tag_groups SET group_revision=group_revision+1, order_revision=order_revision+1, ordered_tag_ids=$2, updated_at=NOW() WHERE group_id=$1", &[&auth.group_id, &order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.bank_tag_groups SET group_revision=group_revision+1, updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_tag(&row)?;
        let status = if create { actix_web::http::StatusCode::CREATED } else { actix_web::http::StatusCode::OK };
        Ok(HttpResponse::build(status).insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(BankTagError::response)
}

#[delete("/bank-tags/{tag_id}")]
pub async fn delete_tag(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let tag_id = parse_tag_id(&path)?;
        let expected = request_etag(&req, header::IF_MATCH).ok_or(BankTagError::PreconditionRequired)?;
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let current = find_metadata(&transaction, auth.group_id, tag_id).await?.ok_or(BankTagError::TagNotFound)?;
        if current.revision != expected {
            return Err(BankTagError::StaleTagRevision { expected, current });
        }
        let revision = expected + 1;
        let row = transaction.query_one(
            "UPDATE groupironman.bank_tags SET item_ids='{}', layout=NULL, revision=$3, deleted_at=COALESCE(deleted_at,NOW()), updated_at=NOW() WHERE group_id=$1 AND tag_id=$2 RETURNING tag_id,name,icon_item_id,item_ids,layout,revision,deleted_at,updated_at",
            &[&auth.group_id, &tag_id, &revision],
        ).await?;
        let mut order: Vec<Uuid> = group.try_get("ordered_tag_ids")?;
        let old_len = order.len();
        order.retain(|id| *id != tag_id);
        if order.len() != old_len {
            transaction.execute("UPDATE groupironman.bank_tag_groups SET group_revision=group_revision+1, order_revision=order_revision+1, ordered_tag_ids=$2, updated_at=NOW() WHERE group_id=$1", &[&auth.group_id, &order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.bank_tag_groups SET group_revision=group_revision+1, updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_tag(&row)?;
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(BankTagError::response)
}

#[put("/bank-tag-order")]
pub async fn put_order(
    auth: Authenticated,
    req: HttpRequest,
    body: Result<web::Json<BankTagOrderRequest>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let body = json_body(body, || {
            BankTagError::InvalidOrder("request body is not a valid bank tag order".to_owned())
        })?;
        if body.schema_version != SCHEMA_VERSION { return Err(BankTagError::UnsupportedSchema); }
        let expected = request_etag(&req, header::IF_MATCH).ok_or(BankTagError::PreconditionRequired)?;
        let ids = body.ordered_tag_ids.iter().map(|id| parse_tag_id(id)).collect::<Result<Vec<_>, _>>()?;
        let unique: HashSet<_> = ids.iter().copied().collect();
        if unique.len() != ids.len() { return Err(BankTagError::InvalidOrder("orderedTagIds contains duplicates".to_owned())); }
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let current_revision: i64 = group.try_get("order_revision")?;
        if current_revision != expected {
            return Err(BankTagError::StaleOrderRevision(load_manifest(&transaction, auth.group_id).await?));
        }
        let rows = transaction.query("SELECT tag_id FROM groupironman.bank_tags WHERE group_id=$1 AND deleted_at IS NULL", &[&auth.group_id]).await?;
        let live: HashSet<Uuid> = rows.iter().map(|row| row.try_get(0)).collect::<Result<_, _>>()?;
        if unique != live { return Err(BankTagError::InvalidOrder("orderedTagIds must be a permutation of all non-deleted tag ids".to_owned())); }
        transaction.execute("UPDATE groupironman.bank_tag_groups SET group_revision=group_revision+1, order_revision=order_revision+1, ordered_tag_ids=$2, updated_at=NOW() WHERE group_id=$1", &[&auth.group_id, &ids]).await?;
        let manifest = load_manifest(&transaction, auth.group_id).await?;
        transaction.commit().await?;
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", manifest.order_revision))).json(manifest))
    }.await;
    result.unwrap_or_else(BankTagError::response)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_tag() -> BankTag {
        BankTag {
            schema_version: 1,
            tag_id: None,
            name: " Herblore ".to_owned(),
            icon_item_id: 952,
            item_ids: vec![-203, 199, 201],
            layout: Some(vec![199, -1, 201]),
            revision: 99,
            deleted: true,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn frozen_v1_fixtures_match_models() {
        let tag: BankTag =
            serde_json::from_str(include_str!("../tests/fixtures/sync/v1/tag.json")).unwrap();
        assert_eq!(tag.schema_version, 1);
        assert_eq!(tag.revision, 7);
        assert_eq!(tag.item_ids, vec![199, 201, -203]);

        let tombstone: BankTag =
            serde_json::from_str(include_str!("../tests/fixtures/sync/v1/tag-tombstone.json"))
                .unwrap();
        assert!(tombstone.deleted);
        assert!(tombstone.item_ids.is_empty());
        assert!(tombstone.layout.is_none());

        let manifest: BankTagManifest =
            serde_json::from_str(include_str!("../tests/fixtures/sync/v1/manifest.json")).unwrap();
        assert_eq!(manifest.group_revision, 42);
        assert_eq!(manifest.order_revision, 3);
        assert_eq!(manifest.tags.len(), 2);

        let order: BankTagOrderRequest =
            serde_json::from_str(include_str!("../tests/fixtures/sync/v1/order-request.json"))
                .unwrap();
        assert_eq!(order.ordered_tag_ids.len(), 2);
    }

    #[test]
    fn validates_and_normalizes_tag_documents() {
        let id = Uuid::parse_str("5e4a8e36-e5f4-4daa-ae7a-e510f3e66721").unwrap();
        let tag = validate_tag(id, valid_tag()).unwrap();
        assert_eq!(tag.name, "herblore");
        assert_eq!(
            tag.tag_id.as_deref(),
            Some("5e4a8e36-e5f4-4daa-ae7a-e510f3e66721")
        );
    }

    #[test]
    fn rejects_invalid_item_and_layout_values() {
        let id = Uuid::new_v4();
        let mut tag = valid_tag();
        tag.item_ids = vec![1, 1];
        assert!(matches!(
            validate_tag(id, tag),
            Err(BankTagError::InvalidTag(_))
        ));
        let mut tag = valid_tag();
        tag.layout = Some(vec![-2]);
        assert!(matches!(
            validate_tag(id, tag),
            Err(BankTagError::InvalidTag(_))
        ));
    }

    #[test]
    fn requires_lowercase_uuid_v4_ids() {
        assert!(parse_tag_id("5E4A8E36-E5F4-4DAA-AE7A-E510F3E66721").is_err());
        assert!(parse_tag_id("00000000-0000-0000-0000-000000000000").is_err());
        assert!(parse_tag_id("5e4a8e36-e5f4-4daa-ae7a-e510f3e66721").is_ok());
    }

    #[test]
    fn parses_only_quoted_decimal_etags() {
        assert_eq!(parse_etag("\"7\""), Some(7));
        assert_eq!(parse_etag("7"), None);
        assert_eq!(parse_etag("W/\"7\""), None);
    }
}
