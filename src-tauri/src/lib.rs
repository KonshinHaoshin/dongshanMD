mod app;

// 命令定义
#[tauri::command]
pub fn get_file_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

pub fn run_app() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_file_args])
        .setup(|app| {
            // 处理通过文件关联打开的文件
            let app_handle = app.handle().clone();
            
            // 获取命令行参数
            let args: Vec<String> = std::env::args().skip(1).collect();
            println!("收到命令行参数: {:?}", args);
            
            // 过滤出支持的文件类型（.md, .markdown, .txt）
            // 注意：这里不转换为绝对路径，因为 is_supported_file 只检查扩展名
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
                // 处理第一个文件
                let file_path = file_args[0].clone();
                app::process_and_emit_file(app_handle.clone(), file_path);
            } else {
                println!("未找到支持的文件类型");
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

