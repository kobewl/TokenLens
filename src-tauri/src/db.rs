use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};
use std::time::Duration;

use crate::model::UsageEvent;

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|err| err.to_string())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS usage_events (
            request_id TEXT PRIMARY KEY,
            timestamp_ms INTEGER NOT NULL,
            app TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            fresh_input INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            reasoning_tokens INTEGER NOT NULL,
            cache_read_tokens INTEGER NOT NULL,
            cache_write_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            project TEXT NOT NULL,
            session_id TEXT NOT NULL,
            source TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS usage_events_time_idx ON usage_events(timestamp_ms);
        CREATE INDEX IF NOT EXISTS usage_events_model_idx ON usage_events(model);
        CREATE INDEX IF NOT EXISTS usage_events_source_idx ON usage_events(source);
        ",
    )
    .map_err(|err| err.to_string())?;
    Ok(conn)
}

// WAL readers can query the previous committed snapshot during collection.
pub fn open_reader(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| err.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|err| err.to_string())?;
    Ok(conn)
}

pub fn replace_source(
    conn: &Connection,
    source: &str,
    events: &[UsageEvent],
) -> Result<i64, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    // Keep a lightweight set of current ids instead of deleting and reinserting
    // every event. Removed records are still reconciled for non-rotating sources.
    tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS current_ids (request_id TEXT PRIMARY KEY); DELETE FROM current_ids;")
        .map_err(|err| err.to_string())?;
    let mut inserted = 0_i64;
    {
        let mut stmt = tx
            .prepare(
                "
                INSERT INTO usage_events (
                    request_id, timestamp_ms, app, provider, model,
                    fresh_input, output_tokens, reasoning_tokens,
                    cache_read_tokens, cache_write_tokens, total_tokens,
                    project, session_id, source
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                ON CONFLICT(request_id) DO UPDATE SET
                    timestamp_ms = excluded.timestamp_ms,
                    app = excluded.app,
                    provider = excluded.provider,
                    model = excluded.model,
                    fresh_input = excluded.fresh_input,
                    output_tokens = excluded.output_tokens,
                    reasoning_tokens = excluded.reasoning_tokens,
                    cache_read_tokens = excluded.cache_read_tokens,
                    cache_write_tokens = excluded.cache_write_tokens,
                    total_tokens = excluded.total_tokens,
                    project = excluded.project,
                    session_id = excluded.session_id,
                    source = excluded.source
                WHERE timestamp_ms IS NOT excluded.timestamp_ms
                   OR app IS NOT excluded.app OR provider IS NOT excluded.provider
                   OR model IS NOT excluded.model OR fresh_input IS NOT excluded.fresh_input
                   OR output_tokens IS NOT excluded.output_tokens OR reasoning_tokens IS NOT excluded.reasoning_tokens
                   OR cache_read_tokens IS NOT excluded.cache_read_tokens OR cache_write_tokens IS NOT excluded.cache_write_tokens
                   OR total_tokens IS NOT excluded.total_tokens OR project IS NOT excluded.project
                   OR session_id IS NOT excluded.session_id OR source IS NOT excluded.source
                ",
            )
            .map_err(|err| err.to_string())?;
        let mut ids = tx
            .prepare("INSERT OR IGNORE INTO current_ids VALUES (?1)")
            .map_err(|err| err.to_string())?;
        for event in events {
            if event.total_tokens <= 0 && event.fresh_input <= 0 && event.output_tokens <= 0 {
                continue;
            }
            ids.execute(params![event.request_id])
                .map_err(|err| err.to_string())?;
            stmt.execute(params![
                event.request_id,
                event.timestamp_ms,
                event.app,
                event.provider,
                event.model,
                event.fresh_input,
                event.output_tokens,
                event.reasoning_tokens,
                event.cache_read_tokens,
                event.cache_write_tokens,
                event.total_tokens,
                event.project,
                event.session_id,
                event.source,
            ])
            .map_err(|err| err.to_string())?;
            inserted += 1;
        }
    }
    if source != "zcode" {
        tx.execute("DELETE FROM usage_events WHERE source = ?1 AND request_id NOT IN (SELECT request_id FROM current_ids)", params![source])
            .map_err(|err| err.to_string())?;
    }
    tx.commit().map_err(|err| err.to_string())?;
    Ok(inserted)
}
