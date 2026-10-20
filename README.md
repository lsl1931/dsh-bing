# dsh-pulse

给 DSH 桌面端的**带项目名的 Windows 通知**，外加一套**电子、极简**、可以逐个试听和替换的提示音。

> 当前状态：**脚手架 + 设计稿**。仓库可以构建、音效已经生成，但插件本体（M1 起）还没实现。
> 完整的代码级设计见 [PLAN.md](PLAN.md)。现在安装它不会弹任何通知。

## 为什么再做一个

参考插件 dsh-notify-desktop 的接缝选得很对，但两件事不顺手：

1. 通知只说了“任务完成”，没说是哪个项目、哪次会话；
2. 内置音效偏原声，系统音效又彼此很像；这里换成一包电子/极简的合成短音。

这个仓库要解决的就是这两点，同时保留原插件已经验证过的东西：窗口有焦点不打扰、点通知回前台、
切回窗口立刻停声、服务级提问也能提醒。

## 会做成什么样

- 标题：**项目名 · 已完成** / 出错了 / 等你确认 / 还在等你
- 正文：真实会话标题 + 本轮摘要
- 项目名解析：重命名过的工作区标题 → cwd 最后一段 → 真实会话标题 → DSH
- 音效：8 个电子/极简合成短音（最长 0.72 秒），四类场景（完成 / 出错 / 等待 / 催办）各选一个，每个都能试听
- 入口：**设置 → 插件（内置插件页）→ 通知音效**，以及 **设置 → 通知** 完整页
- 点通知只把窗口拉回前台，不跳转会话：宿主 Toast 的点击回包只有 dsh://open，这是壳的限制
- 自定义：导入自己的 wav/mp3/…；复制到本机用户目录，原文件移走也不影响

## 内置音效

| 名称 | 文件 | 场景 | 时长 |
| --- | --- | --- | --- |
| 脉冲 | sounds/01-pulse.wav | 完成 | 0.34s |
| 双点 | sounds/02-blip.wav | 完成 | 0.30s |
| 金属铃 | sounds/08-chime.wav | 完成 | 0.72s |
| 轻点 | sounds/03-tick.wav | 等待 | 0.16s |
| 扫描 | sounds/04-scan.wav | 等待 | 0.36s |
| 低频 | sounds/05-low.wav | 出错 | 0.60s |
| 下行双音 | sounds/06-error.wav | 出错 | 0.52s |
| 弧线 | sounds/07-arc.wav | 催办 | 0.50s |

现在就可以用资源管理器双击试听。全部由 scripts/generate-sounds.mjs 合成，44.1kHz / 单声道 / 16-bit PCM，
按 RMS 校准过响度（不会出现“完成很轻、出错很响”）。

## 开发

    npm run sounds         # 重新生成 8 个音效
    npm run sounds:check   # 校验已提交的音效
    npm test               # node:test
    npm run build          # 生成 lib/index.js 与 lib/client.js
    npm run check          # 以上全部

不依赖任何 npm 包；Node >= 22。

## 放哪儿选音效

顶层侧边栏那个“插件”管理器页是桌面壳自己的页面，没有公开插槽，第三方插件加不了控件。
本插件把选择器放在 **设置 → 插件（内置插件页）→ 通知音效**，只差一层；同时保留 **设置 → 通知** 的完整页。

## 安装（M1 之后）

仓库放在固定目录（profile 会用链接指向它）：

    & "<DSH 桌面端安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\RJ\dsh-plugins\dsh-pulse"

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