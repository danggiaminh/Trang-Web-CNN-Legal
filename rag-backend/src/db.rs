use anyhow::{Context, Result};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::Connection;
use sqlite_vec::sqlite3_vec_init;
use std::sync::Once;
use zerocopy::AsBytes;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;
pub type PooledConn = r2d2::PooledConnection<SqliteConnectionManager>;

static VEC_INIT: Once = Once::new();

pub fn register_sqlite_vec() {
    VEC_INIT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    });
}

pub fn build_pool(db_path: &str) -> Result<Pool> {
    register_sqlite_vec();
    if let Some(dir) = std::path::Path::new(db_path).parent() {
        std::fs::create_dir_all(dir).ok();
    }

    {
        let c = Connection::open(db_path).context("không mở được SQLite (init WAL)")?;
        c.execute_batch("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;")?;
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        c.execute_batch("PRAGMA busy_timeout=5000;")?;
        Ok(())
    });
    let pool = r2d2::Pool::builder()
        .max_size(8)
        .build(manager)
        .context("không tạo được SQLite pool")?;
    Ok(pool)
}

pub fn open_single(db_path: &str) -> Result<Connection> {
    register_sqlite_vec();
    if let Some(dir) = std::path::Path::new(db_path).parent() {
        std::fs::create_dir_all(dir).ok();
    }
    let conn = Connection::open(db_path).context("không mở được SQLite")?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection, embed_dim: usize) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chunks (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          source        TEXT NOT NULL DEFAULT '',
          article_slug  TEXT NOT NULL,
          title         TEXT NOT NULL,
          section       TEXT NOT NULL DEFAULT '',
          content       TEXT NOT NULL,
          url           TEXT NOT NULL DEFAULT '',
          updated_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_slug ON chunks(article_slug);
        CREATE INDEX IF NOT EXISTS idx_chunks_doc  ON chunks(source, article_slug);

        CREATE TABLE IF NOT EXISTS ingest_state (
          source            TEXT NOT NULL DEFAULT '',
          article_slug      TEXT NOT NULL,
          source_updated_at TEXT NOT NULL,
          ingested_at       TEXT NOT NULL,
          chunk_count       INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (source, article_slug)
        );
        "#,
    )?;

    // Di trú nhẹ cho DB tạo trước khi thêm cột source/url. Bỏ qua lỗi
    // "duplicate column name" nếu cột đã tồn tại (DB mới đã có sẵn ở CREATE).
    for stmt in [
        "ALTER TABLE chunks ADD COLUMN source TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE chunks ADD COLUMN url TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ingest_state ADD COLUMN source TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(stmt, []);
    }

    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id  INTEGER PRIMARY KEY,
            embedding FLOAT[{embed_dim}] distance_metric=cosine
        );"
    ))?;
    Ok(())
}

pub struct ChunkRow<'a> {
    pub source: &'a str,
    pub article_slug: &'a str,
    pub title: &'a str,
    pub section: &'a str,
    pub content: &'a str,
    pub url: &'a str,
    pub updated_at: &'a str,
    pub embedding: &'a [f32],
}

/// Xoá một tài liệu khỏi kho. Nếu có `source` thì chỉ xoá bản của nguồn đó
/// (dùng khi re-ingest 1 nguồn); nếu `None` thì xoá theo slug bất kể nguồn
/// (dùng khi CMS báo gỡ bài mà không kèm nguồn).
pub fn delete_doc(conn: &Connection, source: Option<&str>, slug: &str) -> Result<()> {
    match source {
        Some(src) => {
            conn.execute(
                "DELETE FROM vec_chunks WHERE chunk_id IN
                   (SELECT id FROM chunks WHERE source = ?1 AND article_slug = ?2)",
                rusqlite::params![src, slug],
            )?;
            conn.execute(
                "DELETE FROM chunks WHERE source = ?1 AND article_slug = ?2",
                rusqlite::params![src, slug],
            )?;
            conn.execute(
                "DELETE FROM ingest_state WHERE source = ?1 AND article_slug = ?2",
                rusqlite::params![src, slug],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM vec_chunks WHERE chunk_id IN
                   (SELECT id FROM chunks WHERE article_slug = ?1)",
                [slug],
            )?;
            conn.execute("DELETE FROM chunks WHERE article_slug = ?1", [slug])?;
            conn.execute("DELETE FROM ingest_state WHERE article_slug = ?1", [slug])?;
        }
    }
    Ok(())
}

/// Ghi đè một tài liệu trong MỘT transaction (nguyên tử): xoá bản cũ của đúng
/// (source, slug), chèn chunk + vector mới, cập nhật `ingest_state`. Nếu có lỗi
/// giữa chừng thì rollback toàn bộ — kho không bao giờ rơi vào trạng thái "đã
/// xoá bài cũ nhưng chưa kịp chèn bài mới".
pub fn replace_doc(
    conn: &mut Connection,
    source: &str,
    slug: &str,
    source_updated_at: &str,
    ingested_at: &str,
    rows: &[ChunkRow<'_>],
    embed_dim: usize,
) -> Result<()> {
    let tx = conn.transaction()?;
    {
        tx.execute(
            "DELETE FROM vec_chunks WHERE chunk_id IN
               (SELECT id FROM chunks WHERE source = ?1 AND article_slug = ?2)",
            rusqlite::params![source, slug],
        )?;
        tx.execute(
            "DELETE FROM chunks WHERE source = ?1 AND article_slug = ?2",
            rusqlite::params![source, slug],
        )?;

        let mut ins_meta = tx.prepare(
            "INSERT INTO chunks(source, article_slug, title, section, content, url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let mut ins_vec =
            tx.prepare("INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?1, ?2)")?;

        for r in rows {
            anyhow::ensure!(
                r.embedding.len() == embed_dim,
                "embedding {} chiều nhưng bảng cấu hình {} chiều",
                r.embedding.len(),
                embed_dim
            );
            ins_meta.execute(rusqlite::params![
                r.source,
                r.article_slug,
                r.title,
                r.section,
                r.content,
                r.url,
                r.updated_at
            ])?;
            let id = tx.last_insert_rowid();
            ins_vec.execute(rusqlite::params![id, r.embedding.as_bytes()])?;
        }

        // INSERT OR REPLACE thay cho ON CONFLICT: hợp với cả DB mới (PK
        // source+slug) lẫn DB cũ (PK chỉ slug), không cần nêu đích danh khoá.
        tx.execute(
            "INSERT OR REPLACE INTO
               ingest_state(source, article_slug, source_updated_at, ingested_at, chunk_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![source, slug, source_updated_at, ingested_at, rows.len() as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn last_source_updated_at(
    conn: &Connection,
    source: &str,
    slug: &str,
) -> Result<Option<String>> {
    let v = conn
        .query_row(
            "SELECT source_updated_at FROM ingest_state WHERE source = ?1 AND article_slug = ?2",
            rusqlite::params![source, slug],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(v)
}

/// Danh sách (source, slug) đã ingest — dùng để prune bài không còn nữa.
pub fn all_ingested(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT source, article_slug FROM ingest_state")?;
    let it = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    Ok(it.filter_map(|r| r.ok()).collect())
}

#[derive(Debug, Clone)]
pub struct Retrieved {
    pub id: i64,
    pub title: String,
    pub section: String,
    pub content: String,
    pub article_slug: String,
    pub url: String,
    pub distance: f32,
}

pub fn search_knn(conn: &Connection, query_embedding: &[f32], k: usize) -> Result<Vec<Retrieved>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.title, c.section, c.content, c.article_slug, c.url, v.distance
         FROM vec_chunks v
         JOIN chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ?1 AND k = ?2
         ORDER BY v.distance",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![query_embedding.as_bytes(), k as i64],
        |row| {
            Ok(Retrieved {
                id: row.get(0)?,
                title: row.get(1)?,
                section: row.get(2)?,
                content: row.get(3)?,
                article_slug: row.get(4)?,
                url: row.get(5)?,
                distance: row.get::<_, f64>(6)? as f32,
            })
        },
    )?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn fetch_doc_chunks(conn: &Connection, slug: &str, max_chars: usize) -> Result<Vec<Retrieved>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, section, content, article_slug, url
         FROM chunks
         WHERE article_slug = ?1
         ORDER BY id",
    )?;
    let rows = stmt.query_map(rusqlite::params![slug], |row| {
        Ok(Retrieved {
            id: row.get(0)?,
            title: row.get(1)?,
            section: row.get(2)?,
            content: row.get(3)?,
            article_slug: row.get(4)?,
            url: row.get(5)?,
            distance: 0.0,
        })
    })?;
    let mut out = Vec::new();
    let mut used = 0usize;
    for r in rows {
        let r = r?;
        let cost = r.content.chars().count();
        if used + cost > max_chars && !out.is_empty() {
            break;
        }
        used += cost;
        out.push(r);
    }
    Ok(out)
}
