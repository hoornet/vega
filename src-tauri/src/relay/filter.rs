use crate::relay::event::Event;
use rusqlite::types::Value;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub ids: Option<Vec<String>>,
    pub authors: Option<Vec<String>>,
    pub kinds: Option<Vec<u64>>,
    pub since: Option<u64>,
    pub until: Option<u64>,
    pub limit: Option<usize>,
    /// Generic tag filters: #e, #p, #d, etc.
    /// During deserialization we capture any field starting with '#'.
    #[serde(flatten)]
    pub generic_tags: HashMap<String, Vec<String>>,
}

impl Filter {
    /// Check if an event matches this filter in memory (for live fan-out).
    /// AND across fields, OR within each field.
    pub fn matches(&self, event: &Event) -> bool {
        // ids — prefix match
        if let Some(ref ids) = self.ids {
            if !ids.iter().any(|prefix| event.id.starts_with(prefix)) {
                return false;
            }
        }

        // authors — prefix match
        if let Some(ref authors) = self.authors {
            if !authors.iter().any(|prefix| event.pubkey.starts_with(prefix)) {
                return false;
            }
        }

        // kinds
        if let Some(ref kinds) = self.kinds {
            if !kinds.contains(&event.kind) {
                return false;
            }
        }

        // since
        if let Some(since) = self.since {
            if event.created_at < since {
                return false;
            }
        }

        // until
        if let Some(until) = self.until {
            if event.created_at > until {
                return false;
            }
        }

        // Generic tag filters (#e, #p, #d, etc.)
        for (key, values) in &self.generic_tags {
            // key is like "#e", "#p", etc.
            if !key.starts_with('#') || key.len() < 2 {
                continue;
            }
            let tag_name = &key[1..];
            let event_tag_values: Vec<&str> = event
                .tags
                .iter()
                .filter(|t| t.first().map(|s| s.as_str()) == Some(tag_name))
                .filter_map(|t| t.get(1).map(|s| s.as_str()))
                .collect();

            if !values.iter().any(|v| event_tag_values.contains(&v.as_str())) {
                return false;
            }
        }

        true
    }

    /// Build a SQL WHERE clause + params for querying the events table.
    /// Returns (where_clause, params, limit).
    pub fn to_sql(&self) -> (String, Vec<Value>, Option<usize>) {
        let mut conditions: Vec<String> = Vec::new();
        let mut params: Vec<Value> = Vec::new();
        let mut param_idx = 1usize;

        // ids — prefix match
        if let Some(ref ids) = self.ids {
            let clauses: Vec<String> = ids
                .iter()
                .map(|prefix| {
                    let p = format!("?{}", param_idx);
                    param_idx += 1;
                    params.push(Value::Text(format!("{}%", prefix)));
                    format!("e.id LIKE {}", p)
                })
                .collect();
            conditions.push(format!("({})", clauses.join(" OR ")));
        }

        // authors — prefix match
        if let Some(ref authors) = self.authors {
            let clauses: Vec<String> = authors
                .iter()
                .map(|prefix| {
                    let p = format!("?{}", param_idx);
                    param_idx += 1;
                    params.push(Value::Text(format!("{}%", prefix)));
                    format!("e.pubkey LIKE {}", p)
                })
                .collect();
            conditions.push(format!("({})", clauses.join(" OR ")));
        }

        // kinds
        if let Some(ref kinds) = self.kinds {
            let clauses: Vec<String> = kinds
                .iter()
                .map(|k| {
                    let p = format!("?{}", param_idx);
                    param_idx += 1;
                    params.push(Value::Integer(*k as i64));
                    format!("e.kind = {}", p)
                })
                .collect();
            conditions.push(format!("({})", clauses.join(" OR ")));
        }

        // since
        if let Some(since) = self.since {
            let p = format!("?{}", param_idx);
            param_idx += 1;
            params.push(Value::Integer(since as i64));
            conditions.push(format!("e.created_at >= {}", p));
        }

        // until
        if let Some(until) = self.until {
            let p = format!("?{}", param_idx);
            param_idx += 1;
            params.push(Value::Integer(until as i64));
            conditions.push(format!("e.created_at <= {}", p));
        }

        // Generic tag filters — JOIN on event_tags
        for (key, values) in &self.generic_tags {
            if !key.starts_with('#') || key.len() < 2 {
                continue;
            }
            let tag_name = &key[1..];

            let value_clauses: Vec<String> = values
                .iter()
                .map(|v| {
                    let p = format!("?{}", param_idx);
                    param_idx += 1;
                    params.push(Value::Text(v.clone()));
                    format!("t.tag_value = {}", p)
                })
                .collect();

            let tag_name_p = format!("?{}", param_idx);
            param_idx += 1;
            params.push(Value::Text(tag_name.to_string()));

            conditions.push(format!(
                "EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id = e.id AND t.tag_name = {} AND ({}))",
                tag_name_p,
                value_clauses.join(" OR ")
            ));
        }

        let where_clause = if conditions.is_empty() {
            "1=1".to_string()
        } else {
            conditions.join(" AND ")
        };

        (where_clause, params, self.limit)
    }
}
