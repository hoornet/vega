use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Maximum raw event size (128 KB).
pub const MAX_EVENT_SIZE: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u64,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

impl Event {
    /// Verify that the `id` field matches SHA-256 of the NIP-01 canonical serialization.
    pub fn verify_id(&self) -> bool {
        let canonical = serde_json::json!([
            0,
            &self.pubkey,
            self.created_at,
            self.kind,
            &self.tags,
            &self.content
        ]);
        let hash = Sha256::digest(canonical.to_string().as_bytes());
        hex::encode(hash) == self.id
    }

    /// Verify the BIP-340 Schnorr signature over the event id.
    pub fn verify_sig(&self) -> bool {
        let Ok(pubkey_bytes) = hex::decode(&self.pubkey) else {
            return false;
        };
        let Ok(sig_bytes) = hex::decode(&self.sig) else {
            return false;
        };
        let Ok(msg_bytes) = hex::decode(&self.id) else {
            return false;
        };

        let Ok(xonly) = secp256k1::XOnlyPublicKey::from_slice(&pubkey_bytes) else {
            return false;
        };
        let Ok(sig) = secp256k1::schnorr::Signature::from_slice(&sig_bytes) else {
            return false;
        };

        secp256k1::SECP256K1
            .verify_schnorr(&sig, &msg_bytes, &xonly)
            .is_ok()
    }

    /// Returns true if this event kind is replaceable (NIP-01).
    /// Kind 0, 3, and 10000-19999 are replaceable (same pubkey+kind = replace).
    pub fn is_replaceable(&self) -> bool {
        self.kind == 0 || self.kind == 3 || (10_000..20_000).contains(&self.kind)
    }

    /// Returns true if this event kind is parameterized-replaceable (NIP-01).
    /// Kind 30000-39999: same pubkey+kind+d-tag = replace.
    pub fn is_parameterized_replaceable(&self) -> bool {
        (30_000..40_000).contains(&self.kind)
    }

    /// Get the `d` tag value (for parameterized replaceable events).
    pub fn d_tag(&self) -> Option<&str> {
        self.tags
            .iter()
            .find(|t| t.first().map(|s| s.as_str()) == Some("d"))
            .and_then(|t| t.get(1).map(|s| s.as_str()))
    }
}
