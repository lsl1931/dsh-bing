# dsh-bing

[![CI](https://github.com/lsl1931/dsh-bing/actions/workflows/ci.yml/badge.svg)](https://github.com/lsl1931/dsh-bing/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-5b8cff)](https://github.com/deepseek-ai)

> English: Windows toast notifications for DSH that name the project, with a warm, selectable phone-style sound pack.

给 DSH 桌面端的**带项目名 Windows 通知**：会话结束、出错或停下来等你时 **bing** 你一下。内置一套柔和、接近手机系统提示音的合成音效，可在插件详情页里逐个试听和切换。

当前版本 **0.2.1**，已在 DSH 桌面端 0.2.1-rc.2 / Windows 11 上实装。

## 为什么再做一个

参考插件 dsh-notify-desktop 的接缝选得很对，但两件事不顺手：

1. 通知只说了“任务完成”，没说是哪个项目、哪次会话；
2. 电子短音太生硬；这一版换成温和的铃、木琴、卡林巴、水滴，带一点房间混响。

这个仓库同时保留原插件已经验证过的东西：窗口有焦点不打扰、点通知回前台、切回窗口立刻停声、服务级提问也能提醒。

## 特性

- 标题：**项目名 · 已完成** / 出错了 / 等你确认 / 还在等你
- 正文：真实会话标题 + 本轮摘要
- 项目名解析：重命名过的工作区标题 → cwd 最后一段 → 真实会话标题 → DSH
- 音效：8 个柔和合成音（0.8–1.9 秒），四类场景（完成 / 出错 / 等待 / 催办）各选一个，每个都能试听
- 入口：侧边栏 **插件 → dsh-bing 详情页** 的配置区，不占用设置页
- 自定义：导入自己的 wav/mp3/…；复制到本机用户目录，原文件移走也不影响
- 点通知把窗口拉回前台；宿主 Toast 的点击回包只有 `dsh://open`，所以不跳转会话

## 内置音效

| 名称 | 文件 | 场景 | 时长 |
| --- | --- | --- | --- |
| 极光 | sounds/01-aurora.wav | 完成（默认） | 1.8s |
| 木琴 | sounds/02-marimba.wav | 完成 | 1.3s |
| 卡林巴 | sounds/03-kalimba.wav | 完成 | 1.1s |
| 玻璃 | sounds/04-glass.wav | 等待（默认） | 1.5s |
| 气泡 | sounds/05-bubble.wav | 等待 | 0.8s |
| 低音 | sounds/06-low.wav | 出错（默认） | 1.0s |
| 回声 | sounds/07-descend.wav | 出错 | 1.3s |
| 花开 | sounds/08-bloom.wav | 催办（默认） | 1.9s |

全部由 scripts/generate-sounds.mjs 合成，44.1kHz / 单声道 / 16-bit PCM，按 RMS 校准响度。
可以直接双击 `sounds/*.wav` 试听，也可以在插件详情页里点 ▶。

**关于苹果/华为原声**：它们的系统音效有版权，仓库不直接打包。这 8 个是按“软起音、木质/玻璃/铃、带一点空间感”的听感重新合成的。
如果你本机有正版音效文件，插件详情页的「添加音效…」可以直接导入；文件只复制到本机用户目录，不会上传。

## 环境

- Windows 10 / 11
- DSH 桌面端 0.2.x（profile `desktop`）
- 普通用户不需要 Node；仓库里的 `lib/` 已经构建好

## 安装

从 GitHub 安装（DSH CLI 会把参数转给 pnpm）：

    & "<DSH 桌面端安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "github:lsl1931/dsh-bing"

本地开发时用链接安装（路径换成你的 clone）：

    & "<DSH 桌面端安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<绝对路径>\dsh-bing"

装完**完全退出并重启** DSH 桌面端。不要和 dsh-notify-desktop 同时启用，否则同一轮会弹两条通知。

所有数据都在本机：偏好存渲染层 localStorage，导入的音效复制到 `%LOCALAPPDATA%\dsh-bing\custom`，不上传任何内容。

## 配置

侧边栏打开 **插件**，进入 **dsh-bing** 详情页。配置区在描述和组件列表之间，
包含总开关、提示音、五类结束状态、三类等待确认、四类音效选择 + 试听、催办分钟数、测试通知、自定义音效导入/删除/缓存清理。

这是 plugin-manager 给组合包自带配置的官方 slot（`plugins.bundle.config`，key `dsh-bing`），不需要修改 harness。

## 开发

零运行时依赖；宿主是纯 ESM，客户端是 CJS 模块由 `build.mjs` 打成一个 bundle。

    npm run sounds         # 重新生成 8 个音效
    npm run sounds:check   # 校验已提交的音效（含逐字节可复现）
    npm test               # node:test（36 个用例）
    npm run build          # 生成 lib/index.js、lib/shared/*、lib/client.js
    npm run check          # 音效校验 + 单测 + 构建

Node >= 22。改完源码后重新 `npm run build` 并重启 DSH。

## 已知限制

- 仅 Windows；Toast 与 System.Media.SoundPlayer 都是 Windows 路径。
- 点通知只回前台，不跳会话。
- 顶层插件列表卡片不显示配置；配置在 dsh-bing 的详情页。
- 苹果/华为原始系统音效有版权，仓库只提供风格接近的合成音；自定义导入走本机目录。

## 目录

    src/index.js          宿主半：projection + 13 条路由 + Toast/音频
    src/shared/           schema、projection、音效库与 WAV 缓存
    src/client/           watcher、文案、设置、React 配置面板
    sounds/catalog.json   内置音效的单一事实来源
    scripts/              合成与 WAV 工具
    lib/                  构建产物（提交，profile 直接链接）
    PLAN.md               实现规划与设计决策

## 参考与许可

实现思路参考了 [paleech0/dsh-notify-desktop](https://github.com/paleech0/dsh-notify-desktop)（MIT）公开的行为与接缝说明；代码为本仓库独立实现。

音效文件由本仓库脚本生成，随本仓库以 MIT 发布。许可证见 [LICENSE](LICENSE)。
