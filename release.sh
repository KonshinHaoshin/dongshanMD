#!/bin/bash

# DongshanMD 发布脚本
# 用于 GitHub Actions 自动化构建和发布

set -e  # 遇到错误立即退出

echo "🚀 开始构建 DongshanMD..."

# 检查环境变量
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ 错误: GITHUB_TOKEN 环境变量未设置"
    exit 1
fi

# 安装依赖
echo "📦 安装 Node.js 依赖..."
npm ci

# 安装 Rust 工具链（如果未安装）
if ! command -v rustc &> /dev/null; then
    echo "🦀 安装 Rust 工具链..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 安装 Tauri CLI
echo "📱 安装 Tauri CLI..."
npm install @tauri-apps/cli

# 检查 Tauri 版本
echo "🔍 检查 Tauri 版本..."
npx tauri --version

# 构建前端
echo "🏗️  构建前端..."
npm run build

# 构建 Tauri 应用
echo "🔨 构建 Tauri 应用..."

# 根据平台选择构建目标
# 首先尝试使用 RUNNER_OS（GitHub Actions 环境变量）
# 如果不存在，则尝试检测当前操作系统
OS_TYPE=""
if [ -n "$RUNNER_OS" ]; then
    OS_TYPE="$RUNNER_OS"
    echo "🔧 使用 RUNNER_OS 环境变量: $OS_TYPE"
else
    # 检测当前操作系统
    case "$(uname -s)" in
        Linux*)     OS_TYPE="Linux" ;;
        Darwin*)    OS_TYPE="macOS" ;;
        CYGWIN*|MINGW*|MSYS*) OS_TYPE="Windows" ;;
        *)          OS_TYPE="UNKNOWN" ;;
    esac
    echo "🔧 检测到操作系统: $OS_TYPE"
fi

if [[ "$OS_TYPE" == "Windows" ]]; then
    echo "🪟 构建 Windows 版本..."
    npx tauri build --target x86_64-pc-windows-msvc
    
    # 重命名输出文件
    if [ -f "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/DongshanMD_1.0.1_x64_en-US.msi" ]; then
        mv "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/DongshanMD_1.0.1_x64_en-US.msi" "DongshanMD-Windows-x64.msi"
    fi
    
elif [[ "$OS_TYPE" == "macOS" ]]; then
    echo "🍎 构建 macOS 版本..."
    npx tauri build --target universal-apple-darwin
    
    # 重命名输出文件
    if [ -f "src-tauri/target/universal-apple-darwin/release/bundle/macos/DongshanMD.app.tar.gz" ]; then
        mv "src-tauri/target/universal-apple-darwin/release/bundle/macos/DongshanMD.app.tar.gz" "DongshanMD-macOS-universal.tar.gz"
    fi
    
elif [[ "$OS_TYPE" == "Linux" ]]; then
    echo "🐧 构建 Linux 版本..."
    npx tauri build --target x86_64-unknown-linux-gnu
    
    # 重命名输出文件
    if [ -f "src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/dongshanmd_1.0.1_amd64.deb" ]; then
        mv "src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/dongshanmd_1.0.1_amd64.deb" "DongshanMD-Linux-x64.deb"
    fi
else
    echo "❌ 不支持的操作系统: $OS_TYPE"
    echo "💡 提示: 在 GitHub Actions 中，RUNNER_OS 环境变量应该自动设置"
    echo "💡 提示: 当前环境变量: RUNNER_OS=$RUNNER_OS"
    exit 1
fi

# 列出构建产物
echo "📁 构建产物:"
ls -la *.msi *.tar.gz *.deb *.AppImage 2>/dev/null || true

echo "✅ 构建完成!"