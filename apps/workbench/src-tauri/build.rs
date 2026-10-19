fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_store",
            "save_cards",
            "save_settings",
            "save_search_history",
            "read_archive",
            "read_api_key",
            "write_api_key",
            "export_archive",
            "fetch_clip",
            "read_text_file",
            "complete_chat",
            "open_url",
            "db_load_cards",
            "db_upsert_card",
            "db_delete_card",
            "db_search_cards_fts",
            "db_save_material",
            "db_list_materials",
            "db_update_material_status",
            "db_get_stats",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
