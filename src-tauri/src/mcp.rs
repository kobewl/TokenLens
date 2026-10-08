//! Small stdio-only MCP adapter. Shared storage and validation live in memory.rs.
use crate::memory::{self, DecisionInput, HandoffInput};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Read, Write},
    path::Path,
};
fn tool(
    name: &str,
    description: &str,
    properties: Value,
    required: Value,
    read_only: bool,
) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},"annotations":{"readOnlyHint":read_only,"destructiveHint":false,"openWorldHint":false}})
}
fn tools() -> Value {
    let list = json!({"type":"array","maxItems":50,"items":{"type":"string","minLength":1,"maxLength":500}});
    json!([
        tool(
            "current",
            "获取本项目最近交接、有效决策和下一步；开工时先读简报。",
            json!({}),
            json!([]),
            true
        ),
        tool(
            "handoff",
            "追加提炼后的开发交接；不保存完整会话或密钥。",
            json!({"summary":{"type":"string","minLength":1,"maxLength":2000},"done":list,"next":list}),
            json!(["summary"]),
            false
        ),
        tool(
            "add_decision",
            "追加技术决策和理由，可用 supersedes 取代仍有效的旧决策。",
            json!({"title":{"type":"string","minLength":1,"maxLength":500},"rationale":{"type":"string","minLength":1,"maxLength":2000},"supersedes":{"type":"integer","minimum":1}}),
            json!(["title", "rationale"]),
            false
        ),
        tool(
            "search",
            "按中英文关键词检索交接摘要与决策，保留失效决策用于追溯。",
            json!({"query":{"type":"string","minLength":1,"maxLength":200},"limit":{"type":"integer","minimum":1,"maximum":50,"default":10}}),
            json!(["query"]),
            true
        )
    ])
}
fn call(
    root: &Path,
    tool_name: &str,
    guidance: bool,
    name: &str,
    args: &Value,
) -> Result<String, String> {
    let object = args.as_object().ok_or("E-VALID：参数须为对象")?;
    let permitted: &[&str] = match name {
        "current" => &[],
        "handoff" => &["summary", "done", "next"],
        "add_decision" => &["title", "rationale", "supersedes"],
        "search" => &["query", "limit"],
        _ => return Err("E-VALID：未知记忆工具".into()),
    };
    if object.keys().any(|key| !permitted.contains(&key.as_str())) {
        return Err("E-VALID：包含不支持的参数".into());
    }
    match name {
        "current" => Ok(memory::snapshot(root, "")?.brief),
        "handoff" => {
            let mut args = args.clone();
            args["tool"] = json!(tool_name);
            let input: HandoffInput =
                serde_json::from_value(args).map_err(|_| "E-VALID：交接参数格式不正确")?;
            let written = memory::handoff(root, input, guidance)?;
            Ok(format!(
                "交接已记录（事件 #{}）。{}",
                written.id,
                written
                    .warning
                    .map(|w| format!("\n视图更新告警：{w}"))
                    .unwrap_or_default()
            ))
        }
        "add_decision" => {
            let mut args = args.clone();
            args["tool"] = json!(tool_name);
            let input: DecisionInput =
                serde_json::from_value(args).map_err(|_| "E-VALID：决策参数格式不正确")?;
            let written = memory::add_decision(root, input, guidance)?;
            Ok(format!(
                "决策已记录（D{}）。{}",
                written.id,
                written
                    .warning
                    .map(|w| format!("\n视图更新告警：{w}"))
                    .unwrap_or_default()
            ))
        }
        "search" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .filter(|q| !q.trim().is_empty())
                .ok_or("E-VALID：请输入关键词")?;
            let limit = match args.get("limit") {
                Some(v) => v
                    .as_u64()
                    .filter(|n| (1..=50).contains(n))
                    .ok_or("E-VALID：limit 须为 1–50")? as usize,
                None => 10,
            };
            let snapshot = memory::snapshot(root, query)?;
            let mut hits: Vec<_> = snapshot
                .events
                .iter()
                .map(|e| {
                    (
                        e.ts.clone(),
                        format!("[事件 #{} · {}] {}", e.id, e.tool, e.summary),
                    )
                })
                .chain(snapshot.decisions.iter().map(|d| {
                    (
                        d.ts.clone(),
                        format!(
                            "[决策 D{} · {} · {}] {} —— {}",
                            d.id,
                            d.tool,
                            if d.status == "active" {
                                "有效"
                            } else {
                                "已失效"
                            },
                            d.title,
                            d.rationale
                        ),
                    )
                }))
                .collect();
            hits.sort_by(|a, b| b.0.cmp(&a.0));
            hits.truncate(limit);
            Ok(if hits.is_empty() {
                "未检索到相关记忆".into()
            } else {
                hits.into_iter().map(|h| h.1).collect::<Vec<_>>().join("\n")
            })
        }
        _ => Err("E-VALID：未知工具".into()),
    }
}
pub fn run_mcp(args: &[String]) -> Result<(), String> {
    let mut path = None;
    let mut tool_name = std::env::var("BATON_TOOL_NAME").unwrap_or_else(|_| "unknown".into());
    let mut guidance = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--project" => {
                i += 1;
                path = Some(args.get(i).ok_or("缺少项目路径")?.clone());
            }
            "--tool" => {
                i += 1;
                tool_name = args.get(i).ok_or("缺少工具名")?.clone();
            }
            "--agents" => guidance = true,
            _ => return Err("不支持的 MCP 启动参数".into()),
        };
        i += 1;
    }
    if tool_name.trim().is_empty() || tool_name.chars().count() > 80 {
        return Err("工具名须为 1–80 字符".into());
    }
    let root = memory::project_root(Path::new(&path.ok_or("请通过 --project 指定项目")?))?;
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    loop {
        let mut line = Vec::new();
        let size = (&mut reader)
            .take(262145)
            .read_until(b'\n', &mut line)
            .map_err(|_| "无法读取 MCP 输入")?;
        if size == 0 {
            break;
        }
        if size > 262144 {
            return Err("MCP 消息超过大小限制".into());
        }
        let request: Value = match serde_json::from_slice(&line) {
            Ok(v) => v,
            Err(_) => {
                writeln!(out,"{}",json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}})).map_err(|_|"无法写入 MCP 输出")?;
                out.flush().map_err(|_| "无法写入 MCP 输出")?;
                continue;
            }
        };
        let id = request.get("id").cloned();
        if id.is_none() {
            continue;
        }
        let id = id.unwrap_or(Value::Null);
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        let response = if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"Invalid request"}})
        } else {
            let result = match request.get("method").and_then(Value::as_str).unwrap_or("") {
                "initialize" => {
                    let requested = params
                        .get("protocolVersion")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let version = if ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]
                        .contains(&requested)
                    {
                        requested
                    } else {
                        "2025-11-25"
                    };
                    Some(
                        json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"TokenLens Baton","version":env!("CARGO_PKG_VERSION")}}),
                    )
                }
                "ping" => Some(json!({})),
                "tools/list" => Some(json!({"tools":tools()})),
                "tools/call" => {
                    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                    let args = params
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let result = call(&root, &tool_name, guidance, name, &args);
                    let error = result.is_err();
                    Some(
                        json!({"content":[{"type":"text","text":result.unwrap_or_else(|e|e)}],"isError":error}),
                    )
                }
                _ => None,
            };
            match result {
                Some(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                None => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}})
                }
            }
        };
        writeln!(out, "{response}").map_err(|_| "无法写入 MCP 输出")?;
        out.flush().map_err(|_| "无法写入 MCP 输出")?;
    }
    Ok(())
}
