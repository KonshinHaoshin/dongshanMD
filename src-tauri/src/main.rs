// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![commands::get_file_args])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let args: Vec<String> = std::env::args().skip(1).collect();
            println!("收到命令行参数: {:?}", args);
            
            let file_args: Vec<String> = args.iter()
                .map(|arg| app::clean_file_path(arg))
                .filter(|arg| {
                    let is_file = app::is_supported_file(arg);
                    if is_file {
                        println!("找到支持的文件: {}", arg);
                    }
                    is_file
                })
                .collect();
            
            if !file_args.is_empty() {
                let file_path = file_args[0].clone();
                app::process_and_emit_file(app_handle.clone(), file_path);
            } else {
                println!("未找到支持的文件类型");
            }

            // 生产环境下自动打开 DevTools（方便排查问题）
            // if !cfg!(debug_assertions) {
            //     if let Some(window) = app.get_webview_window("main") {
            //         window.open_devtools();
            //     }
            // }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

