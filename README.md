# dsh-notify-plus

给 DSH 桌面端的**带项目名的 Windows 通知**，外加一套可以逐个试听、随时替换的提示音。

> 当前状态：**脚手架 + 设计稿**。仓库可以构建、音效已经生成，但插件本体（M1 起）还没实现。
> 完整的代码级设计见 [PLAN.md](PLAN.md)。现在安装它不会弹任何通知。

## 为什么再做一个

参考插件 dsh-notify-desktop 的接缝选得很对，但两件事不顺手：

1. 通知只说了“任务完成”，没说是哪个项目、哪次会话；
2. 内置音效只有两个 wav，系统音效又彼此很像，听久了很吵。

这个仓库要解决的就是这两点，同时保留原插件已经验证过的东西：窗口有焦点不打扰、点通知回前台、
切回窗口立刻停声、服务级提问也能提醒。

## 会做成什么样

- 标题：**项目名 · 已完成** / 出错了 / 等你确认 / 还在等你
- 正文：会话标题 + 本轮摘要
- 项目名解析：自定义工作区标题 → cwd 最后一段 → 会话标题 → DSH
- 音效：8 个程序生成的内置音效，四类场景（完成 / 出错 / 等待 / 催办）各选一个，每个都能试听
- 入口：**设置 → 插件 → 通知音效**，以及 **设置 → 通知** 完整页
- 自定义：导入自己的 wav/mp3/…；复制到本机用户目录，原文件移走也不影响

## 内置音效

| 名称 | 文件 | 场景 | 时长 |
| --- | --- | --- | --- |
| 水晶铃 | sounds/01-crystal.wav | 完成 | 1.4s |
| 木琴 | sounds/02-marimba.wav | 完成 | 1.2s |
| 竖琴 | sounds/03-harp.wav | 完成 | 1.5s |
| 木鱼 | sounds/04-woodblock.wav | 等待 | 0.6s |
| 水滴 | sounds/05-droplet.wav | 等待 | 0.9s |
| 低音钟 | sounds/06-low-bell.wav | 出错 | 1.8s |
| 下行双音 | sounds/07-descend.wav | 出错 | 1.2s |
| 玻璃琶音 | sounds/08-glass.wav | 催办 | 1.4s |

现在就可以用资源管理器双击试听。全部由 scripts/generate-sounds.mjs 合成，44.1kHz / 单声道 / 16-bit PCM。

## 开发

    npm run sounds         # 重新生成 8 个音效
    npm run sounds:check   # 校验已提交的音效
    npm test               # node:test
    npm run build          # 生成 lib/index.js 与 lib/client.js
    npm run check          # 以上全部

不依赖任何 npm 包；Node >= 22。

## 安装（M1 之后）

仓库放在固定目录（profile 会用链接指向它）：

    & "<DSH 桌面端安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\RJ\dsh-plugins\dsh-notify-plus"

然后重启 DSH 桌面端。不要和 dsh-notify-desktop 同时启用，否则同一轮会弹两条通知。

## 目录

    src/index.js          宿主半（投影 + 路由）
    src/client/           客户端半（watcher + 设置 UI）
    sounds/catalog.json   内置音效的单一事实来源
    scripts/              合成与 WAV 工具
    lib/                  构建产物（提交）
    PLAN.md               实现规划

## 参考与许可

实现思路参考了 paleech0/dsh-notify-desktop（MIT）公开的行为与接缝说明；代码为本仓库独立实现。
音效文件由本仓库脚本生成，随本仓库以 MIT 发布。许可证见 [LICENSE](LICENSE)。
