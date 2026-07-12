// Goloso POS — Tauri 2 main
// Wrapper que abre el POS de Heladería Goloso como app de escritorio.
fn main() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Goloso POS");
}
