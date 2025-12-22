# DongshanMD

一个基于 Tauri + SolidJS + TypeScript + CherryMarkdown 的 Markdown 编辑器。

## 技术栈

- **Tauri**: 跨平台桌面应用框架
- **SolidJS**: 高性能响应式 UI 框架
- **TypeScript**: 类型安全的 JavaScript
- **CherryMarkdown**: 强大的 Markdown 编辑器

## 开发

### 前置要求

- Node.js (推荐 v18+)
- Rust (推荐最新稳定版)
- Tauri CLI

### 安装 Tauri CLI

```bash
npm install -g @tauri-apps/cli
# 或者
cargo install tauri-cli
```

### 安装依赖

```bash
# 安装前端依赖
npm install
```

### 开发模式

```bash
npm run dev
# 或者使用 Tauri 开发模式
npm run tauri dev
```

### 构建

```bash
npm run build
# 或者构建 Tauri 应用
npm run tauri build
```

## 项目结构

```
dongshanMd/
├── src/                    # 前端源代码
│   ├── components/         # SolidJS 组件
│   ├── App.tsx            # 主应用组件
│   └── main.tsx           # 应用入口
├── src-tauri/             # Tauri 后端代码
│   └── src/
│       └── main.rs        # Rust 主文件
├── index.html             # HTML 入口
├── package.json           # 前端依赖配置
├── Cargo.toml            # Rust 依赖配置
└── tauri.conf.json       # Tauri 配置文件
```

## 功能特性

- ✅ Markdown 实时编辑和预览
- ✅ 丰富的工具栏
- ✅ 语法高亮
- ✅ 跨平台支持（Windows, macOS, Linux）

## 许可证

MIT

