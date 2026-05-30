//! Chat-focused memory system for RomanBath.
//!
//! Ported and simplified from Sigil's `memory-core`, adapted for
//! character-driven chat bots with ACT-R decay, FTS5 search, a
//! three-stage dreaming pipeline, and per-character namespace isolation.

pub mod chat_memory;
pub mod dreaming;
pub mod enrichment;
pub mod memory_crud;
pub mod noise;
pub mod schema;
pub mod scorer;
pub mod types;

pub use chat_memory::ChatMemoryStore;
pub use dreaming::DreamingPipeline;
pub use enrichment::MemoryEnricher;
