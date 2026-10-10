use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    pub request_id: String,
    pub timestamp_ms: i64,
    pub app: String,
    pub provider: String,
    pub model: String,
    pub fresh_input: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    pub project: String,
    pub session_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    pub app: String,
    pub events: i64,
    pub detail: String,
    pub coverage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedTotal {
    pub name: String,
    pub total_tokens: i64,
    pub fresh_input: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub reasoning_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub bucket: String,
    pub model: String,
    pub total_tokens: i64,
    pub event_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub timestamp_ms: i64,
    pub app: String,
    pub provider: String,
    pub model: String,
    pub fresh_input: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub range: String,
    pub range_start_ms: i64,
    pub range_end_ms: i64,
    pub undated_count: i64,
    pub total_tokens: i64,
    pub fresh_input: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub reasoning_tokens: i64,
    pub event_count: i64,
    pub by_model: Vec<NamedTotal>,
    pub by_app: Vec<NamedTotal>,
    pub by_project: Vec<NamedTotal>,
    pub series: Vec<SeriesPoint>,
    pub bucket_kind: String,
    pub requests: Vec<RequestLog>,
    pub providers: Vec<String>,
    pub models: Vec<String>,
    pub by_provider: Vec<NamedTotal>,
}

/// Cache sits inside `input` (ZCode, Codex). Reasoning sits inside `output`.
pub fn from_inclusive_input(
    input: i64,
    output: i64,
    reasoning: i64,
    cache_read: i64,
    cache_write: i64,
    reported_total: Option<i64>,
) -> (i64, i64, i64, i64, i64, i64) {
    let input = input.max(0);
    let output = output.max(0);
    let reasoning = reasoning.max(0).min(output);
    let cache_read = cache_read.max(0);
    let cache_write = cache_write.max(0);
    let (fresh, cache_read, cache_write) = if cache_read + cache_write <= input {
        (input - cache_read - cache_write, cache_read, cache_write)
    } else {
        (input, 0, 0)
    };
    let computed = fresh + cache_read + cache_write + output;
    let total = reported_total
        .filter(|value| *value > 0)
        .unwrap_or(computed);
    (fresh, output, reasoning, cache_read, cache_write, total)
}

/// Anthropic-style: input, cache read, and cache write are separate.
pub fn from_additive_input(
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
) -> (i64, i64, i64, i64, i64, i64) {
    let fresh = input.max(0);
    let output = output.max(0);
    let cache_read = cache_read.max(0);
    let cache_write = cache_write.max(0);
    let total = fresh + cache_read + cache_write + output;
    (fresh, output, 0, cache_read, cache_write, total)
}

/// One local calendar day of aggregated usage metadata (no content).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTotal {
    pub day: String,
    pub total_tokens: i64,
    pub event_count: i64,
    pub fresh_input: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
}

/// Cursor chat activity. Deliberately separate from usage: Cursor no longer stores per-request token counts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorActivity {
    pub chats_today: i64,
    pub chats_week: i64,
    pub last_counted_ms: i64,
}
