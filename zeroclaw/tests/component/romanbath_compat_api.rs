//! RomanBath compatibility API contract tests.
//!
//! RomanBath depends on these gateway REST shapes even as upstream ZeroClaw
//! moves toward newer RPC/WebSocket surfaces. These tests intentionally touch
//! the public gateway modules and request/response types so upstream syncs
//! cannot remove or rename the compatibility layer silently.

use zeroclaw::gateway::{
    api_characters::{
        BookResponse, CharacterSummary, CharactersResponse, EntryResponse, ListQuery,
        handle_character_avatar, handle_create_character, handle_create_entry,
        handle_delete_character, handle_delete_entry, handle_duplicate_character,
        handle_export_character, handle_get_book, handle_get_character, handle_import_character,
        handle_list_characters, handle_put_book, handle_update_character, handle_update_entry,
        handle_upload_character, handle_upload_character_avatar,
    },
    api_chat::{ChatRequest, ChatResponse},
    api_files::handle_serve_file,
    api_image_gen::{ImageGenRequest, ImageGenResponse, handle_image_gen},
    api_tts::{TtsRequest, handle_tts},
};

#[test]
fn romanbath_compat_character_handlers_remain_public() {
    let _ = handle_list_characters;
    let _ = handle_create_character;
    let _ = handle_import_character;
    let _ = handle_upload_character;
    let _ = handle_get_character;
    let _ = handle_update_character;
    let _ = handle_delete_character;
    let _ = handle_export_character;
    let _ = handle_duplicate_character;
    let _ = handle_character_avatar;
    let _ = handle_upload_character_avatar;
    let _ = handle_serve_file;

    let response = CharactersResponse {
        characters: vec![CharacterSummary {
            name: "Ada".to_string(),
            description: "A test character".to_string(),
            personality: "curious".to_string(),
            scenario: "lab".to_string(),
            first_mes: "hello".to_string(),
            tags: vec!["test".to_string()],
            creator: "RomanBath".to_string(),
            character_version: "1.0".to_string(),
            has_avatar: true,
            nickname: "Ada".to_string(),
            has_character_book: true,
            has_assets: false,
            alternate_greeting_count: 1,
            creator_notes_badge: Some("v1".to_string()),
            modification_date: Some("2026-06-17T00:00:00Z".to_string()),
            creation_date: Some("2026-06-01T00:00:00Z".to_string()),
        }],
    };

    let json = serde_json::to_value(response).expect("serialize character response");
    assert_eq!(json["characters"][0]["name"], "Ada");
    assert_eq!(json["characters"][0]["has_avatar"], true);
    // V3-aware fields the frontend reads without re-fetching every card.
    assert_eq!(json["characters"][0]["has_character_book"], true);
    assert_eq!(json["characters"][0]["has_assets"], false);
    assert_eq!(json["characters"][0]["alternate_greeting_count"], 1);
    assert_eq!(json["characters"][0]["nickname"], "Ada");
    assert_eq!(json["characters"][0]["creator_notes_badge"], "v1");
    assert_eq!(
        json["characters"][0]["modification_date"],
        "2026-06-17T00:00:00Z"
    );
    // creation_date is internal — never serialized.
    assert!(json["characters"][0].get("creation_date").is_none());
}

#[test]
fn romanbath_compat_list_query_defaults_match_frontend_assumptions() {
    // Empty query string → no filters, no sort override. The frontend treats
    // a 200 response with no params as "all cards, name-sorted".
    let empty: ListQuery = serde_json::from_str("{}").expect("empty list query must deserialize");
    assert!(empty.search.is_none());
    assert!(empty.tag.is_none());
    assert!(empty.creator.is_none());
    assert!(empty.sort.is_none());

    let full: ListQuery = serde_json::from_str(
        r#"{"search":"lab","tag":"test","creator":"RomanBath","sort":"recent"}"#,
    )
    .expect("full list query must deserialize");
    assert_eq!(full.search.as_deref(), Some("lab"));
    assert_eq!(full.tag.as_deref(), Some("test"));
    assert_eq!(full.creator.as_deref(), Some("RomanBath"));
    assert_eq!(full.sort.as_deref(), Some("recent"));
}

#[test]
fn romanbath_compat_lorebook_handlers_remain_public() {
    // Lorebook independent CRUD routes — the frontend edits one entry
    // without rewriting the whole card.
    let _ = handle_get_book;
    let _ = handle_put_book;
    let _ = handle_create_entry;
    let _ = handle_update_entry;
    let _ = handle_delete_entry;

    // Entry shape with stable id — surfaced on every lorebook response.
    let entry_response = EntryResponse {
        entry: zeroclaw_cards::CharacterBookEntry {
            id: "entry-1".to_string(),
            keys: vec!["lab".to_string()],
            content: "The lab is underground.".to_string(),
            enabled: true,
            selective: false,
            secondary_keys: Vec::new(),
            constant: false,
            position: "before_char".to_string(),
            token_budget: None,
            priority: None,
            recursive: false,
        },
    };
    let json = serde_json::to_value(entry_response).expect("serialize entry response");
    assert_eq!(json["entry"]["id"], "entry-1");
    assert_eq!(json["entry"]["keys"][0], "lab");

    // Book response echoes either the full book or null.
    let book_response = BookResponse {
        book: Some(zeroclaw_cards::CharacterBook {
            name: "LabLore".to_string(),
            description: String::new(),
            entries: Vec::new(),
        }),
    };
    let json = serde_json::to_value(book_response).expect("serialize book response");
    assert_eq!(json["book"]["name"], "LabLore");

    let empty_book = BookResponse { book: None };
    let json = serde_json::to_value(empty_book).expect("serialize empty book response");
    assert!(json["book"].is_null());
}

#[test]
fn romanbath_compat_chat_request_accepts_frontend_payload() {
    let req: ChatRequest = serde_json::from_value(serde_json::json!({
        "messages": [
            {"role": "user", "content": "hello"}
        ],
        "character_name": "Ada",
        "system_prompts": ["speaker order matters"],
        "mode": "play",
        "stream": true,
        "temperature": 0.7,
        "max_tokens": 512,
        "top_p": 0.9,
        "top_k": 40,
        "frequency_penalty": 0.1,
        "presence_penalty": 0.2,
        "stop": ["\nUser:"],
        "seed": 7,
        "user_name": "Tester",
        "user_description": "A careful operator",
        "max_context_tokens": 4096,
        "scene_mode": true,
        "scenario": "A quiet room",
        "example_dialogue": "Ada: hello",
        "lorebook": [
            {"keys": ["lab"], "content": "The lab is underground.", "enabled": true}
        ],
        "system_prompt_override": "Stay in character.",
        "authors_note": "Use concise replies.",
        "authors_note_depth": 1,
        "prompt_order": "style_first",
        "user_prefix": "User",
        "model_prefix": "Ada",
        "context_template": "default",
        "prompt_template": "default",
        "negative_prompt": "out of character"
    }))
    .expect("frontend chat payload must deserialize");

    assert_eq!(req.messages.len(), 1);
    assert_eq!(req.character_name.as_deref(), Some("Ada"));
    assert_eq!(req.mode, "play");
    assert!(req.stream);
    assert_eq!(req.system_prompts, ["speaker order matters"]);
    assert_eq!(req.max_tokens, Some(512));
    assert_eq!(req.lorebook[0].keys, ["lab"]);

    let response = serde_json::to_value(ChatResponse {
        text: "ok".to_string(),
    })
    .expect("serialize chat response");
    assert_eq!(response["text"], "ok");
}

#[test]
fn romanbath_compat_chat_request_defaults_match_frontend_assumptions() {
    let req: ChatRequest = serde_json::from_value(serde_json::json!({
        "messages": [
            {"role": "user", "content": "hello"}
        ]
    }))
    .expect("minimal chat payload must deserialize");

    assert_eq!(req.mode, "play");
    assert!(!req.stream);
    assert!(req.system_prompts.is_empty());
    assert!(req.character_name.is_none());
}

#[test]
fn romanbath_compat_image_request_and_response_shape_remain_stable() {
    let _ = handle_image_gen;

    let req: ImageGenRequest = serde_json::from_value(serde_json::json!({
        "prompt": "portrait",
        "resolution": "2k"
    }))
    .expect("frontend image payload must deserialize");
    assert_eq!(req.prompt, "portrait");
    assert_eq!(req.resolution, "2k");

    let defaulted: ImageGenRequest = serde_json::from_value(serde_json::json!({
        "prompt": "portrait"
    }))
    .expect("image payload default resolution must deserialize");
    assert_eq!(defaulted.resolution, "1k");

    let response = serde_json::to_value(ImageGenResponse {
        success: true,
        image_data_url: Some("data:image/png;base64,AA==".to_string()),
        error: None,
    })
    .expect("serialize image response");
    assert_eq!(response["success"], true);
    assert_eq!(response["image_data_url"], "data:image/png;base64,AA==");
    assert!(response.get("error").is_none());
}

#[test]
fn romanbath_compat_tts_request_defaults_match_frontend_assumptions() {
    let _ = handle_tts;

    let req: TtsRequest = serde_json::from_value(serde_json::json!({
        "text": "hello"
    }))
    .expect("minimal TTS payload must deserialize");

    assert_eq!(req.text, "hello");
    assert_eq!(req.voice_id, "ara");
    assert_eq!(req.language, "en-US");
}
