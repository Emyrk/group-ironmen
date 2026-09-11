use crate::auth_middleware::Authenticated;
use crate::error::ApiError;
use actix_web::{delete, get, http::header, put, web, Error, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use deadpool_postgres::{Client, GenericClient, Pool, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use tokio_postgres::Row;
use uuid::{Uuid, Version};

const SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventorySetup {
    pub schema_version: i32,
    #[serde(default)]
    pub setup_id: Option<String>,
    pub name: String,
    pub notes: String,
    pub payload: Value,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

fn deserialize_display_color<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<i32>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventorySetupSection {
    pub schema_version: i32,
    #[serde(default)]
    pub section_id: Option<String>,
    pub name: String,
    #[serde(deserialize_with = "deserialize_display_color")]
    pub display_color: Option<i32>,
    pub ordered_setup_ids: Vec<String>,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

impl InventorySetupSection {
    pub fn validate_membership(&self) -> Result<Vec<Uuid>, String> {
        let ids = self
            .ordered_setup_ids
            .iter()
            .map(|id| parse_entity_id(id))
            .collect::<Result<Vec<_>, _>>()?;
        let unique: HashSet<_> = ids.iter().copied().collect();
        if unique.len() != ids.len() {
            return Err("orderedSetupIds contains duplicates".to_owned());
        }
        Ok(ids)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventorySetupMetadata {
    pub setup_id: String,
    pub name: String,
    pub revision: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventorySetupSectionMetadata {
    pub section_id: String,
    pub name: String,
    pub revision: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventorySetupManifest {
    pub schema_version: i32,
    pub group_revision: i64,
    pub setup_order_revision: i64,
    pub section_order_revision: i64,
    pub ordered_setup_ids: Vec<String>,
    pub ordered_section_ids: Vec<String>,
    pub setups: Vec<InventorySetupMetadata>,
    pub sections: Vec<InventorySetupSectionMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventorySetupOrderRequest {
    pub schema_version: i32,
    pub ordered_setup_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventorySetupSectionOrderRequest {
    pub schema_version: i32,
    pub ordered_section_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ProtocolErrorBody {
    error: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<Value>,
}

#[derive(Debug)]
enum ProtocolError {
    UnsupportedSchema,
    InvalidId(&'static str, String),
    InvalidEntity(&'static str, String),
    InvalidOrder(String),
    DuplicateName(&'static str, Value),
    Exists(&'static str, Value),
    NotFound(&'static str),
    StaleRevision { expected: i64, current: Value },
    StaleOrder(Box<InventorySetupManifest>),
    PreconditionRequired,
    PayloadTooLarge,
    Database(ApiError),
}

impl From<ApiError> for ProtocolError {
    fn from(value: ApiError) -> Self {
        Self::Database(value)
    }
}
impl From<tokio_postgres::Error> for ProtocolError {
    fn from(value: tokio_postgres::Error) -> Self {
        Self::Database(ApiError::PGError(value))
    }
}

impl ProtocolError {
    fn response(self) -> HttpResponse {
        let (status, error, message, current) = match self {
            Self::UnsupportedSchema => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "unsupported_schema",
                "schemaVersion must be 1".to_owned(),
                None,
            ),
            Self::InvalidId(kind, message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                if kind == "setup" {
                    "invalid_setup_id"
                } else {
                    "invalid_section_id"
                },
                message,
                None,
            ),
            Self::InvalidEntity(kind, message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                if kind == "setup" {
                    "invalid_setup"
                } else {
                    "invalid_section"
                },
                message,
                None,
            ),
            Self::InvalidOrder(message) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_order",
                message,
                None,
            ),
            Self::DuplicateName(kind, current) => (
                actix_web::http::StatusCode::CONFLICT,
                "duplicate_name",
                format!("a non-deleted {kind} with this name already exists in this group"),
                Some(current),
            ),
            Self::Exists(kind, current) => (
                actix_web::http::StatusCode::CONFLICT,
                if kind == "setup" {
                    "setup_exists"
                } else {
                    "section_exists"
                },
                format!("{kind} id already exists in this group"),
                Some(current),
            ),
            Self::NotFound(kind) => (
                actix_web::http::StatusCode::NOT_FOUND,
                if kind == "setup" {
                    "setup_not_found"
                } else {
                    "section_not_found"
                },
                format!("{kind} was not found in this group"),
                None,
            ),
            Self::StaleRevision { expected, current } => (
                actix_web::http::StatusCode::CONFLICT,
                "stale_revision",
                format!("revision {expected} is stale"),
                Some(current),
            ),
            Self::StaleOrder(current) => (
                actix_web::http::StatusCode::CONFLICT,
                "stale_revision",
                "inventory setup order revision is stale".to_owned(),
                serde_json::to_value(*current).ok(),
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
        HttpResponse::build(status).json(ProtocolErrorBody {
            error,
            message,
            current,
        })
    }
}

fn json_body<T>(
    body: Result<web::Json<T>, Error>,
    invalid: impl FnOnce() -> ProtocolError,
) -> Result<T, ProtocolError> {
    body.map(web::Json::into_inner).map_err(|error| {
        if error.as_response_error().status_code() == actix_web::http::StatusCode::PAYLOAD_TOO_LARGE
        {
            ProtocolError::PayloadTooLarge
        } else {
            invalid()
        }
    })
}

pub fn parse_entity_id(value: &str) -> Result<Uuid, String> {
    let id = Uuid::parse_str(value).map_err(|_| "id must be a lowercase UUID v4".to_owned())?;
    if id.get_version() != Some(Version::Random) || id.hyphenated().to_string() != value {
        return Err("id must be a lowercase UUID v4".to_owned());
    }
    Ok(id)
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonicalize(value)))
                    .collect::<Map<_, _>>(),
            )
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
        value => value,
    }
}

pub fn canonical_object(value: Value) -> Result<Value, String> {
    if !value.is_object() {
        return Err("payload must be a JSON object".to_owned());
    }
    Ok(canonicalize(value))
}

fn parse_etag(value: &str) -> Option<i64> {
    let digits = value.strip_prefix('"')?.strip_suffix('"')?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}
fn request_etag(req: &HttpRequest, name: header::HeaderName) -> Option<i64> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_etag)
}

fn validate_name(kind: &'static str, name: String) -> Result<String, ProtocolError> {
    let name = name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 50 {
        return Err(ProtocolError::InvalidEntity(
            kind,
            "name must be 1-50 characters".to_owned(),
        ));
    }
    Ok(name)
}

fn validate_setup(
    path_id: Uuid,
    mut setup: InventorySetup,
) -> Result<InventorySetup, ProtocolError> {
    if setup.schema_version != SCHEMA_VERSION {
        return Err(ProtocolError::UnsupportedSchema);
    }
    if let Some(body_id) = &setup.setup_id {
        if parse_entity_id(body_id).map_err(|message| ProtocolError::InvalidId("setup", message))?
            != path_id
        {
            return Err(ProtocolError::InvalidId(
                "setup",
                "body setupId must match the path id".to_owned(),
            ));
        }
    }
    setup.setup_id = Some(path_id.hyphenated().to_string());
    setup.name = validate_name("setup", setup.name)?;
    setup.payload = canonical_object(setup.payload)
        .map_err(|message| ProtocolError::InvalidEntity("setup", message))?;
    Ok(setup)
}

fn validate_section(
    path_id: Uuid,
    mut section: InventorySetupSection,
) -> Result<(InventorySetupSection, Vec<Uuid>), ProtocolError> {
    if section.schema_version != SCHEMA_VERSION {
        return Err(ProtocolError::UnsupportedSchema);
    }
    if let Some(body_id) = &section.section_id {
        if parse_entity_id(body_id)
            .map_err(|message| ProtocolError::InvalidId("section", message))?
            != path_id
        {
            return Err(ProtocolError::InvalidId(
                "section",
                "body sectionId must match the path id".to_owned(),
            ));
        }
    }
    section.section_id = Some(path_id.hyphenated().to_string());
    section.name = validate_name("section", section.name)?;
    let ids = section
        .validate_membership()
        .map_err(|message| ProtocolError::InvalidEntity("section", message))?;
    Ok((section, ids))
}

fn setup_metadata(row: &Row) -> Result<InventorySetupMetadata, ProtocolError> {
    let id: Uuid = row.try_get("setup_id")?;
    Ok(InventorySetupMetadata {
        setup_id: id.to_string(),
        name: row.try_get("name")?,
        revision: row.try_get("revision")?,
        deleted: row
            .try_get::<_, Option<DateTime<Utc>>>("deleted_at")?
            .is_some(),
    })
}
fn section_metadata(row: &Row) -> Result<InventorySetupSectionMetadata, ProtocolError> {
    let id: Uuid = row.try_get("section_id")?;
    Ok(InventorySetupSectionMetadata {
        section_id: id.to_string(),
        name: row.try_get("name")?,
        revision: row.try_get("revision")?,
        deleted: row
            .try_get::<_, Option<DateTime<Utc>>>("deleted_at")?
            .is_some(),
    })
}
fn row_setup(row: &Row) -> Result<InventorySetup, ProtocolError> {
    let metadata = setup_metadata(row)?;
    Ok(InventorySetup {
        schema_version: 1,
        setup_id: Some(metadata.setup_id),
        name: metadata.name,
        notes: row.try_get("notes")?,
        payload: if metadata.deleted {
            Value::Object(Map::new())
        } else {
            row.try_get("payload")?
        },
        revision: metadata.revision,
        deleted: metadata.deleted,
        updated_at: row.try_get("updated_at")?,
    })
}
fn row_section(row: &Row) -> Result<InventorySetupSection, ProtocolError> {
    let metadata = section_metadata(row)?;
    let ids: Vec<Uuid> = row.try_get("ordered_setup_ids")?;
    Ok(InventorySetupSection {
        schema_version: 1,
        section_id: Some(metadata.section_id),
        name: metadata.name,
        display_color: row.try_get("display_color")?,
        ordered_setup_ids: ids.into_iter().map(|id| id.to_string()).collect(),
        revision: metadata.revision,
        deleted: metadata.deleted,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn ensure_and_lock_group<'a>(
    transaction: &'a Transaction<'a>,
    group_id: i64,
) -> Result<Row, ProtocolError> {
    transaction.execute("INSERT INTO groupironman.inventory_setup_groups (group_id, updated_at) VALUES ($1,NOW()) ON CONFLICT (group_id) DO NOTHING", &[&group_id]).await?;
    Ok(transaction.query_one("SELECT group_revision, setup_order_revision, section_order_revision, ordered_setup_ids, ordered_section_ids FROM groupironman.inventory_setup_groups WHERE group_id=$1 FOR UPDATE", &[&group_id]).await?)
}

async fn load_manifest(
    client: &impl GenericClient,
    group_id: i64,
) -> Result<InventorySetupManifest, ProtocolError> {
    let group = client.query_opt("SELECT group_revision, setup_order_revision, section_order_revision, ordered_setup_ids, ordered_section_ids FROM groupironman.inventory_setup_groups WHERE group_id=$1", &[&group_id]).await?;
    let (group_revision, setup_order_revision, section_order_revision, setup_ids, section_ids): (
        i64,
        i64,
        i64,
        Vec<Uuid>,
        Vec<Uuid>,
    ) = match group {
        Some(row) => (
            row.try_get(0)?,
            row.try_get(1)?,
            row.try_get(2)?,
            row.try_get(3)?,
            row.try_get(4)?,
        ),
        None => (0, 0, 0, Vec::new(), Vec::new()),
    };
    let setups = client.query("SELECT setup_id,name,revision,deleted_at FROM groupironman.inventory_setups WHERE group_id=$1 ORDER BY setup_id", &[&group_id]).await?;
    let sections = client.query("SELECT section_id,name,revision,deleted_at FROM groupironman.inventory_setup_sections WHERE group_id=$1 ORDER BY section_id", &[&group_id]).await?;
    Ok(InventorySetupManifest {
        schema_version: 1,
        group_revision,
        setup_order_revision,
        section_order_revision,
        ordered_setup_ids: setup_ids.into_iter().map(|id| id.to_string()).collect(),
        ordered_section_ids: section_ids.into_iter().map(|id| id.to_string()).collect(),
        setups: setups
            .iter()
            .map(setup_metadata)
            .collect::<Result<_, _>>()?,
        sections: sections
            .iter()
            .map(section_metadata)
            .collect::<Result<_, _>>()?,
    })
}

async fn setup_current(
    client: &impl GenericClient,
    group_id: i64,
    id: Uuid,
) -> Result<Option<InventorySetupMetadata>, ProtocolError> {
    let row = client.query_opt("SELECT setup_id,name,revision,deleted_at FROM groupironman.inventory_setups WHERE group_id=$1 AND setup_id=$2", &[&group_id, &id]).await?;
    row.as_ref().map(setup_metadata).transpose()
}
async fn section_current(
    client: &impl GenericClient,
    group_id: i64,
    id: Uuid,
) -> Result<Option<InventorySetupSectionMetadata>, ProtocolError> {
    let row = client.query_opt("SELECT section_id,name,revision,deleted_at FROM groupironman.inventory_setup_sections WHERE group_id=$1 AND section_id=$2", &[&group_id, &id]).await?;
    row.as_ref().map(section_metadata).transpose()
}
async fn duplicate_setup_name(
    client: &impl GenericClient,
    group_id: i64,
    name: &str,
    except: Uuid,
) -> Result<Option<InventorySetupMetadata>, ProtocolError> {
    let row = client.query_opt("SELECT setup_id,name,revision,deleted_at FROM groupironman.inventory_setups WHERE group_id=$1 AND lower(name)=lower($2) AND deleted_at IS NULL AND setup_id<>$3", &[&group_id, &name, &except]).await?;
    row.as_ref().map(setup_metadata).transpose()
}
async fn duplicate_section_name(
    client: &impl GenericClient,
    group_id: i64,
    name: &str,
    except: Uuid,
) -> Result<Option<InventorySetupSectionMetadata>, ProtocolError> {
    let row = client.query_opt("SELECT section_id,name,revision,deleted_at FROM groupironman.inventory_setup_sections WHERE group_id=$1 AND lower(name)=lower($2) AND deleted_at IS NULL AND section_id<>$3", &[&group_id, &name, &except]).await?;
    row.as_ref().map(section_metadata).transpose()
}
async fn require_live_setups(
    client: &impl GenericClient,
    group_id: i64,
    ids: &[Uuid],
) -> Result<(), ProtocolError> {
    let rows = client.query("SELECT setup_id FROM groupironman.inventory_setups WHERE group_id=$1 AND deleted_at IS NULL AND setup_id=ANY($2)", &[&group_id, &ids]).await?;
    if rows.len() != ids.len() {
        return Err(ProtocolError::InvalidEntity(
            "section",
            "orderedSetupIds must contain only live setup ids in this group".to_owned(),
        ));
    }
    Ok(())
}

#[get("/inventory-setups")]
pub async fn get_manifest(
    auth: Authenticated,
    req: HttpRequest,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let client = pool.get().await.map_err(ApiError::PoolError)?;
        let manifest = load_manifest(&client, auth.group_id).await?;
        if request_etag(&req, header::IF_NONE_MATCH) == Some(manifest.group_revision) {
            return Ok(HttpResponse::NotModified()
                .insert_header((header::ETAG, format!("\"{}\"", manifest.group_revision)))
                .finish());
        }
        Ok(HttpResponse::Ok()
            .insert_header((header::ETAG, format!("\"{}\"", manifest.group_revision)))
            .json(manifest))
    }
    .await;
    result.unwrap_or_else(ProtocolError::response)
}

#[get("/inventory-setups/{setup_id}")]
pub async fn get_setup(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("setup", message))?;
        let client = pool.get().await.map_err(ApiError::PoolError)?;
        let row = client.query_opt("SELECT setup_id,name,notes,payload,revision,deleted_at,updated_at FROM groupironman.inventory_setups WHERE group_id=$1 AND setup_id=$2", &[&auth.group_id, &id]).await?;
        let setup = row.as_ref().map(row_setup).transpose()?.ok_or(ProtocolError::NotFound("setup"))?;
        if request_etag(&req, header::IF_NONE_MATCH) == Some(setup.revision) {
            return Ok(HttpResponse::NotModified()
                .insert_header((header::ETAG, format!("\"{}\"", setup.revision)))
                .finish());
        }
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", setup.revision))).json(setup))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

#[put("/inventory-setups/{setup_id}")]
pub async fn put_setup(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    body: Result<web::Json<InventorySetup>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("setup", message))?;
        let setup = validate_setup(id, json_body(body, || ProtocolError::InvalidEntity("setup", "request body is not a valid inventory setup document".to_owned()))?)?;
        let create = req.headers().get(header::IF_NONE_MATCH).and_then(|value| value.to_str().ok()) == Some("*");
        let expected = request_etag(&req, header::IF_MATCH);
        if !create && expected.is_none() { return Err(ProtocolError::PreconditionRequired); }
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let existing = setup_current(&transaction, auth.group_id, id).await?;
        if create {
            if let Some(current) = existing.as_ref() { return Err(ProtocolError::Exists("setup", serde_json::to_value(current).unwrap())); }
        } else {
            let current = existing.as_ref().ok_or(ProtocolError::NotFound("setup"))?;
            if current.revision != expected.unwrap() { return Err(ProtocolError::StaleRevision { expected: expected.unwrap(), current: serde_json::to_value(current).unwrap() }); }
        }
        if let Some(current) = duplicate_setup_name(&transaction, auth.group_id, &setup.name, id).await? { return Err(ProtocolError::DuplicateName("setup", serde_json::to_value(current).unwrap())); }
        let revision = if create { 1 } else { expected.unwrap() + 1 };
        let was_deleted = existing.as_ref().is_some_and(|current| current.deleted);
        let row = if create {
            transaction.query_one("INSERT INTO groupironman.inventory_setups (setup_id,group_id,name,notes,payload,revision,deleted_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,NULL,NOW()) RETURNING setup_id,name,notes,payload,revision,deleted_at,updated_at", &[&id,&auth.group_id,&setup.name,&setup.notes,&setup.payload,&revision]).await?
        } else {
            transaction.query_one("UPDATE groupironman.inventory_setups SET name=$3,notes=$4,payload=$5,revision=$6,deleted_at=NULL,updated_at=NOW() WHERE group_id=$1 AND setup_id=$2 RETURNING setup_id,name,notes,payload,revision,deleted_at,updated_at", &[&auth.group_id,&id,&setup.name,&setup.notes,&setup.payload,&revision]).await?
        };
        if create || was_deleted {
            let mut order: Vec<Uuid> = group.try_get("ordered_setup_ids")?;
            if !order.contains(&id) { order.push(id); }
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+1,ordered_setup_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id,&order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_setup(&row)?;
        Ok(HttpResponse::build(if create { actix_web::http::StatusCode::CREATED } else { actix_web::http::StatusCode::OK }).insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

#[delete("/inventory-setups/{setup_id}")]
pub async fn delete_setup(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("setup", message))?;
        let expected = request_etag(&req, header::IF_MATCH).ok_or(ProtocolError::PreconditionRequired)?;
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let current = setup_current(&transaction, auth.group_id, id).await?.ok_or(ProtocolError::NotFound("setup"))?;
        if current.revision != expected { return Err(ProtocolError::StaleRevision { expected, current: serde_json::to_value(current).unwrap() }); }
        let revision = expected + 1;
        let row = transaction.query_one("UPDATE groupironman.inventory_setups SET payload='{}'::jsonb,revision=$3,deleted_at=COALESCE(deleted_at,NOW()),updated_at=NOW() WHERE group_id=$1 AND setup_id=$2 RETURNING setup_id,name,notes,payload,revision,deleted_at,updated_at", &[&auth.group_id,&id,&revision]).await?;
        transaction.execute("UPDATE groupironman.inventory_setup_sections SET ordered_setup_ids=array_remove(ordered_setup_ids,$2),revision=revision+1,updated_at=NOW() WHERE group_id=$1 AND deleted_at IS NULL AND $2=ANY(ordered_setup_ids)", &[&auth.group_id,&id]).await?;
        let mut order: Vec<Uuid> = group.try_get("ordered_setup_ids")?;
        let old_len = order.len(); order.retain(|value| *value != id);
        if old_len != order.len() {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+1,ordered_setup_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id,&order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_setup(&row)?;
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

#[get("/inventory-setup-sections/{section_id}")]
pub async fn get_section(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("section", message))?;
        let client = pool.get().await.map_err(ApiError::PoolError)?;
        let row = client.query_opt("SELECT section_id,name,display_color,ordered_setup_ids,revision,deleted_at,updated_at FROM groupironman.inventory_setup_sections WHERE group_id=$1 AND section_id=$2", &[&auth.group_id,&id]).await?;
        let section = row.as_ref().map(row_section).transpose()?.ok_or(ProtocolError::NotFound("section"))?;
        if request_etag(&req, header::IF_NONE_MATCH) == Some(section.revision) {
            return Ok(HttpResponse::NotModified()
                .insert_header((header::ETAG, format!("\"{}\"", section.revision)))
                .finish());
        }
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", section.revision))).json(section))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

#[put("/inventory-setup-sections/{section_id}")]
pub async fn put_section(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    body: Result<web::Json<InventorySetupSection>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("section", message))?;
        let (section, setup_ids) = validate_section(id, json_body(body, || ProtocolError::InvalidEntity("section", "request body is not a valid inventory setup section document".to_owned()))?)?;
        let create = req.headers().get(header::IF_NONE_MATCH).and_then(|value| value.to_str().ok()) == Some("*");
        let expected = request_etag(&req, header::IF_MATCH);
        if !create && expected.is_none() { return Err(ProtocolError::PreconditionRequired); }
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let existing = section_current(&transaction, auth.group_id, id).await?;
        if create {
            if let Some(current) = existing.as_ref() { return Err(ProtocolError::Exists("section", serde_json::to_value(current).unwrap())); }
        } else {
            let current = existing.as_ref().ok_or(ProtocolError::NotFound("section"))?;
            if current.revision != expected.unwrap() { return Err(ProtocolError::StaleRevision { expected: expected.unwrap(), current: serde_json::to_value(current).unwrap() }); }
        }
        if let Some(current) = duplicate_section_name(&transaction, auth.group_id, &section.name, id).await? { return Err(ProtocolError::DuplicateName("section", serde_json::to_value(current).unwrap())); }
        require_live_setups(&transaction, auth.group_id, &setup_ids).await?;
        let revision = if create { 1 } else { expected.unwrap() + 1 };
        let was_deleted = existing.as_ref().is_some_and(|current| current.deleted);
        let row = if create {
            transaction.query_one("INSERT INTO groupironman.inventory_setup_sections (section_id,group_id,name,display_color,ordered_setup_ids,revision,deleted_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,NULL,NOW()) RETURNING section_id,name,display_color,ordered_setup_ids,revision,deleted_at,updated_at", &[&id,&auth.group_id,&section.name,&section.display_color,&setup_ids,&revision]).await?
        } else {
            transaction.query_one("UPDATE groupironman.inventory_setup_sections SET name=$3,display_color=$4,ordered_setup_ids=$5,revision=$6,deleted_at=NULL,updated_at=NOW() WHERE group_id=$1 AND section_id=$2 RETURNING section_id,name,display_color,ordered_setup_ids,revision,deleted_at,updated_at", &[&auth.group_id,&id,&section.name,&section.display_color,&setup_ids,&revision]).await?
        };
        if create || was_deleted {
            let mut order: Vec<Uuid> = group.try_get("ordered_section_ids")?;
            if !order.contains(&id) { order.push(id); }
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,section_order_revision=section_order_revision+1,ordered_section_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id,&order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_section(&row)?;
        Ok(HttpResponse::build(if create { actix_web::http::StatusCode::CREATED } else { actix_web::http::StatusCode::OK }).insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

#[delete("/inventory-setup-sections/{section_id}")]
pub async fn delete_section(
    auth: Authenticated,
    req: HttpRequest,
    path: web::Path<String>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let id = parse_entity_id(&path).map_err(|message| ProtocolError::InvalidId("section", message))?;
        let expected = request_etag(&req, header::IF_MATCH).ok_or(ProtocolError::PreconditionRequired)?;
        let mut client: Client = pool.get().await.map_err(ApiError::PoolError)?;
        let transaction = client.transaction().await?;
        let group = ensure_and_lock_group(&transaction, auth.group_id).await?;
        let current = section_current(&transaction, auth.group_id, id).await?.ok_or(ProtocolError::NotFound("section"))?;
        if current.revision != expected { return Err(ProtocolError::StaleRevision { expected, current: serde_json::to_value(current).unwrap() }); }
        let revision = expected + 1;
        let row = transaction.query_one("UPDATE groupironman.inventory_setup_sections SET ordered_setup_ids='{}'::uuid[],revision=$3,deleted_at=COALESCE(deleted_at,NOW()),updated_at=NOW() WHERE group_id=$1 AND section_id=$2 RETURNING section_id,name,display_color,ordered_setup_ids,revision,deleted_at,updated_at", &[&auth.group_id,&id,&revision]).await?;
        let mut order: Vec<Uuid> = group.try_get("ordered_section_ids")?;
        let old_len = order.len(); order.retain(|value| *value != id);
        if old_len != order.len() {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,section_order_revision=section_order_revision+1,ordered_section_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id,&order]).await?;
        } else {
            transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,updated_at=NOW() WHERE group_id=$1", &[&auth.group_id]).await?;
        }
        transaction.commit().await?;
        let stored = row_section(&row)?;
        Ok(HttpResponse::Ok().insert_header((header::ETAG, format!("\"{}\"", stored.revision))).json(stored))
    }.await;
    result.unwrap_or_else(ProtocolError::response)
}

async fn validate_and_put_order(
    client: &mut Client,
    group_id: i64,
    expected: i64,
    ids: Vec<Uuid>,
    setup_order: bool,
) -> Result<InventorySetupManifest, ProtocolError> {
    let transaction = client.transaction().await?;
    let group = ensure_and_lock_group(&transaction, group_id).await?;
    let current: i64 = if setup_order {
        group.try_get("setup_order_revision")?
    } else {
        group.try_get("section_order_revision")?
    };
    if current != expected {
        return Err(ProtocolError::StaleOrder(Box::new(
            load_manifest(&transaction, group_id).await?,
        )));
    }
    let rows = if setup_order {
        transaction.query("SELECT setup_id FROM groupironman.inventory_setups WHERE group_id=$1 AND deleted_at IS NULL", &[&group_id]).await?
    } else {
        transaction.query("SELECT section_id FROM groupironman.inventory_setup_sections WHERE group_id=$1 AND deleted_at IS NULL", &[&group_id]).await?
    };
    let live: HashSet<Uuid> = rows
        .iter()
        .map(|row| row.try_get(0))
        .collect::<Result<_, _>>()?;
    let unique: HashSet<Uuid> = ids.iter().copied().collect();
    if unique.len() != ids.len() {
        return Err(ProtocolError::InvalidOrder(
            "ordered ids contain duplicates".to_owned(),
        ));
    }
    if unique != live {
        return Err(ProtocolError::InvalidOrder(
            "ordered ids must be a permutation of all non-deleted ids".to_owned(),
        ));
    }
    if setup_order {
        transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+1,ordered_setup_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&group_id,&ids]).await?;
    } else {
        transaction.execute("UPDATE groupironman.inventory_setup_groups SET group_revision=group_revision+1,section_order_revision=section_order_revision+1,ordered_section_ids=$2,updated_at=NOW() WHERE group_id=$1", &[&group_id,&ids]).await?;
    }
    let manifest = load_manifest(&transaction, group_id).await?;
    transaction.commit().await?;
    Ok(manifest)
}

#[put("/inventory-setup-order")]
pub async fn put_setup_order(
    auth: Authenticated,
    req: HttpRequest,
    body: Result<web::Json<InventorySetupOrderRequest>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let body = json_body(body, || {
            ProtocolError::InvalidOrder(
                "request body is not a valid inventory setup order".to_owned(),
            )
        })?;
        if body.schema_version != 1 {
            return Err(ProtocolError::UnsupportedSchema);
        }
        let expected =
            request_etag(&req, header::IF_MATCH).ok_or(ProtocolError::PreconditionRequired)?;
        let ids = body
            .ordered_setup_ids
            .iter()
            .map(|id| {
                parse_entity_id(id).map_err(|message| ProtocolError::InvalidId("setup", message))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut client = pool.get().await.map_err(ApiError::PoolError)?;
        let manifest =
            validate_and_put_order(&mut client, auth.group_id, expected, ids, true).await?;
        Ok(HttpResponse::Ok()
            .insert_header((
                header::ETAG,
                format!("\"{}\"", manifest.setup_order_revision),
            ))
            .json(manifest))
    }
    .await;
    result.unwrap_or_else(ProtocolError::response)
}

#[put("/inventory-setup-section-order")]
pub async fn put_section_order(
    auth: Authenticated,
    req: HttpRequest,
    body: Result<web::Json<InventorySetupSectionOrderRequest>, Error>,
    pool: web::Data<Pool>,
) -> HttpResponse {
    let result = async {
        let body = json_body(body, || {
            ProtocolError::InvalidOrder(
                "request body is not a valid inventory setup section order".to_owned(),
            )
        })?;
        if body.schema_version != 1 {
            return Err(ProtocolError::UnsupportedSchema);
        }
        let expected =
            request_etag(&req, header::IF_MATCH).ok_or(ProtocolError::PreconditionRequired)?;
        let ids = body
            .ordered_section_ids
            .iter()
            .map(|id| {
                parse_entity_id(id).map_err(|message| ProtocolError::InvalidId("section", message))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut client = pool.get().await.map_err(ApiError::PoolError)?;
        let manifest =
            validate_and_put_order(&mut client, auth.group_id, expected, ids, false).await?;
        Ok(HttpResponse::Ok()
            .insert_header((
                header::ETAG,
                format!("\"{}\"", manifest.section_order_revision),
            ))
            .json(manifest))
    }
    .await;
    result.unwrap_or_else(ProtocolError::response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setup() -> InventorySetup {
        InventorySetup {
            schema_version: 1,
            setup_id: None,
            name: " Zulrah ".to_owned(),
            notes: "Bring food".to_owned(),
            payload: json!({"z": 1, "a": {"d": 2, "b": 1}}),
            revision: 99,
            deleted: true,
            updated_at: Utc::now(),
        }
    }
    fn section(setup_id: Uuid) -> InventorySetupSection {
        InventorySetupSection {
            schema_version: 1,
            section_id: None,
            name: " Bossing ".to_owned(),
            display_color: Some(-65536),
            ordered_setup_ids: vec![setup_id.to_string()],
            revision: 99,
            deleted: true,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn setup_documents_validate_and_preserve_name_case() {
        let id = Uuid::new_v4();
        let value = validate_setup(id, setup()).unwrap();
        assert_eq!(value.setup_id.as_deref(), Some(id.to_string().as_str()));
        assert_eq!(value.name, "Zulrah");
        assert_eq!(
            serde_json::to_string(&value.payload).unwrap(),
            r#"{"a":{"b":1,"d":2},"z":1}"#
        );
    }
    #[test]
    fn setup_payload_must_be_an_object() {
        let id = Uuid::new_v4();
        let mut value = setup();
        value.payload = json!([1, 2, 3]);
        assert!(validate_setup(id, value).is_err());
    }
    #[test]
    fn section_membership_allows_unique_setup_ids() {
        let setup_id = Uuid::new_v4();
        let value = validate_section(Uuid::new_v4(), section(setup_id))
            .unwrap()
            .0;
        assert_eq!(value.name, "Bossing");
    }
    #[test]
    fn section_rejects_duplicate_or_non_v4_setup_ids() {
        let setup_id = Uuid::new_v4();
        let mut value = section(setup_id);
        value.ordered_setup_ids.push(setup_id.to_string());
        assert!(validate_section(Uuid::new_v4(), value).is_err());
    }
    #[test]
    fn local_only_is_maximized_is_rejected() {
        let raw = json!({"schemaVersion":1,"sectionId":Uuid::new_v4().to_string(),"name":"Bossing","displayColor":null,"orderedSetupIds":[],"isMaximized":true});
        assert!(serde_json::from_value::<InventorySetupSection>(raw).is_err());
    }
    #[test]
    fn parses_only_quoted_decimal_etags() {
        assert_eq!(parse_etag("\"7\""), Some(7));
        assert_eq!(parse_etag("7"), None);
        assert_eq!(parse_etag("\"-1\""), None);
        assert_eq!(parse_etag("\"+1\""), None);
        assert_eq!(parse_etag("W/\"7\""), None);
    }
}
