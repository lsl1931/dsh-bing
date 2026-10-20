# dsh-notify-plus 实现规划

- 状态：设计稿 v0.1（2026-10-19）
- 目标运行时：DSH 桌面端 0.2.1-rc.2（Windows profile desktop）
- 参考实现：dsh-notify-desktop 0.1.1（MIT）
- 本文回答一个问题：**接下来写代码时，每个文件负责什么、数据从哪来、失败时怎么办。**

## 1. 目标与非目标

### 1.1 用户可见目标

1. 会话结束、出错、或停下来等人时弹 Windows 原生通知，**标题一定带项目名**。
2. 通知正文带**会话标题**（这一次对话是哪一条）和结果摘要，不让用户猜。
3. 内置一组耐听、可区分的提示音（8 个），四类场景各自可选，**每个都能当场试听**。
4. 音效选择放在两个地方：设置 → 插件 → 「通知音效」标签页（主入口），以及设置 → 通知（完整设置页）。
5. 支持导入自己的音效文件；导入后出现在选择器里，可预览、可删除。
6. 窗口有焦点时不打扰；点通知回前台；切回窗口或关掉提示音时，正在响的声音立刻停。

### 1.2 非目标

- 不做托盘角标、任务栏闪烁、窗口高亮：那些需要 Electron 主进程 API，插件够不到。
- 不做 macOS / Linux：Toast 与 SoundPlayer 都是 Windows 路径。
- 不修改 harness 源码，不改任何 forwarded-event allowlist。
- 不做跨设备同步：偏好存渲染层 localStorage。
- v1 不做音量滑杆：System.Media.SoundPlayer 没有音量 API；用「音效本身的响度设计 + 每场景选择」解决。

## 2. 参考实现中已经验证过的硬约束

这些不是理论，是 0.1.1 的源码与注释里记录的实测结论。新实现必须继承，不能“优化掉”。

| 约束 | 事实 | 对本实现的含义 |
| --- | --- | --- |
| 会话结束信号 | 客户端 session list 上只有 projectionValues；turn/end 不在摘要字段里 | 必须注册自己的 session projection |
| 投影引用稳定 | registry 的变更通知按 Object.is 比较 wire view | fold 遇到无关事件必须返回同一个 state 引用 |
| Toast 音效 | toast 的 audio 只接受 5 个 ms-winsoundevent | 想放自己的音效，必须静音 toast 并由宿主自己播 |
| 播放器 | 从子进程里 WinRT/WPF/WMP 都打不开文件，SoundPlayer 可靠 | 音频只走 System.Media.SoundPlayer |
| 非 wav | SoundPlayer 只认 wav | 自定义 mp3 等用 ffmpeg 转一次 wav 进缓存；没有 ffmpeg 就只支持 wav |
| Toast 子进程 | stdio: 'ignore' 时子进程正常退出但 Windows 不显示通知 | 必须保留管道 stdio 并 drain |
| AUMID | electron.app.DeepSeek Harness | 通知来源显示为 DeepSeek Harness |
| 回前台 | 渲染层无法拉起自己的窗口 | 点通知走 dsh://open，由单实例逻辑 restore/show/focus |
| 焦点判断 | document.hasFocus() 在提问页会误报“失焦” | 客户端问宿主 OS 级前台答案，并保留 5 秒 focus 宽限 |
| 服务级提问 | 计划评审不进会话日志，全局客户端也收不到 agent 级瀑布 | 宿主用 { global: true } 观察 user-questions/request，客户端轮询 |
| 去重 | 同一 turn 可能被折叠/重连观察到多次 | turn 级 dedupe + 60 秒新鲜度窗口 |
| 投影 schema | registry 只调用 stateSchema.parse / viewSchema.parse | 可以写一个 30 行的 parse 兼容层，不引入 zod |

## 3. 与原插件的差异（设计决定）

| 维度 | dsh-notify-desktop 0.1.1 | dsh-notify-plus（本仓库） | 理由 |
| --- | --- | --- | --- |
| 标题 | workspaceName(cwd) || displayTitle | 项目名解析链：工作区标题 → cwd basename → 会话标题 → DSH | 默认分区下的 cwd 才是真正的项目；工作区重命名后优先用重命名 |
| 正文 | 回复摘要；没有会话标题 | 会话标题 + 摘要（最多两行 body text） | 用户明确抱怨“不知道是哪个项目/哪次会话” |
| 音效 | 2 个作者 wav + Windows 20 个；默认 chimes/error | 8 个程序生成的内置音效；四组各自默认 | 系统音效彼此太像，作者音效主观难听；生成式音效可控、可改 |
| 选择入口 | 设置 → 通知 | 设置 → 插件 → 通知音效（新增 tab）+ 设置 → 通知 | 用户希望“在插件目录这边”就能调 |
| 试听 | 发一条测试 toast | 专用 /preview 路由，只播声音不弹通知 | 调音效时不该刷屏通知中心 |
| 依赖 | TypeScript + zod + rolldown，宿主 bundle 210KB | 纯 JS、零依赖、build.mjs 只做包装 | 与本地现有插件一致，链接安装即可，不需要构建工具链 |
| schema | zod | 手写 parse 兼容层 | registry 只用 parse；少一个 200KB 依赖 |
| 声音目录 | 插件 sounds/ + %LOCALAPPDATA%\dsh-notify\custom | 相同模式，目录改为 dsh-notify-plus | 用户可自由扩展，不改代码 |

## 4. 架构与数据流

两半结构，和参考实现一致：

    session/event
        │
        ▼
    host: notifyPlus projection（纯 fold）
        │  wire view（turn / reason / body / pending / updatedAt）
        ▼
    client: sessions.list 的 projectionValues
        │
        ├── 判定：turn 前进？pending 新增？新鲜？去重？有焦点？
        │
        ├── 解析项目名（workspaces.list + summary.cwd + displayTitle）
        ├── 组装文案（项目 · 状态 / 会话标题 / 摘要）
        │
        ▼
    POST /dsh-notify-plus/toast ──► PowerShell：ToastNotification + SoundPlayer
        ▲
        │
    client: settings store（localStorage）◄── 设置页 / 插件页的选择器
        │
        └── POST /preview（只播声音）、/silence、/sound-library …

为什么不用官方现成投影：0.2.1-rc.2 没有“turn 结束原因”的公开 projection；自己注册一个是唯一不改 harness 的通道。

为什么客户端不直接轮询宿主：session list 已经按会话推送投影，复用它比新造一套轮询更省电、也天然覆盖后台会话。

## 5. 目录结构

    dsh-notify-plus/
      package.json            包元数据、dsh.client.inject、脚本
      cordis.patch.yml        把宿主半挂到 Loader
      build.mjs               复制宿主半 + 包装客户端半（零依赖）
      src/
        index.js              宿主入口：注册 projection + routes（M1）
        shared/
          protocol.js         路由、header、投影 key、上限常量
          schema.js           手写 parse 兼容 schema（M1）
          sounds.js           音效目录解析、id 校验、路径白名单（M1）
        client/
          index.js            客户端入口：装配 watcher / UI
          protocol.js         与 shared/protocol.js 对应的常量副本
          settings.js         localStorage store + 校验 + 迁移
          project.js          项目名解析（纯函数）
          summary.js          Markdown 扁平化 + 长度裁剪（纯函数）
          runner.js           边沿检测、去重、新鲜度（纯函数）
          notifier.js         toast / focus / preview / silence / library 的 fetch 封装
          sound-picker.js     React 音效选择器（createElement，无 JSX）
          settings-page.js    设置 → 通知 的完整页面
          plugins-tab.js      设置 → 插件 → 通知音效 的标签页
          styles.js           注入 CSS，使用 DSH 设计 token
      sounds/
        catalog.json          8 个内置音效的单一事实来源
        *.wav                 生成产物（提交进仓库）
        README.md             试听、替换、再生成说明
      scripts/
        generate-sounds.mjs   合成脚本，--check 校验
        lib/wav.mjs           WAV 编解码与电平统计
      test/
        catalog.test.mjs      音效目录与水印校验
        project.test.mjs      项目名解析用例（M2）
        summary.test.mjs      摘要裁剪用例（M2）
        runner.test.mjs       去重/新鲜度用例（M2）
        projection.test.mjs   折叠不变量与事件夹具（M1）
      lib/                    构建产物，提交（profile 直接链接这里）
      README.md
      PLAN.md

## 6. 宿主半实现

### 6.1 入口

    export const name = 'dsh-notify-plus'
    export const inject = ['sessionProjections']

    export function apply(ctx) {
      ctx.sessionProjections.register(notifyPlusProjection())
      ctx.inject(['webServer'], scoped => { …注册 13 条 exact 路由… })
    }

- 只依赖 sessionProjections；webServer 用 inject 子作用域，缺失时投影仍然工作（客户端会退回渲染层通知）。
- 所有 ctx.effect 都要有唯一 label，便于诊断。

### 6.2 notifyPlus projection

状态（会进 checkpoint，必须可 JSON 序列化）：

    {
      inheritedEventCount: number,
      open: { turn: number, text: string } | null,
      last: { turn: number, reason: string, body: string, endedAt: number } | null,
      pending: [{ kind: 'approval'|'question'|'plan-review', requestId, summary }],
      updatedAt: number
    }

wire view（客户端只读这个）：

    {
      turn: number,
      reason: string,           // completed / error / aborted / blocked / max-tokens
      body: string,             // 最后一条助手回复，最多 400 字符
      endedAt: number,          // 本轮结束的宿主时钟，用于“新鲜度”判断
      pending: PendingInteraction[],
      updatedAt: number
    }

处理的事件与不变量：

- turn/start：重置 open；记录 turn。
- assistant/message：只累积当前 turn 的 text block，按 400 字符截断。
- turn/end：把 open 落到 last，reason 取 reason.kind；endedAt 取 event.time。
- approval/asked、approval/decided：pending 增删。
- tool/call 与 tool/ptc-dispatch-start：识别 ask_user_question，按 header/question 生成 summary。
- tool/result、tool/ptc-dispatch、user/message（user-question-reply）：移除对应 pending。
- 其它事件：返回原 state（引用相等），这是 registry 变更通知的前提。
- 事件 seq < inheritedEventCount：fork 继承的历史，跳过。

schema：src/shared/schema.js 提供 object/array/enum/string/number 组合器，每个返回 { parse(value) }，失败抛 Error。只做本投影需要的形状，不做通用校验器。测试要覆盖：合法 state 通过、缺字段/类型错误被拒。

### 6.3 路由

统一前缀 /dsh-notify-plus，全部 same-origin header 校验；POST 才接受写操作；body 上限 8KB。

| 路由 | 方法 | 请求 | 响应 | 用途 |
| --- | --- | --- | --- | --- |
| /toast | POST | {title, lines[], sound, tag} | 204 | 弹通知 |
| /preview | POST | {sound} | 204 | 只播声音，不弹通知 |
| /focus | POST | - | 204 | dsh://open 回前台 |
| /silence | POST | - | 204 | 杀掉正在播放的子进程 |
| /foreground | GET | - | {focused} | OS 级前台判断，1.5s 缓存 |
| /sound-library | GET | - | {builtin, custom} | 选择器数据 |
| /import-sound | POST | {file} | {name} 或 {error} | 复制到用户目录 |
| /delete-sound | POST | {id} | {ok} | 只删 custom: |
| /sound-cache | GET/POST | - | {files,bytes} | 转码缓存统计/清理 |
| /pick-file | POST | - | {path} | Windows 文件选择框（STA 子进程） |
| /questions | GET | - | {seq, items} | 服务级提问队列 |
| /report | POST | 一行文本 | 204 | 客户端诊断环 |
| /debug | GET | - | JSON | 投影状态 + 媒体状态 + 最近报告 |

注意：这些路由不在 /api 下，不经过 API 网关鉴权，所以 header + method 检查是安全边界，不是可选项。

### 6.4 Toast 构造

- XML 通过环境变量传给 PowerShell，绝不拼进命令行。
- 标题与每行正文都做 XML 转义，并分别截断（标题 120、每行 160、总 300）。
- ToastGeneric 允许多个 text：第一个是标题，后面是正文行。本实现发 1 + 2 行：
  1. 项目 · 状态
  2. 会话标题
  3. 摘要
- 音效处理：
  - 文件音效：<audio silent="true"/>，宿主在同一子进程里用 SoundPlayer.PlaySync 播。
  - 系统事件：<audio src="ms-winsoundevent:…"/>。
  - silent：<audio silent="true"/>。
- tag：turn 级（sessionId + turn），不做 session 级。Windows 会替换同 tag 的旧通知；session 级 tag 会让动作中心里的旧条目吞掉新通知。
- 子进程：spawn 绝对路径 powershell.exe，windowsHide: true，stdio 管道并 resume，不 detach，8 秒后 kill。

### 6.5 音效解析与播放

    resolveSound(id) -> { event?: string, wav?: string, silent?: boolean }

- builtin:<name>：只接受 catalog.json 里存在的 id，文件路径 = 插件 sounds/<file>。
- custom:<file>：只接受 SAFE_SOUND_NAME（无路径分隔符、无 ..），路径 = %LOCALAPPDATA%\dsh-notify-plus\custom\<file>。
- system:<key>：映射到 Windows 系统事件或 %SystemRoot%\Media 下的 wav（白名单）。
- silent：不播。
- 任何未知 id 回落到默认事件，不抛错。

播放：

- 先杀掉上一个 preview 子进程，避免试听时叠音。
- PlaySync 的子进程登记进 soundPlayers；/silence 和窗口 focus 都 kill 它们。
- 8 秒封顶，防止长文件盖住下一次通知。
- 非 wav：查 ffmpeg（PATH），转成缓存的 wav；缓存 key = sha1(source path)，清理接口只删缓存目录。

### 6.6 安全

- 渲染层永远只发 id，不发路径；路径由宿主的白名单目录 + 文件名拼接。
- import 只接受绝对路径、存在、扩展名在白名单；复制后的文件名做字符清洗，重名自动加序号。
- delete 只允许 custom: 前缀，且文件名必须通过 SAFE_SOUND_NAME。
- 所有 handler 在 try/catch 内，失败回 4xx/5xx，不允许把异常抛回 cordis。
- 不访问网络，不上传任何内容。

## 7. 客户端半实现

### 7.1 装配

    exports.inject = ['sessions', 'workspaces', 'slots', 'locale']
    exports.apply = function apply(ctx) { … }

- sessions：session list（byId / ids / projectionValues）。
- workspaces：工作区快照（items[].sessionIds / title / workspaceId / path）。
- slots：settings.section 与 settings.plugins.tab。
- locale：注册 notify-plus 命名空间；同时读取 workspace 默认名，用于判断默认工作区。
- uiWorkspace 用 ctx.get('uiWorkspace') 运行时可选取：拿不到就只 focus 窗口，不跳会话。

### 7.2 项目名解析（project.js）

输入：sessionId、session summary、workspaces snapshot、默认工作区文案。

    function projectLabel(sessionId, summary, workspaces, defaultWorkspaceTitle) {
      const ws = findWorkspace(workspaces, sessionId)
      const path = basename(summary.cwd)
      if (ws && ws.title && ws.title !== defaultWorkspaceTitle) return ws.title
      if (path) return path
      if (ws && ws.title) return ws.title
      return summary.displayTitle || summary.title || 'DSH'
    }

规则与理由：

1. 用户重命名过的工作区标题最像“项目名”，优先。
2. 默认工作区（默认分区）标题对所有会话都一样，没有区分度；此时用 cwd 最后一段。
3. cwd 为空（老会话/子代理）时退回显示标题。
4. 再退回标题，最后才用 DSH。
5. 标题最多 40 个显示宽度（CJK 记 2），超出用省略号。

测试用例：自定义工作区、默认工作区、无 cwd、cwd 为根目录、标题超长、workspace 尚未加载。

### 7.3 会话行与摘要（summary.js）

- 会话标题 = summary.displayTitle || summary.title。与项目名相同就省略，避免 “dsh-plugins / dsh-plugins”。
- 摘要 = 最后一条助手回复扁平化：去代码块、链接、标题、列表符号、表格、粗斜体、HTML 标签，折叠空白。
- 摘要上限 56 字符（比参考实现短，因为现在还要放会话标题）。
- 空摘要时用“这一轮已结束。”/“有一条待处理的确认。”等兜底。

最终文案：

    title:  <项目> · <已完成|出错了|等你确认|还在等你>
    lines:  [<会话标题>, <摘要>]

如果会话标题缺失或等于项目名，lines 只剩摘要。

### 7.4 边沿检测与去重（runner.js）

- turn 前进：previousTurn !== undefined && turn > previousTurn。
- 新鲜度：projection.endedAt 与 now 相差 <= 60 秒；启动时折叠补上的旧轮次不通知。
- pending 基线：每个 session 第一次观察只记录，不通知；之后新增的 requestId 才通知。
- 去重窗口：3 秒，key = sessionId + ':turn:' + turn 或 sessionId + ':request:' + requestId。
- 跨源提问：投影与宿主队列可能重复，用 summary 的前 40 字符做 5 秒 twin key。
- 焦点：document.hasFocus() || hostFocused || 5 秒内有过 focus，任一成立就静默。
- connection/reset 时清空所有基线，避免重连后补通知。

### 7.5 设置

localStorage key：dsh-notify-plus.v1

    {
      enabled: true,
      soundEnabled: true,
      sounds: {
        finished: 'builtin:crystal',
        error: 'builtin:low-bell',
        attention: 'builtin:woodblock',
        reminder: 'builtin:glass'
      },
      notifyCompleted: true,
      notifyError: true,
      notifyAborted: false,
      notifyBlocked: true,
      notifyMaxTokens: true,
      notifyApproval: true,
      notifyQuestion: true,
      notifyPlanReview: true,
      remindAfterMinutes: 10
    }

- 读取时逐字段校验；未知/无效值回落默认，不整体丢弃。
- sounds 接受 builtin:/custom:/system:/silent，其他回落。
- 每次 update 写回；写失败只影响持久化，不影响本次会话。
- 形状升级时换 key 后缀，不做原地迁移的复杂逻辑。

### 7.6 音效选择器（sound-picker.js）

- 纯 React.createElement，不引 JSX/Babel。
- 触发器显示当前音效名；展开后分三组：内置音效 / 系统音效 / 自定义音效。
- 每行：名称、时长、场景标签、试听按钮、选中态。
- 选中即写 store；试听调 notifier.preview(id)，不弹通知。
- 键盘：Esc 关闭，↑/↓ 移动，Enter 选中；焦点环用 DSH token。
- 无障碍：role="listbox"/"option"，aria-selected，触发器 aria-expanded。
- 加载库失败时只显示内置音效，不阻塞页面。

### 7.7 两个挂载点

1. 设置 → 通知（settings.section，id: notify-plus，order 60）
   - 总开关、提示音开关、四类结束状态、三类等待、催办分钟数、测试按钮、自定义音效管理、诊断入口。
2. 设置 → 插件 → 通知音效（settings.plugins.tab，id: notify-plus-sounds，order 90）
   - 四个场景选择器 + 试听 + 导入按钮 + “打开完整设置”链接。
   - 这个 tab 的可行性已在 0.2.1-rc.2 的 dsh-client-ui-settings-plugins 中确认：settings.plugins.tab 是 kind: list, scope: root 的列表插槽，第三方客户端插件可以注册。
   - 如果未来该插槽收紧，回退到 settings.section，功能不丢。

### 7.8 样式

- 只注入一个 <style data-plugin="dsh-notify-plus">，id 固定，重复加载不重复插入。
- 颜色/边框/圆角全部用 var(--dsw-alias-…)，不写死浅色/深色。
- 选择器面板最大高度 320px，超出滚动；不改变页面布局宽度。
- 移动端不是目标，但窄窗口下四列会换行。

## 8. 音效设计与生成管线

### 8.1 为什么是程序生成

- 授权干净：输出由本仓库脚本生成，MIT 发布，不依赖第三方音频库。
- 可修改：用户嫌哪个难听，改配方重新生成即可，不需要找替代文件。
- 可复现：固定 PRNG 种子、固定采样率、固定峰值；CI 可以校验字节与时长。
- 体积小：8 个 wav 合计约 0.9MB，不需要运行时解码器。

### 8.2 目录

| id | 文件 | 名称 | 场景 | 时长 | 合成思路 |
| --- | --- | --- | --- | --- | --- |
| builtin:crystal | 01-crystal.wav | 水晶铃 | 完成 | 1.4s | C6 + G6 两音钟，谐波快速衰减 |
| builtin:marimba | 02-marimba.wav | 木琴 | 完成 | 1.2s | C5-E5-G5 三连音，1/3.93/9.24 谐波 |
| builtin:harp | 03-harp.wav | 竖琴 | 完成 | 1.5s | C5-E5-G5-C6 琶音，1/n^1.35 谐波 |
| builtin:woodblock | 04-woodblock.wav | 木鱼 | 等待 | 0.6s | 两声短促木击，噪声 + 共振 |
| builtin:droplet | 05-droplet.wav | 水滴 | 等待 | 0.9s | 下滑音 + 两次回声 |
| builtin:low-bell | 06-low-bell.wav | 低音钟 | 出错 | 1.8s | A3 低钟，低通 |
| builtin:descend | 07-descend.wav | 下行双音 | 出错 | 1.2s | A4→F4 小三度，软起落 |
| builtin:glass | 08-glass.wav | 玻璃琶音 | 催办 | 1.4s | C6-E6-G6-C7 四音琶音 |

峰值目标：普通音效 0.8（约 -1.9 dBFS）；低音钟 0.55；下行双音 0.30（持续音，RMS 更响，所以峰值压低）。全部 44.1kHz / 单声道 / 16-bit PCM，首尾 4ms/50ms 淡入淡出。

### 8.3 生成脚本契约

    node scripts/generate-sounds.mjs            # 重新生成全部
    node scripts/generate-sounds.mjs --check    # 校验已提交文件

--check 检查：存在、单声道、44.1k、16-bit、时长与 catalog 相差 < 0.05s、峰值在目标 ±0.05、RMS 非静音。npm run check 会先跑它。

### 8.4 用户扩展

- 内置音效：把 wav 丢进 sounds/，在 catalog.json 加一行，重新构建；适合开发者。
- 自定义音效：设置页「添加音效…」，复制到 %LOCALAPPDATA%\dsh-notify-plus\custom；适合普通使用。
- 删除只删 custom，不碰内置文件。

## 9. 兼容性与风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| settings.plugins.tab 不是稳定公共契约 | 插件页 tab 消失 | 功能同时挂在 settings.section；启动时检测 slots 是否存在 |
| workspaces 服务形状变化 | 项目名退回 cwd | 解析函数对缺失字段全部容错，单测覆盖 |
| 运行时升级到 0.3 | Loader 跳过插件 | peerDependencies 声明范围；README 写 allow-version 兜底 |
| 无 d.ts | 无法 typecheck seam | 用 JSDoc + 运行时探测；README 记录实测版本 |
| SoundPlayer 只支持 wav | mp3 自定义音效不可播 | ffmpeg 转码缓存；没有 ffmpeg 时 UI 标注 |
| Toast 正文行数有限 | 摘要被截断 | 先保证项目名与会话标题，摘要可丢 |
| 多个会话同时结束 | 声音叠在一起 | 新 toast 前 kill 上一个文件音效；系统事件由 OS 合并 |
| 旧 tag 吞新通知 | 后续通知不显示 | turn 级 tag，不复用 session 级 |

## 10. 测试与验收

### 10.1 自动测试（node:test，零依赖）

- catalog：id/文件唯一、wav 头、时长、峰值、RMS。
- schema：合法 state 通过；缺字段、错类型、负数被拒。
- projection：turn/start → assistant/message → turn/end 的 fold；无关事件引用不变；fork 继承跳过；pending 增删。
- project：6 个解析用例。
- summary：代码块/链接/表格/长文本/空文本。
- runner：turn 前进、旧事件不通知、pending 基线、去重窗口、twin key。
- settings：缺字段、坏 JSON、未知音效 id 的回落。
- routes：用 fake req/res 测 header/method/body 上限；不启动真实 HTTP。

### 10.2 手工验收清单

1. link 安装并重启，插件页显示“运行中”。
2. 在一个项目会话里跑完一轮，通知标题是「项目名 · 已完成」，正文第一行是会话标题。
3. 在另一个项目里跑完，标题换成另一个项目名。
4. 设置 → 插件 → 通知音效，四个场景都能展开、试听、保存；试听不产生通知。
5. 选一个自定义 wav，重启后仍是它。
6. 窗口在前台时跑完一轮，不弹通知。
7. 点通知，窗口回前台并打开对应会话（能拿到 uiWorkspace 时）。
8. 通知响的时候切回窗口，声音立刻停。
9. 等待审批/提问时弹「等你确认」，10 分钟后补一条「还在等你」。
10. /dsh-notify-plus/debug 能看到 projection 状态、最近报告、ffmpeg 与播放器状态。

## 11. 里程碑

| 阶段 | 交付 | 文件 | 验收 |
| --- | --- | --- | --- |
| M0（本次） | 仓库、构建、音效目录与 8 个 wav、规划 | package.json, build.mjs, sounds/, PLAN.md | npm run check 通过 |
| M1 | 宿主：schema、projection、toast/preview/silence/focus 路由 | src/index.js, src/shared/* | projection 单测；debug 路由可用 |
| M2 | 客户端：watcher、项目名、文案、toast | src/client/{index,project,summary,runner,notifier}.js | 真机收到带项目名的通知 |
| M3 | 设置页 + 插件页音效选择器 | sound-picker.js, settings-page.js, plugins-tab.js, styles.js | 四组可选可试听 |
| M4 | 自定义音效导入/删除、缓存、催办 | routes + library UI | 导入 wav 并重启仍生效 |
| M5 | 文档、诊断、验收记录 | README, docs/acceptance | 手工清单 10 项全过 |

## 12. 开放问题（需要拍板）

1. 名字：dsh-notify-plus 是否合适？不喜欢可以改目录与 package name（id 只影响 Loader 与 client bundle id）。
2. 音色口味：当前 8 个偏原声（钟/木/竖琴）。如果更喜欢电子/极简，可以换配方。
3. 是否要“轻/标准”两档音量：需要宿主对 wav 做增益并缓存，成本约半天。
4. 通知正文是否要带耗时/文件数/Token：会增加 projection 字段与正文长度，v1 先不做。
5. 是否与 dsh-notify-desktop 并存：并存会出现两条通知；建议装了本插件就禁用旧的（README 写清楚）。