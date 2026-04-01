use crate::relay::event::Event;
use crate::relay::filter::Filter;
use std::collections::HashMap;

pub struct Subscription {
    pub id: String,
    pub filters: Vec<Filter>,
}

impl Subscription {
    /// Returns true if the event matches any filter in this subscription.
    pub fn matches(&self, event: &Event) -> bool {
        self.filters.iter().any(|f| f.matches(event))
    }
}

/// Per-connection subscription state.
pub struct SubscriptionMap {
    subs: HashMap<String, Subscription>,
}

impl SubscriptionMap {
    pub fn new() -> Self {
        Self {
            subs: HashMap::new(),
        }
    }

    /// Add or replace a subscription. Returns the old one if replaced.
    pub fn upsert(&mut self, id: String, filters: Vec<Filter>) -> Option<Subscription> {
        let sub = Subscription {
            id: id.clone(),
            filters,
        };
        self.subs.insert(id, sub)
    }

    /// Remove a subscription by ID.
    pub fn remove(&mut self, id: &str) -> Option<Subscription> {
        self.subs.remove(id)
    }

    /// Get all subscription IDs that match the given event.
    pub fn matching_sub_ids(&self, event: &Event) -> Vec<String> {
        self.subs
            .values()
            .filter(|sub| sub.matches(event))
            .map(|sub| sub.id.clone())
            .collect()
    }
}
