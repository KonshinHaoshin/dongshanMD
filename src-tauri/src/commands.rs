// Tauri 命令定义
// 这个模块专门用于定义 Tauri 命令，避免重复定义问题

#[tauri::command]
pub fn get_file_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

