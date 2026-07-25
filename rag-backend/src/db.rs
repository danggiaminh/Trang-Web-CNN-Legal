use anyhow::{Context, Result};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::{Connection, OptionalExtension};
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
    pub source: String,
    pub title: String,
    pub section: String,
    pub content: String,
    pub article_slug: String,
    pub url: String,
    pub distance: f32,
}


#[derive(Debug, Default)]
pub struct DocChunks {
    pub chunks: Vec<Retrieved>,


    pub truncated: bool,
}


const KNN_OVERFETCH: usize = 6;

pub fn search_knn(conn: &Connection, query_embedding: &[f32], k: usize) -> Result<Vec<Retrieved>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.source, c.title, c.section, c.content, c.article_slug, c.url, v.distance
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
                source: row.get(1)?,
                title: row.get(2)?,
                section: row.get(3)?,
                content: row.get(4)?,
                article_slug: row.get(5)?,
                url: row.get(6)?,
                distance: row.get::<_, f64>(7)? as f32,
            })
        },
    )?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}


pub fn search_knn_in_doc(
    conn: &Connection,
    query_embedding: &[f32],
    k: usize,
    slug: &str,
    source: &str,
) -> Result<Vec<Retrieved>> {
    let hits = search_knn(conn, query_embedding, k * KNN_OVERFETCH)?;
    Ok(hits
        .into_iter()
        .filter(|h| h.article_slug == slug && h.source == source)
        .take(k)
        .collect())
}


pub fn preferred_source(conn: &Connection, slug: &str) -> Result<Option<String>> {
    let v = conn
        .query_row(
            "SELECT source FROM chunks WHERE article_slug = ?1
             ORDER BY updated_at DESC, id DESC LIMIT 1",
            [slug],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(v)
}

pub fn fetch_doc_chunks(conn: &Connection, slug: &str, max_chars: usize) -> Result<DocChunks> {
    let Some(source) = preferred_source(conn, slug)? else {
        return Ok(DocChunks::default());
    };

    let mut stmt = conn.prepare(
        "SELECT id, source, title, section, content, article_slug, url
         FROM chunks
         WHERE article_slug = ?1 AND source = ?2
         ORDER BY id",
    )?;
    let rows = stmt.query_map(rusqlite::params![slug, source], |row| {
        Ok(Retrieved {
            id: row.get(0)?,
            source: row.get(1)?,
            title: row.get(2)?,
            section: row.get(3)?,
            content: row.get(4)?,
            article_slug: row.get(5)?,
            url: row.get(6)?,
            distance: 0.0,
        })
    })?;

    let mut out = Vec::new();
    let mut used = 0usize;
    let mut truncated = false;
    for r in rows {
        let r = r?;
        let cost = r.content.chars().count();
        if used + cost > max_chars && !out.is_empty() {
            truncated = true;
            break;
        }
        used += cost;
        out.push(r);
    }
    Ok(DocChunks {
        chunks: out,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        register_sqlite_vec();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn, 4).unwrap();
        conn
    }

    fn add_chunk(conn: &Connection, source: &str, slug: &str, content: &str, updated_at: &str) {
        conn.execute(
            "INSERT INTO chunks(source, article_slug, title, section, content, url, updated_at)
             VALUES (?1, ?2, 'Bài thử', '', ?3, '', ?4)",
            rusqlite::params![source, slug, content, updated_at],
        )
        .unwrap();
    }


    #[test]
    fn slug_trung_nhieu_nguon_chi_lay_ban_moi_nhat() {
        let conn = mem_db();
        let slug = "dai-an-van-thinh-phat-giai-doan-1";
        for i in 0..3 {
            add_chunk(&conn, "file", slug, &format!("bản .md đoạn {i}"), "2025-01-01");
        }
        for i in 0..3 {
            add_chunk(
                &conn,
                "wordpress",
                slug,
                &format!("bản WP đoạn {i}"),
                "2025-06-01T10:00:00Z",
            );
        }

        assert_eq!(
            preferred_source(&conn, slug).unwrap().as_deref(),
            Some("wordpress")
        );

        let doc = fetch_doc_chunks(&conn, slug, 100_000).unwrap();
        assert_eq!(doc.chunks.len(), 3, "chỉ được lấy chunk của một nguồn");
        assert!(doc.chunks.iter().all(|c| c.source == "wordpress"));
        assert!(!doc.truncated);
    }


    #[test]
    fn bao_truncated_dung_theo_ngan_sach() {
        let conn = mem_db();
        let slug = "bai-dai";
        for i in 0..5 {
            add_chunk(&conn, "file", slug, &"x".repeat(100), &format!("2025-01-0{}", i + 1));
        }

        let cat = fetch_doc_chunks(&conn, slug, 250).unwrap();
        assert_eq!(cat.chunks.len(), 2);
        assert!(cat.truncated, "bài bị cắt thì phải báo để còn chạy KNN bù");

        let du = fetch_doc_chunks(&conn, slug, 100_000).unwrap();
        assert_eq!(du.chunks.len(), 5);
        assert!(!du.truncated, "vừa ngân sách thì phải bỏ qua được KNN");
    }

    #[test]
    fn slug_la_tra_ve_rong() {
        let conn = mem_db();
        let doc = fetch_doc_chunks(&conn, "khong-ton-tai", 8000).unwrap();
        assert!(doc.chunks.is_empty());
        assert!(!doc.truncated);
    }
}
