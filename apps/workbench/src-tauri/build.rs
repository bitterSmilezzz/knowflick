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
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
