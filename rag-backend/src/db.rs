use anyhow::{Context, Result};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::{Connection, OptionalExtension};
use sqlite_vec::sqlite3_vec_init;
use std::collections::HashMap;
use std::sync::Once;
use zerocopy::AsBytes;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;

static VEC_INIT: Once = Once::new();

pub const SCHEMA_VERSION: i64 = 2;

pub fn register_sqlite_vec() {
    VEC_INIT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
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

pub fn init_schema(conn: &Connection, embed_dim: usize, rebuild: bool) -> Result<()> {
    let found: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let has_tables: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type IN ('table','view')
             AND name IN ('chunks','documents','ingest_state')",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if has_tables && found != SCHEMA_VERSION {
        if !rebuild {
            anyhow::bail!(
                "kho dùng schema v{found} nhưng service cần v{SCHEMA_VERSION}. \
                 Chạy lại: cargo run --release --bin ingest -- --force"
            );
        }
        tracing::warn!("schema v{found} -> v{SCHEMA_VERSION}: dựng lại kho từ file .md");
        conn.execute_batch(
            "DROP TABLE IF EXISTS chunks_fts;
             DROP TABLE IF EXISTS vec_chunks;
             DROP TABLE IF EXISTS chunks;
             DROP TABLE IF EXISTS documents;
             DROP TABLE IF EXISTS ingest_state;",
        )?;
    }

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS documents (
          slug        TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          url         TEXT NOT NULL DEFAULT '',
          category    TEXT NOT NULL DEFAULT '',
          updated_at  TEXT NOT NULL,
          markdown    TEXT NOT NULL,
          ingested_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          slug         TEXT NOT NULL,
          ord          INTEGER NOT NULL,
          heading_path TEXT NOT NULL DEFAULT '',
          content      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_slug ON chunks(slug, ord);
        "#,
    )?;

    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id  INTEGER PRIMARY KEY,
            slug      TEXT,
            embedding FLOAT[{embed_dim}] distance_metric=cosine
        );"
    ))?;

    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            heading_path,
            slug     UNINDEXED,
            chunk_id UNINDEXED,
            tokenize='unicode61 remove_diacritics 0'
        );",
    )?;

    conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    Ok(())
}

pub struct DocMeta<'a> {
    pub slug: &'a str,
    pub title: &'a str,
    pub url: &'a str,
    pub category: &'a str,
    pub updated_at: &'a str,
    pub markdown: &'a str,
}

pub struct ChunkRow<'a> {
    pub heading_path: &'a str,
    pub content: &'a str,
    pub embedding: &'a [f32],
}

pub fn delete_doc(conn: &Connection, slug: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE slug = ?1)",
        [slug],
    )?;
    conn.execute(
        "DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE slug = ?1)",
        [slug],
    )?;
    conn.execute("DELETE FROM chunks WHERE slug = ?1", [slug])?;
    conn.execute("DELETE FROM documents WHERE slug = ?1", [slug])?;
    Ok(())
}

pub fn replace_doc(
    conn: &mut Connection,
    meta: &DocMeta<'_>,
    ingested_at: &str,
    rows: &[ChunkRow<'_>],
    embed_dim: usize,
) -> Result<()> {
    let tx = conn.transaction()?;
    {
        tx.execute(
            "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE slug = ?1)",
            [meta.slug],
        )?;
        tx.execute(
            "DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE slug = ?1)",
            [meta.slug],
        )?;
        tx.execute("DELETE FROM chunks WHERE slug = ?1", [meta.slug])?;

        tx.execute(
            "INSERT OR REPLACE INTO
               documents(slug, title, url, category, updated_at, markdown, ingested_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                meta.slug,
                meta.title,
                meta.url,
                meta.category,
                meta.updated_at,
                meta.markdown,
                ingested_at
            ],
        )?;

        let mut ins_chunk = tx.prepare(
            "INSERT INTO chunks(slug, ord, heading_path, content) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut ins_vec =
            tx.prepare("INSERT INTO vec_chunks(chunk_id, slug, embedding) VALUES (?1, ?2, ?3)")?;
        let mut ins_fts = tx.prepare(
            "INSERT INTO chunks_fts(content, heading_path, slug, chunk_id) VALUES (?1, ?2, ?3, ?4)",
        )?;

        for (ord, r) in rows.iter().enumerate() {
            anyhow::ensure!(
                r.embedding.len() == embed_dim,
                "embedding {} chiều nhưng bảng cấu hình {} chiều",
                r.embedding.len(),
                embed_dim
            );
            ins_chunk.execute(rusqlite::params![
                meta.slug,
                ord as i64,
                r.heading_path,
                r.content
            ])?;
            let id = tx.last_insert_rowid();
            ins_vec.execute(rusqlite::params![id, meta.slug, r.embedding.as_bytes()])?;
            ins_fts.execute(rusqlite::params![r.content, r.heading_path, meta.slug, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn last_updated_at(conn: &Connection, slug: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT updated_at FROM documents WHERE slug = ?1",
            [slug],
            |r| r.get::<_, String>(0),
        )
        .optional()?)
}

pub fn all_slugs(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT slug FROM documents")?;
    let it = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(it.filter_map(|r| r.ok()).collect())
}

#[derive(Debug, Clone)]
pub struct Retrieved {
    pub id: i64,
    pub slug: String,
    pub ord: i64,
    pub title: String,
    pub url: String,
    pub heading_path: String,
    pub content: String,
    pub score: f32,
}

#[derive(Debug, Default)]
pub struct DocChunks {
    pub chunks: Vec<Retrieved>,
    pub truncated: bool,
}

pub fn doc_stats(conn: &Connection, slug: &str) -> Result<Option<(String, usize)>> {
    Ok(conn
        .query_row(
            "SELECT d.title, COALESCE(SUM(LENGTH(c.content)), 0)
             FROM documents d LEFT JOIN chunks c ON c.slug = d.slug
             WHERE d.slug = ?1 GROUP BY d.slug",
            [slug],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize)),
        )
        .optional()?)
}

const HYDRATE_SQL: &str = "SELECT c.id, c.slug, c.ord, d.title, d.url, c.heading_path, c.content
     FROM chunks c JOIN documents d ON d.slug = c.slug";

fn row_to_retrieved(row: &rusqlite::Row<'_>) -> rusqlite::Result<Retrieved> {
    Ok(Retrieved {
        id: row.get(0)?,
        slug: row.get(1)?,
        ord: row.get(2)?,
        title: row.get(3)?,
        url: row.get(4)?,
        heading_path: row.get(5)?,
        content: row.get(6)?,
        score: 0.0,
    })
}

pub fn fetch_doc_chunks(conn: &Connection, slug: &str, max_chars: usize) -> Result<DocChunks> {
    let mut stmt = conn.prepare(&format!("{HYDRATE_SQL} WHERE c.slug = ?1 ORDER BY c.ord"))?;
    let rows = stmt.query_map([slug], row_to_retrieved)?;

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

pub fn fetch_outline(
    conn: &Connection,
    slug: &str,
    per_section_chars: usize,
    max_chars: usize,
) -> Result<Vec<Retrieved>> {
    let mut stmt = conn.prepare(&format!("{HYDRATE_SQL} WHERE c.slug = ?1 ORDER BY c.ord"))?;
    let rows = stmt.query_map([slug], row_to_retrieved)?;

    let mut out: Vec<Retrieved> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut used = 0usize;

    for r in rows {
        let mut r = r?;
        let top = r
            .heading_path
            .split(crate::chunk::HEADING_SEP)
            .next()
            .unwrap_or("")
            .to_string();
        if seen.contains(&top) {
            continue;
        }
        seen.push(top);

        if r.content.chars().count() > per_section_chars {
            r.content = r.content.chars().take(per_section_chars).collect::<String>() + "…";
        }
        let cost = r.content.chars().count();
        if used + cost > max_chars && !out.is_empty() {
            break;
        }
        used += cost;
        out.push(r);
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub enum Scope {
    All,
    Doc(String),
}

pub fn fts_query(question: &str) -> Option<String> {
    let mut terms: Vec<String> = Vec::new();
    for word in question.split_whitespace() {
        let cleaned: String = word
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, '/' | '-' | '.'))
            .collect();
        let cleaned = cleaned.trim_matches(|c| matches!(c, '/' | '-' | '.'));
        if cleaned.chars().count() >= 2 {
            terms.push(format!("\"{}\"", cleaned.to_lowercase()));
        }
    }
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}

const RRF_K: f64 = 60.0;

fn rrf_fuse(lists: &[Vec<i64>]) -> Vec<(i64, f64)> {
    let mut acc: HashMap<i64, f64> = HashMap::new();
    for list in lists {
        for (rank, id) in list.iter().enumerate() {
            *acc.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
    }
    let mut out: Vec<(i64, f64)> = acc.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}

fn knn_ids(conn: &Connection, q_emb: &[f32], k: usize, scope: &Scope) -> Result<Vec<i64>> {
    let ids = match scope {

        Scope::Doc(slug) => {
            let mut s = conn.prepare(
                "SELECT chunk_id FROM vec_chunks
                 WHERE embedding MATCH ?1 AND k = ?2 AND slug = ?3 ORDER BY distance",
            )?;
            let it = s.query_map(rusqlite::params![q_emb.as_bytes(), k as i64, slug], |r| {
                r.get::<_, i64>(0)
            })?;
            it.filter_map(|r| r.ok()).collect()
        }
        Scope::All => {
            let mut s = conn.prepare(
                "SELECT chunk_id FROM vec_chunks
                 WHERE embedding MATCH ?1 AND k = ?2 ORDER BY distance",
            )?;
            let it = s.query_map(rusqlite::params![q_emb.as_bytes(), k as i64], |r| {
                r.get::<_, i64>(0)
            })?;
            it.filter_map(|r| r.ok()).collect()
        }
    };
    Ok(ids)
}

fn bm25_ids(conn: &Connection, q_text: &str, k: usize, scope: &Scope) -> Result<Vec<i64>> {
    let Some(query) = fts_query(q_text) else {
        return Ok(Vec::new());
    };
    let ids = match scope {
        Scope::Doc(slug) => {
            let mut s = conn.prepare(
                "SELECT chunk_id FROM chunks_fts
                 WHERE chunks_fts MATCH ?1 AND slug = ?2
                 ORDER BY bm25(chunks_fts) LIMIT ?3",
            )?;
            let it = s.query_map(rusqlite::params![query, slug, k as i64], |r| {
                r.get::<_, i64>(0)
            })?;
            it.filter_map(|r| r.ok()).collect()
        }
        Scope::All => {
            let mut s = conn.prepare(
                "SELECT chunk_id FROM chunks_fts
                 WHERE chunks_fts MATCH ?1 ORDER BY bm25(chunks_fts) LIMIT ?2",
            )?;
            let it = s.query_map(rusqlite::params![query, k as i64], |r| r.get::<_, i64>(0))?;
            it.filter_map(|r| r.ok()).collect()
        }
    };
    Ok(ids)
}

fn hydrate(conn: &Connection, scored: &[(i64, f64)]) -> Result<Vec<Retrieved>> {
    if scored.is_empty() {
        return Ok(Vec::new());
    }
    let holes = vec!["?"; scored.len()].join(",");
    let mut stmt = conn.prepare(&format!("{HYDRATE_SQL} WHERE c.id IN ({holes})"))?;
    let ids: Vec<&dyn rusqlite::ToSql> = scored.iter().map(|(id, _)| id as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(ids.as_slice(), row_to_retrieved)?;

    let mut by_id: HashMap<i64, Retrieved> = HashMap::new();
    for r in rows {
        let r = r?;
        by_id.insert(r.id, r);
    }
    Ok(scored
        .iter()
        .filter_map(|(id, sc)| {
            by_id.remove(id).map(|mut r| {
                r.score = *sc as f32;
                r
            })
        })
        .collect())
}

pub fn search_hybrid(
    conn: &Connection,
    q_emb: &[f32],
    q_text: &str,
    k: usize,
    scope: Scope,
) -> Result<Vec<Retrieved>> {
    let pool_size = (k * 3).max(8);
    let vec_ids = knn_ids(conn, q_emb, pool_size, &scope)?;
    let kw_ids = bm25_ids(conn, q_text, pool_size, &scope)?;

    let fused = rrf_fuse(&[vec_ids, kw_ids]);
    let top: Vec<(i64, f64)> = fused.into_iter().take(k).collect();
    hydrate(conn, &top)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        register_sqlite_vec();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn, 4, true).unwrap();
        conn
    }

    fn emb(v: [f32; 4]) -> Vec<f32> {
        v.to_vec()
    }

    fn seed(conn: &mut Connection, slug: &str, chunks: &[(&str, &str, [f32; 4])]) {
        let rows: Vec<ChunkRow> = chunks
            .iter()
            .map(|(h, c, _)| ChunkRow {
                heading_path: h,
                content: c,
                embedding: &[],
            })
            .collect();
        let embs: Vec<Vec<f32>> = chunks.iter().map(|(_, _, e)| emb(*e)).collect();
        let rows: Vec<ChunkRow> = rows
            .into_iter()
            .zip(embs.iter())
            .map(|(r, e)| ChunkRow {
                embedding: e,
                ..r
            })
            .collect();
        replace_doc(
            conn,
            &DocMeta {
                slug,
                title: "Bài thử",
                url: "/bai-viet/x/",
                category: "",
                updated_at: "2025-01-01",
                markdown: "# gốc",
            },
            "2025-01-02",
            &rows,
            4,
        )
        .unwrap();
    }

    #[test]
    fn fts_query_khong_vo_cu_phap_voi_cau_hoi_that() {

        let q = fts_query(r#"Điều 353 quy định gì? "tham ô" - xem 226/2025/QH15 *"#).unwrap();
        assert!(!q.contains('?') && !q.contains('*'), "{q}");
        assert!(q.contains("\"226/2025/qh15\""), "giữ định danh nhiều phần: {q}");

        let conn = mem_db();
        conn.query_row(
            "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?1",
            [&q],
            |r| r.get::<_, i64>(0),
        )
        .expect("biểu thức phải hợp lệ với FTS5");
    }

    #[test]
    fn fts_query_rong_khi_khong_co_tu_nao() {
        assert!(fts_query("?  !  *").is_none());
    }

    #[test]
    fn bm25_bat_dung_dinh_danh_phap_ly() {
        let mut conn = mem_db();
        seed(
            &mut conn,
            "bai",
            &[
                ("Mục A", "Toà án nhân dân cấp tỉnh có thẩm quyền giải quyết.", [1.0, 0.0, 0.0, 0.0]),
                ("Mục B", "Điều 353 Bộ luật Hình sự quy định tội tham ô tài sản.", [0.0, 1.0, 0.0, 0.0]),
                ("Mục C", "Nghị quyết 226/2025/QH15 về đổi mới sáng tạo.", [0.0, 0.0, 1.0, 0.0]),
            ],
        );
        let ids = bm25_ids(&conn, "Điều 353 nói gì?", 5, &Scope::All).unwrap();
        let top = hydrate(&conn, &[(ids[0], 1.0)]).unwrap();
        assert!(top[0].content.contains("Điều 353"), "{:?}", top[0].content);

        let ids = bm25_ids(&conn, "226/2025/QH15", 5, &Scope::All).unwrap();
        let top = hydrate(&conn, &[(ids[0], 1.0)]).unwrap();
        assert!(top[0].content.contains("226/2025/QH15"));
    }

    #[test]
    fn knn_loc_slug_ngay_trong_truy_van() {
        let mut conn = mem_db();
        seed(&mut conn, "bai-a", &[("", "nội dung a1", [1.0, 0.0, 0.0, 0.0]),
                                    ("", "nội dung a2", [0.9, 0.1, 0.0, 0.0])]);
        seed(&mut conn, "bai-b", &[("", "nội dung b1", [0.0, 0.0, 0.0, 1.0])]);

        let ids = knn_ids(&conn, &emb([0.0, 0.0, 0.0, 1.0]), 2, &Scope::Doc("bai-a".into())).unwrap();
        assert_eq!(ids.len(), 2, "lọc sau KNN sẽ chỉ còn 0-1 kết quả");
        let got = hydrate(&conn, &ids.iter().map(|i| (*i, 1.0)).collect::<Vec<_>>()).unwrap();
        assert!(got.iter().all(|r| r.slug == "bai-a"));
    }

    #[test]
    fn rrf_uu_tien_muc_ca_hai_nhanh_cung_goi_ten() {

        let fused = rrf_fuse(&[vec![1, 7, 3], vec![2, 7, 4]]);
        assert_eq!(fused[0].0, 7, "{fused:?}");
    }

    #[test]
    fn hybrid_tra_ve_theo_thu_hang_hop_nhat() {
        let mut conn = mem_db();
        seed(
            &mut conn,
            "bai",
            &[
                ("Mục A", "Thẩm quyền của toà án cấp tỉnh.", [1.0, 0.0, 0.0, 0.0]),
                ("Mục B", "Điều 353 Bộ luật Hình sự tội tham ô.", [0.0, 1.0, 0.0, 0.0]),
            ],
        );
        let got = search_hybrid(&conn, &emb([0.0, 1.0, 0.0, 0.0]), "Điều 353", 2, Scope::Doc("bai".into())).unwrap();
        assert!(!got.is_empty());
        assert!(got[0].content.contains("Điều 353"), "{:?}", got[0]);
        assert!(got[0].score > 0.0);
        assert_eq!(got[0].title, "Bài thử");
        assert_eq!(got[0].url, "/bai-viet/x/");
    }

    #[test]
    fn outline_lay_chunk_dau_moi_muc_cap_1() {
        let mut conn = mem_db();
        seed(
            &mut conn,
            "bai",
            &[
                ("Phần I", &"a".repeat(300), [1.0, 0.0, 0.0, 0.0]),
                ("Phần I › Mục A", &"b".repeat(300), [0.0, 1.0, 0.0, 0.0]),
                ("Phần II", &"c".repeat(300), [0.0, 0.0, 1.0, 0.0]),
            ],
        );
        let out = fetch_outline(&conn, "bai", 100, 10_000).unwrap();
        assert_eq!(out.len(), 2, "gộp theo mục cấp 1: {out:?}");
        assert!(out[0].content.chars().count() <= 101, "phải cắt ngắn");
        assert!(out[0].content.ends_with('…'));
    }

    #[test]
    fn replace_doc_khong_nhan_doi_va_xoa_sach_ca_ba_bang() {
        let mut conn = mem_db();
        let one = [("", "nội dung", [1.0f32, 0.0, 0.0, 0.0])];
        seed(&mut conn, "bai", &one);
        seed(&mut conn, "bai", &one);

        let n: i64 = conn.query_row("SELECT count(*) FROM chunks", [], |r| r.get(0)).unwrap();
        let v: i64 = conn.query_row("SELECT count(*) FROM vec_chunks", [], |r| r.get(0)).unwrap();
        let f: i64 = conn.query_row("SELECT count(*) FROM chunks_fts", [], |r| r.get(0)).unwrap();
        assert_eq!((n, v, f), (1, 1, 1), "ingest lại không được nhân đôi");

        delete_doc(&conn, "bai").unwrap();
        for t in ["chunks", "vec_chunks", "chunks_fts", "documents"] {
            let c: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(c, 0, "bảng {t} còn sót");
        }
    }

    #[test]
    fn serve_tu_choi_schema_cu() {
        register_sqlite_vec();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE chunks(id INTEGER); PRAGMA user_version = 1;")
            .unwrap();
        let err = init_schema(&conn, 4, false).unwrap_err().to_string();
        assert!(err.contains("ingest -- --force"), "{err}");
    }
}
