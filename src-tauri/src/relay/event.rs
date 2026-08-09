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

        // secp256k1 0.31 deprecated the `from_slice` constructors in favour of
        // fixed-size arrays. `Signature::from_byte_array` is infallible, so the
        // length rejection that `from_slice` used to perform has to happen here
        // — a 63- or 65-byte signature must still be refused, not padded.
        let Ok(pubkey_arr) = <[u8; 32]>::try_from(pubkey_bytes.as_slice()) else {
            return false;
        };
        let Ok(sig_arr) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else {
            return false;
        };

        let Ok(xonly) = secp256k1::XOnlyPublicKey::from_byte_array(pubkey_arr) else {
            return false;
        };
        let sig = secp256k1::schnorr::Signature::from_byte_array(sig_arr);

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

#[cfg(test)]
mod tests {
    use super::*;
    use secp256k1::{Keypair, Secp256k1};

    /// Build a correctly signed event from a fixed key, so the vectors below are
    /// deterministic and don't depend on anything off-machine.
    fn signed_event(content: &str) -> Event {
        let secp = Secp256k1::new();
        let keypair = Keypair::from_seckey_byte_array(&secp, [0x42; 32]).unwrap();
        let (xonly, _) = keypair.x_only_public_key();

        let mut event = Event {
            id: String::new(),
            pubkey: hex::encode(xonly.serialize()),
            created_at: 1_700_000_000,
            kind: 1,
            tags: vec![],
            content: content.to_string(),
            sig: String::new(),
        };

        let canonical = serde_json::json!([
            0,
            &event.pubkey,
            event.created_at,
            event.kind,
            &event.tags,
            &event.content
        ]);
        let hash = Sha256::digest(canonical.to_string().as_bytes());
        event.id = hex::encode(hash);
        // no_aux_rand keeps the fixtures deterministic across runs
        event.sig = hex::encode(
            secp.sign_schnorr_no_aux_rand(hash.as_slice(), &keypair)
                .to_byte_array(),
        );
        event
    }

    #[test]
    fn accepts_a_correctly_signed_event() {
        let event = signed_event("hello");
        assert!(event.verify_id());
        assert!(event.verify_sig());
    }

    #[test]
    fn rejects_a_tampered_content() {
        let mut event = signed_event("hello");
        event.content = "goodbye".into();
        // id no longer matches the payload, and the signature is over the old id
        assert!(!event.verify_id());
    }

    #[test]
    fn rejects_a_signature_from_another_event() {
        let mut event = signed_event("hello");
        event.sig = signed_event("a different message").sig;
        assert!(event.verify_id());
        assert!(!event.verify_sig());
    }

    // secp256k1 0.31's `Signature::from_byte_array` is infallible, unlike the
    // `from_slice` it replaced. If the length check ever stops happening before
    // it, a short or overlong signature would reach the verifier — these pin it.
    #[test]
    fn rejects_a_wrong_length_signature() {
        let good = signed_event("hello");

        for bad_sig in [
            &good.sig[..126],                       // 63 bytes
            &format!("{}00", good.sig)[..],         // 65 bytes
            "",                                     // empty
        ] {
            let event = Event { sig: bad_sig.to_string(), ..good.clone() };
            assert!(!event.verify_sig(), "accepted a {}-char sig", bad_sig.len());
        }
    }

    #[test]
    fn rejects_a_wrong_length_pubkey() {
        let good = signed_event("hello");
        let event = Event { pubkey: good.pubkey[..62].to_string(), ..good.clone() };
        assert!(!event.verify_sig());
    }

    #[test]
    fn rejects_non_hex_fields() {
        let good = signed_event("hello");
        assert!(!Event { sig: "z".repeat(128), ..good.clone() }.verify_sig());
        assert!(!Event { pubkey: "z".repeat(64), ..good.clone() }.verify_sig());
    }
}
