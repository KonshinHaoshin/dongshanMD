# Tauri v2 Android 实现指南

根据 [Tauri v2 移动端开发文档](https://v2.tauri.app/develop/plugins/develop-mobile/)，本指南将帮助你将 DongshanMD 应用打包为 Android APK。

## 前置要求

### 1. 安装 Android Studio
- 下载并安装 [Android Studio](https://developer.android.com/studio)
- 在 Android Studio 中安装 Android SDK Platform 34 和 Android NDK

### 2. 配置环境变量

**Windows PowerShell:**
```powershell
# 设置 Java 路径（根据实际安装路径调整）
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"

# 设置 Android SDK 路径
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"

# 设置 NDK 路径（需要先安装 NDK）
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\<version>"

# 添加到 PATH
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\tools;$env:ANDROID_HOME\tools\bin"

# 永久设置（可选）
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
```

**验证安装:**
```bash
java -version
adb version
```

### 3. 安装 Rust Android 目标

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### 4. 安装 Android 构建工具

```bash
# 安装 cargo-ndk（用于构建 Android 库）
cargo install cargo-ndk

# 安装 Android 平台工具
# 在 Android Studio SDK Manager 中安装：
# - Android SDK Platform-Tools
# - Android SDK Build-Tools
# - NDK (Side by side)
```

## 初始化 Android 项目

### 1. 初始化 Android 配置

```bash
npm run tauri android init
```

这个命令会：
- 创建 `src-tauri/gen/android` 目录
- 生成 Android Gradle 项目结构
- 配置 Android 清单文件

### 2. 验证配置

检查 `src-tauri/tauri.conf.json` 中的 Android 配置是否正确：

```json
{
  "bundle": {
    "android": {
      "compileSdkVersion": 34,
      "minSdkVersion": 21,
      "targetSdkVersion": 34,
      "packageName": "com.dongshan.md",
      "applicationLabel": "DongshanMD",
      "versionCode": 1,
      "versionName": "0.1.0",
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE"
      ]
    }
  }
}
```

## 移动端插件适配

### 当前使用的插件兼容性

你的项目使用了以下 Tauri 插件：
- `tauri-plugin-dialog` - 文件对话框
- `tauri-plugin-fs` - 文件系统操作
- `tauri-plugin-shell` - Shell 命令

**注意：** 这些插件在移动端的行为可能与桌面端不同：

1. **文件对话框** - Android 上使用系统文件选择器
2. **文件系统** - 需要适配 Android 的存储权限和路径
3. **Shell** - Android 上可能不可用或受限

### 代码适配建议

#### 1. 平台检测

在代码中添加平台检测：

```typescript
import { getCurrent } from '@tauri-apps/api/window';

const isMobile = () => {
  try {
    // Tauri 移动端会设置特定标识
    return window.navigator.userAgent.includes('TauriMobile');
  } catch {
    return false;
  }
};
```

#### 2. 文件操作适配

创建平台适配层：

```typescript
// src/utils/platformAdapter.ts
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { open, save } from '@tauri-apps/plugin-dialog';

export async function openFileMobile() {
  if (isMobile()) {
    // Android 上使用 HTML5 File API 或原生文件选择器
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.txt,.markdown';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const content = await file.text();
          resolve({ path: file.name, content });
        }
      };
      input.click();
    });
  } else {
    return await openFile();
  }
}
```

## 构建和运行

### 开发模式（在模拟器或设备上运行）

```bash
# 连接 Android 设备或启动模拟器
adb devices

# 运行开发版本
npm run tauri android dev
```

### 构建发布版本

```bash
# 构建 APK
npm run tauri android build

# 构建 AAB (用于 Google Play)
npm run tauri android build -- --bundle
```

构建产物位置：
- APK: `src-tauri/target/android/app/build/outputs/apk/`
- AAB: `src-tauri/target/android/app/build/outputs/bundle/`

## Android 16KB 内存页支持

Google 要求新应用支持 16KB 内存页。在 `src-tauri/.cargo/config.toml` 中添加：

```toml
[target.aarch64-linux-android]
rustflags = ["-C", "link-arg=-Wl,-z,max-page-size=16384"]
```

## 权限配置

在 `tauri.conf.json` 中已配置基本权限。如需更多权限，添加：

```json
{
  "bundle": {
    "android": {
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.MANAGE_EXTERNAL_STORAGE"  // Android 11+ 需要
      ]
    }
  }
}
```

## 常见问题

### 1. 构建失败：找不到 NDK
- 确保在 Android Studio 中安装了 NDK
- 检查 `ANDROID_HOME` 和 `NDK_HOME` 环境变量

### 2. 插件不兼容
- 检查插件是否支持移动端
- 查看插件的移动端文档
- 考虑使用平台特定的实现

### 3. 文件路径问题
- Android 使用不同的文件系统路径
- 使用 Tauri 的文件系统 API 而不是硬编码路径

## 参考资源

- [Tauri v2 移动端插件开发](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [Tauri v2 Android 分发指南](https://v2.tauri.app/distribute/android/)
- [Tauri v2 前置要求](https://v2.tauri.app/start/prerequisites/)

## 下一步

1. 运行 `npm run tauri android init` 初始化项目
2. 测试文件操作功能在 Android 上的表现
3. 适配移动端 UI（响应式设计）
4. 测试并修复移动端特定的问题
5. 构建并签名 APK 用于发布


