use tauri::Emitter;

// 清理文件路径，移除可能的引号
pub fn clean_file_path(path: &str) -> String {
    path.trim_matches('"').trim_matches('\'').trim().to_string()
}

// 将路径转换为绝对路径
pub fn to_absolute_path(path: &str) -> String {
    use std::path::Path;
    
    let cleaned = clean_file_path(path);
    let path_buf = Path::new(&cleaned);
    
    // 如果已经是绝对路径，直接返回
    if path_buf.is_absolute() {
        // 即使是绝对路径，也尝试 canonicalize 来规范化（处理 .. 和 . 等）
        if let Ok(canonical) = std::fs::canonicalize(&path_buf) {
            if let Some(canonical_str) = canonical.to_str() {
                return canonical_str.to_string();
            }
        }
        return cleaned;
    }
    
    println!("检测到相对路径: {}, 当前工作目录: {:?}", cleaned, std::env::current_dir());
    
    // 如果是相对路径，尝试解析为绝对路径
    // 首先直接尝试 canonicalize（相对于当前工作目录）
    match std::fs::canonicalize(&path_buf) {
        Ok(absolute) => {
            if let Some(absolute_str) = absolute.to_str() {
                println!("通过 canonicalize 得到绝对路径: {}", absolute_str);
                return absolute_str.to_string();
            }
        }
        Err(e) => {
            println!("canonicalize 失败 (路径可能不存在): {:?}, 尝试使用当前工作目录组合", e);
        }
    }
    
    // 如果 canonicalize 失败（文件可能还不存在），使用当前工作目录组合路径
    match std::env::current_dir() {
        Ok(current_dir) => {
            let absolute = current_dir.join(&path_buf);
            if let Some(absolute_str) = absolute.to_str() {
                println!("使用当前工作目录组合路径: {}", absolute_str);
                // 再次尝试 canonicalize 来规范化路径
                match std::fs::canonicalize(&absolute) {
                    Ok(canonical) => {
                        if let Some(canonical_str) = canonical.to_str() {
                            println!("规范化后的绝对路径: {}", canonical_str);
                            return canonical_str.to_string();
                        }
                    }
                    Err(_) => {
                        // 如果文件不存在，返回组合后的绝对路径（仍然有效）
                        println!("文件可能不存在，使用组合路径: {}", absolute_str);
                    }
                }
                return absolute_str.to_string();
            }
        }
        Err(e) => {
            eprintln!("无法获取当前工作目录: {:?}", e);
        }
    }
    
    // 如果都失败了，返回原始路径
    println!("无法转换为绝对路径，返回原始路径: {}", cleaned);
    cleaned
}

// 检查是否是支持的文件类型
pub fn is_supported_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || 
    lower.ends_with(".markdown") || 
    lower.ends_with(".txt")
}

// 处理文件路径并发送事件
pub fn process_and_emit_file(app_handle: tauri::AppHandle, file_path: String) {
    let cleaned_path = clean_file_path(&file_path);
    let absolute_path = to_absolute_path(&cleaned_path);
    println!("处理文件路径: {} -> {} -> {}", file_path, cleaned_path, absolute_path);
    
    if is_supported_file(&absolute_path) {
        println!("发送文件打开事件: {}", absolute_path);
        // 延迟发送，确保前端已准备好
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(800));
            if let Err(e) = app_handle.emit("open-file", &absolute_path) {
                eprintln!("发送文件打开事件失败: {:?}", e);
            } else {
                println!("文件打开事件已发送: {}", absolute_path);
            }
        });
    } else {
        println!("不支持的文件类型: {}", absolute_path);
    }
}


