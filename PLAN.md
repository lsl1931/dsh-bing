# dsh-bing 实现规划

- 状态：v0.4（2026-10-19，M1–M4 已实现；柔和音色包 v2；M5 手工验收待做）
- 目标运行时：DSH 桌面端 0.2.1-rc.2（Windows profile desktop）
- 名字：dsh-bing（会话结束时 bing 一下），音色方向是柔和、接近手机系统提示音
- 参考实现：dsh-notify-desktop 0.1.1（MIT）
- 本文回答一个问题：**接下来写代码时，每个文件负责什么、数据从哪来、失败时怎么办。**

## 1. 目标与非目标

### 1.1 用户可见目标

1. 会话结束、出错、或停下来等人时弹 Windows 原生通知，**标题一定带项目名**。
2. 通知正文带**会话标题**（这一次对话是哪一条）和结果摘要，不让用户猜。
3. 内置一组**柔和、接近手机系统提示音**的铃/木琴/卡林巴/水滴（8 个，最长 1.9 秒），四类场景各自可选，**每个都能当场试听**。
4. 音效与开关放在侧边栏 **插件 → dsh-bing 详情页**，通过官方 `plugins.bundle.config` 内联渲染；不再放设置里。
5. 支持导入自己的音效文件；导入后出现在选择器里，可预览、可删除。
6. 窗口有焦点时不打扰；点通知把 DSH 窗口拉回前台；切回窗口或关掉提示音时，正在响的声音立刻停。
   宿主 Toast 的点击回包只有 dsh://open（桌面壳只认这一个字符串），所以 v1 不承诺“跳到某条会话”；要跳会话得等壳开放带 session 参数的激活路径。

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
| 提问投影 | dsh-user-questions 已注册 client-visible 投影 userQuestions：active[{callId,questions,state:open|continued}] + settled | 登录态提问直接读这个投影，不再自己 fold ask_user_question |
| 服务级提问 | 计划评审不进会话日志，全局客户端也收不到 agent 级瀑布 | 宿主用 { global: true } 观察 user-questions/request，只补投影之外的 plan-review |
| 去重 | 同一 turn 可能被折叠/重连观察到多次 | turn 级 dedupe + 60 秒新鲜度窗口 |
| 投影 schema | registry 只调用 stateSchema.parse / viewSchema.parse | 可以写一个 30 行的 parse 兼容层，不引入 zod |

## 3. 与原插件的差异（设计决定）

| 维度 | dsh-notify-desktop 0.1.1 | dsh-bing（本仓库） | 理由 |
| --- | --- | --- | --- |
| 标题 | workspaceName(cwd) || displayTitle | 项目名解析链：重命名过的工作区标题 → cwd basename → 真实会话标题 → DSH | 默认分区标题对所有会话都一样；未重命名工作区按 cwd 区分，重命名后才用工作区标题 |
| 正文 | 回复摘要；没有会话标题 | 会话标题 + 摘要（最多两行 body text，摘要限 42 字符） | 用户明确抱怨“不知道是哪个项目/哪次会话” |
| 音效 | 2 个作者 wav + Windows 20 个；默认 chimes/error | 8 个柔和合成音（铃/木琴/卡林巴/水滴 + 房间混响），四组各自默认 | 用户觉得电子短音太生硬；按苹果/华为那种软起音、木质/玻璃听感重做 |
| 选择入口 | 设置 → 通知 | 插件 → dsh-bing → 内联配置区（plugins.bundle.config，key dsh-bing） | 用户明确要在插件页里调；这是 plugin-manager 给组合包自带配置的官方 slot |
| 提问来源 | 自 fold tool/call + ptc，另加宿主瀑布 | 官方 userQuestions 投影 + 宿主队列只补 plan-review | 少一个来源；也不会把 continued 的提问误清掉 |
| 试听 | 发一条测试 toast | 专用 /preview 路由，只播声音不弹通知 | 调音效时不该刷屏通知中心 |
| 依赖 | TypeScript + zod + rolldown，宿主 bundle 210KB | 纯 JS、零依赖、build.mjs 只做包装 | 与本地现有插件一致，链接安装即可，不需要构建工具链 |
| schema | zod | 手写 parse 兼容层 | registry 只用 parse；少一个 200KB 依赖 |
| 声音目录 | 插件 sounds/ + %LOCALAPPDATA%\dsh-notify\custom | 相同模式，目录改为 dsh-bing | 用户可自由扩展，不改代码 |

## 4. 架构与数据流

两半结构，和参考实现一致：

    session/event
        │
        ├──► host: bing projection（turn/end + approvals，纯 fold）
        │         │ wire: turn / reason / body / endedAt / pending[{approval,at}] / updatedAt
        │         ▼
        ├──► host: official userQuestions projection（open / continued / settled）
        │         │ wire: active[{callId,questions,state}] + settled
        │         ▼
        └──► host: question watcher（只补 plan-review 服务级提问）
                  │ /questions 轮询
                  ▼
    client: sessions.list 的 projectionValues（bing + userQuestions）
        │
        ├── 判定：turn 前进？approval 新增？userQuestions.active 新增？新鲜？去重？有焦点？
        │
        ├── 解析项目名（workspaces 快照 + summary.cwd + summary.title）
        ├── 组装文案（项目 · 状态 / 会话标题 / 摘要）
        │
        ▼
    POST /dsh-bing/toast ──► PowerShell：ToastNotification + SoundPlayer
        ▲
        │
    client: settings store（localStorage）◄── 插件详情页配置区
        │
        └── POST /preview（只播声音）、/silence、/sound-library …

为什么 turn/approval 要自己注册投影：0.2.1-rc.2 没有“turn 结束原因”或“待审批”的公开投影；自己注册是唯一不改 harness 的通道。
为什么不自己 fold 提问：官方 userQuestions 已经覆盖 open/continued/settled，重复 fold 会漏 continued，还会把同一个提问报两次。
为什么客户端不直接轮询宿主：session list 已经按会话推送投影，复用它比新造一套轮询更省电、也天然覆盖后台会话。

## 5. 目录结构

    dsh-bing/
      package.json            包元数据、dsh.client.inject、脚本
      cordis.patch.yml        把宿主半挂到 Loader
      build.mjs               复制宿主半到 lib/ + 把客户端 CJS 模块打成单文件
      src/
        index.js              宿主入口：projection + 13 条路由 + Toast/音频
        shared/
          protocol.js         路由、header、投影 key、上限常量
          schema.js           手写 parse 兼容 schema
          projection.js       turn/end + approval 折叠，wire view 缓存
          sounds.js           音效目录、导入/删除、wav 缓存、ffmpeg
        client/
          index.js            客户端入口：watcher / 焦点 / 催办 / slots
          settings.cjs        localStorage store + 校验
          project.cjs         项目名解析（纯函数）
          summary.cjs         Markdown 扁平化 + 文案组装
          runner.cjs          边沿检测、去重、新鲜度
          questions.cjs       归一化 userQuestions 与宿主 plan-review 队列
          notifier.cjs        13 条路由的 fetch 封装
          ui.cjs              SoundPicker + 插件详情页配置面板（createElement）
          locales.cjs         zh / en 字典
          styles.cjs          注入 CSS，使用 DSH 设计 token
      sounds/
        catalog.json          8 个内置音效的单一事实来源
        *.wav                 生成产物（提交进仓库）
        README.md             试听、替换、再生成说明
      scripts/
        generate-sounds.mjs   合成脚本，--check 校验
        lib/wav.mjs           WAV 编解码与电平统计
      test/
        catalog.test.mjs      音效目录与水印校验
        sounds.test.mjs       id 解析、静音/未知回落、路径安全
        project.test.mjs      项目名解析用例
        summary.test.mjs      摘要裁剪与标题组装
        runner.test.mjs       去重/新鲜度用例
        questions.test.mjs    userQuestions + plan-review 归一化
        settings.test.mjs     设置回落/持久化
        projection.test.mjs   折叠不变量、wire view 缓存、schema
        routes.test.mjs       路由注册、method/header、debug
      lib/                    构建产物，提交（profile 直接链接这里）
      README.md
      PLAN.md

## 6. 宿主半实现

### 6.1 入口

    export const name = 'dsh-bing'
    export const inject = ['sessionProjections']

    export function apply(ctx) {
      ctx.sessionProjections.register(pulseProjection())
      ctx.inject(['webServer'], scoped => { …注册 exact 路由（总计 13：M1 7、M2 1、M4 5）… })
    }

- 只依赖 sessionProjections；webServer 用 inject 子作用域，缺失时投影仍然工作（客户端会退回渲染层通知）。
- 所有 ctx.effect 都要有唯一 label，便于诊断。

### 6.2 bing projection

状态（会进 checkpoint，必须可 JSON 序列化）：

    {
      inheritedEventCount: number,
      open: { turn: number, text: string } | null,
      last: { turn: number, reason: string, body: string, endedAt: number } | null,
      pending: [{ kind: 'approval', requestId, summary, at }],
      updatedAt: number,
      view: WireView            // 缓存；wire 字段没变时复用同一个对象
    }

wire view（客户端只读这个）：

    {
      turn: number,             // 最后一个已结束的 turn；open 中的 turn 不算
      reason: string,           // completed / error / aborted / blocked / max-tokens
      body: string,             // 最后一条助手回复，最多 400 字符
      endedAt: number,          // 本轮结束的宿主时钟，用于“新鲜度”判断
      pending: PendingInteraction[],
      updatedAt: number
    }

处理的事件与不变量：

- turn/start：重置 open；记录 turn，但 wire.turn 仍是 last.turn（客户端靠它判断“新结束了一轮”）。
- assistant/message：只累积当前 turn 的 text block，按 400 字符截断。
- turn/end：把 open 落到 last，reason 取 reason.kind；endedAt 取 event.time。
- approval/asked、approval/decided：pending 增删；at 取 approval/asked 的 event.time。
- 提问不进这个 fold：官方 userQuestions 投影已经覆盖 active(open|continued)/settled，重复 fold 会漏 continued、也会报两次。
- 其它事件：返回原 state（引用相等），这是 registry 变更通知的前提。
- 事件 seq < inheritedEventCount：fork 继承的历史，跳过。
- wire view 必须缓存：registry 用 Object.is 比较前后两次 view，如果每次 apply 都新建对象，每个 token/事件都会通知所有客户端。只有 turn/reason/body/endedAt/pending 真正变化时才重建 view；open.text 的变化不重建。
- view 也要进 stateSchema，因为 checkpoint 存的是整个 state。

schema：src/shared/schema.js 提供 object/array/enum/string/number 组合器，每个返回 { parse(value) }，失败抛 Error。只做本投影需要的形状，不做通用校验器。测试要覆盖：合法 state 通过、缺字段/类型错误被拒。
definition 必须显式给 stateVersion（registry 会校验 Number.isSafeInteger && >= 0）；改形状时递增它，旧 checkpoint 会被丢弃后重折。

### 6.3 路由

统一前缀 /dsh-bing，全部 same-origin header 校验；POST 才接受写操作；body 上限 8KB。

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
| /questions | GET | - | {seq, items} | 补 plan-review；无 userQuestions 的会话回退为全部提问 |
| /report | POST | 一行文本 | 204 | 客户端诊断环 |
| /debug | GET | - | JSON | 投影状态 + 媒体状态 + 最近报告 |

注意：这些路由不在 /api 下，不经过 API 网关鉴权，所以 header + method 检查是安全边界，不是可选项。

### 6.4 Toast 构造

- XML 通过环境变量传给 PowerShell，绝不拼进命令行。
- 标题与每行正文都做 XML 转义，并分别截断（标题 120、每行 160、总 300）。
- ToastGeneric 允许多个 text：第一个是标题，后面是正文行。本实现发 1 + 2 行：
  1. 项目 · 状态
  2. 会话标题
  3. 摘要（有会话标题行时最多 42 字符，没有时最多 56 字符；超出会被 shell 截断）
- 音效处理：
  - 文件音效：<audio silent="true"/>，宿主在同一子进程里用 SoundPlayer.PlaySync 播。
  - 系统事件：<audio src="ms-winsoundevent:…"/>。
  - silent：<audio silent="true"/>。
- tag：turn 级（sessionId + turn），不做 session 级。Windows 会替换同 tag 的旧通知；session 级 tag 会让动作中心里的旧条目吞掉新通知。
- 子进程：spawn 绝对路径 powershell.exe，windowsHide: true，stdio 管道并 resume，不 detach，8 秒后 kill。

### 6.5 音效解析与播放

    resolveSound(id) -> { event?: string, wav?: string, silent?: boolean }

- builtin:<name>：只接受 catalog.json 里存在的 id，文件路径 = 插件 sounds/<file>。
- custom:<file>：只接受 SAFE_SOUND_NAME（无路径分隔符、拒绝 '..' 片段），路径 = %LOCALAPPDATA%\dsh-bing\custom\<file>。
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

    exports.inject = ['sessions', 'slots', 'locale']
    exports.apply = function apply(ctx) { … }

- sessions：session list（byId / ids / projectionValues，含官方 userQuestions）。
- slots：plugins.bundle.config（key dsh-bing）。
- locale：注册 bing 命名空间。
- workspaces 用 ctx.get('workspaces') **可选读取**，不要放进 inject：它只用于项目名富化，缺了也必须照常通知。
- uiWorkspace 同样可选：v1 点通知只 focus 窗口，不调用 openSession；以后壳支持跳会话时再启用。
- 依赖加载顺序写在 package.json 的 dsh.client.inject（sessions 控制器、settings、locale、workspace），这不是硬 inject。

### 7.2 项目名解析（project.js）

输入：sessionId、session summary、workspaces snapshot（可为 undefined）。

    function projectLabel(sessionId, summary, workspaces) {
      const ws = findWorkspace(workspaces, sessionId)
      const cwdName = basename(summary.cwd)
      if (ws && ws.title) {
        const unrenamed = ws.title === basename(ws.path)
        if (!unrenamed) return ws.title
        if (cwdName) return cwdName
        return ws.title
      }
      if (cwdName) return cwdName
      if (summary.title) return summary.title
      return summary.displayTitle || 'DSH'
    }

规则与理由：

1. 0.2.1-rc.2 的工作区没有“是否默认”的公开标记；默认工作区的 title 就是 path 的 basename，且重命名后 title 会与 path basename 不同。
2. 所以用 title !== basename(path) 判断“用户重命名过”，重命名过的标题优先（最像项目名）；本地化默认名（默认分区/Default）也算未重命名。
3. 未重命名的工作区（含默认分区）用 cwd 最后一段：同一个默认工作区里可以放不同目录的会话，工作区标题没有区分度。
4. cwd 为空（老会话/子代理）时退回真实会话标题 summary.title，再退回 displayTitle，最后 DSH。
5. 标题最多 40 个显示宽度（CJK 记 2），超出用省略号。

测试用例：重命名工作区、未重命名工作区、默认工作区 + 不同 cwd、无 cwd、cwd 为根目录、标题超长、workspace 尚未加载/服务缺失。

### 7.3 会话行与摘要（summary.js）

- 会话标题 = summary.title（DSH 生成的真实标题）。不要用 displayTitle：它在没有标题时会回落到 cwd basename，正好和项目名重复。
- 与项目名相同就省略，避免 “dsh-plugins / dsh-plugins”。
- 摘要 = 最后一条助手回复扁平化：去代码块、链接、标题、列表符号、表格、粗斜体、HTML 标签，折叠空白。
- 会话标题行最多 36 字符；摘要上限：有会话标题行 42 字符，没有时 56 字符。参考实现实测 body 约 26 个 CJK/行、三行封顶；两行正文合计控制在 78 字符左右。
- 空摘要时用“这一轮已结束。”/“有一条待处理的确认。”等兜底。

最终文案：

    title:  <项目> · <已完成|出错了|等你确认|还在等你>
    lines:  [<会话标题>, <摘要>]

如果会话标题缺失或等于项目名，lines 只剩摘要。

### 7.4 边沿检测与去重（runner.js）

- turn 前进：previousTurn !== undefined && turn > previousTurn。
- turn 新鲜度：projection.endedAt 与 now 相差 <= 60 秒；启动时折叠补上的旧轮次不通知。
- approval：来自 bing.pending，requestId 首次出现才通知；新鲜度用 pending.at（approval/asked 的 event.time），不要用 endedAt。
- question：来自官方 userQuestions.active。callId 首次出现才通知；state === 'continued' 仍算等待，不重复弹；从 active 消失或进 settled 就结束等待。没有时间戳，首次观察时间就是 firstSeenAt。
- plan-review：来自宿主 /questions，只处理 userQuestions 里没有同 callId 的条目；有 callId 用 callId 去重，没有再用 summary 前 40 字符做 5 秒 twin key。
- 回退：某会话没有 userQuestions 投影（服务未启用/旧版本）时，/questions 队列接管该会话的所有提问（question + plan-review），否则会漏报。
- 去重窗口：3 秒，key = sessionId + ':turn:' + turn / ':request:' + requestId / ':ask:' + callId。
- 焦点：document.hasFocus() || hostFocused || 5 秒内有过 focus，任一成立就静默。
- connection/reset 时清空所有基线，避免重连后补通知。

### 7.5 设置

localStorage key：dsh-bing.v1

    {
      enabled: true,
      soundEnabled: true,
      sounds: {
        finished: 'builtin:aurora',
        error: 'builtin:low',
        attention: 'builtin:glass',
        reminder: 'builtin:bloom'
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

### 7.7 挂载点：插件详情页（唯一入口）

- 注册 `plugins.bundle.config`，key 为 `dsh-bing`：

      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-bing',
        locale: NS,
        inject: face,
      }, BundleConfig))

- plugin-manager 的 PackageDetail 用 `configLedger.bundles.has(pkg.name)` 判断是否已配置，然后把该 slot 渲染在**描述与组件列表之间**，所以控件就在 dsh-bing 的插件详情页里，不需要用户去设置。
- 面板包含：总开关、提示音、五类结束状态、三类等待、四类音效、催办分钟、测试、自定义音效导入/删除/缓存。
- 不再注册 `settings.section` 或 `settings.plugins.tab`；设置里没有这个插件的入口。
- `plugins.detail.section` 是给“别的插件对这个包发表意见”的 slot，不用来放自己的配置。
- 该 slot 在 0.2.1-rc.2 的 `dsh-client-ui-plugin-manager` 中已核实（PackageDetail 渲染 + configLedger）。未来的 slot 改名按插件管理器 README 迁移；host 路由不依赖 UI。

### 7.8 样式

- 只注入一个 <style data-plugin="dsh-bing">，id 固定，重复加载不重复插入。
- 颜色/边框/圆角全部用 var(--dsw-alias-…)，不写死浅色/深色。
- 选择器面板最大高度 320px，超出滚动；不改变页面布局宽度。
- 移动端不是目标，但窄窗口下四列会换行。

## 8. 音效设计与生成管线

### 8.1 为什么是程序生成

- 音色方向：柔和、接近手机系统提示音。软起音、铃/木琴/卡林巴/水滴、少量房间混响；不再用方波警报和硬点击；最长 1.9 秒。
- 授权干净：输出由本仓库脚本生成，MIT 发布，不依赖第三方音频库。
- 可修改：用户嫌哪个难听，改配方重新生成即可，不需要找替代文件。
- 可复现：固定算法与采样率、每个音效自己的峰值目标；--check 会重新合成并与已提交文件逐字节比较。
- 体积小：8 个 wav 合计约 0.9MB，不需要运行时解码器。

### 8.2 目录

| id | 文件 | 名称 | 场景 | 时长 | 峰值 | RMS | 合成思路 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| builtin:aurora | 01-aurora.wav | 极光 | 完成 | 1.8s | 0.61 | 0.130 | C5-E5-G5 加法铃 + 房间混响 |
| builtin:marimba | 02-marimba.wav | 木琴 | 完成 | 1.3s | 0.69 | 0.130 | C5-E5-G5 木质三连音 |
| builtin:kalimba | 03-kalimba.wav | 卡林巴 | 完成 | 1.1s | 0.48 | 0.130 | G5-C6-E6 拇指琴 |
| builtin:glass | 04-glass.wav | 玻璃 | 等待 | 1.5s | 0.55 | 0.120 | E6-G6-B6 玻璃铃，低通 |
| builtin:bubble | 05-bubble.wav | 气泡 | 等待 | 0.8s | 0.77 | 0.120 | 两声水泡 + 小混响 |
| builtin:low | 06-low.wav | 低音 | 出错 | 1.0s | 0.55 | 0.120 | A3-C4 低频木琴 |
| builtin:descend | 07-descend.wav | 回声 | 出错 | 1.3s | 0.48 | 0.120 | E5→C5 柔和下行 + 混响 |
| builtin:bloom | 08-bloom.wav | 花开 | 催办 | 1.9s | 0.45 | 0.120 | C-E-G 铺底 + 上行铃 |

响度校准按 RMS 而不是只看峰值：目标 RMS 0.12–0.13，峰值封顶 0.95；短音（气泡）靠峰值补偿，长音（花开）靠 RMS 保持不吵。全部 44.1kHz / 单声道 / 16-bit PCM，首尾 3ms/80ms 淡入淡出。

### 8.3 生成脚本契约

    node scripts/generate-sounds.mjs            # 重新生成全部
    node scripts/generate-sounds.mjs --check    # 校验已提交文件

--check 检查：存在、PCM format=1、单声道、44.1k、16-bit、时长与 catalog 相差 < 0.05s、RMS 在目标 ±0.025、峰值不超过 0.96，并重新合成一次与已提交文件逐字节比较（可复现）。npm run check 会先跑它。

### 8.4 用户扩展

- 内置音效：把 wav 丢进 sounds/，在 catalog.json 加一行，重新构建；适合开发者。
- 自定义音效：插件详情页「添加音效…」，复制到 %LOCALAPPDATA%\dsh-bing\custom；适合普通使用。
- 删除只删 custom，不碰内置文件。

## 9. 兼容性与风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| plugins.bundle.config 不是稳定公共契约 | 插件详情页的配置区消失 | 官方 slot；升级时按 plugin-manager README 核对；host 路由不受影响 |
| 插件管理器升级改 slot 名 | 控件位置变化 | 用宿主路由仍可调试；README 记录 0.2.1-rc.2 的 slot 名 |
| 点通知只能回前台 | 不能跳到某条会话 | v1 明确只回前台；跳会话需要壳支持带 session 的激活路径 |
| workspaces 服务形状变化 | 项目名退回 cwd | 解析函数对缺失字段全部容错，单测覆盖 |
| 运行时升级到 0.3 | Loader 跳过插件 | peerDependencies 声明范围；README 写 allow-version 兜底 |
| 无 d.ts | 无法 typecheck seam | 用 JSDoc + 运行时探测；README 记录实测版本 |
| SoundPlayer 只支持 wav | mp3 自定义音效不可播 | ffmpeg 转码缓存；没有 ffmpeg 时 UI 标注 |
| Toast 正文行数有限 | 摘要被截断 | 先保证项目名与会话标题，摘要可丢 |
| 多个会话同时结束 | 声音叠在一起 | 新 toast 前 kill 上一个文件音效；系统事件由 OS 合并 |
| 旧 tag 吞新通知 | 后续通知不显示 | turn 级 tag，不复用 session 级 |

## 10. 测试与验收

### 10.1 自动测试（node:test，零依赖）

- catalog：id/文件唯一、wav 头（含 format=1）、时长、峰值、RMS、逐字节可复现。
- schema：合法 state 通过；缺字段、错类型、负数被拒。
- projection：turn/start → assistant/message → turn/end 的 fold；无关事件引用不变；fork 继承跳过；approval 增删；wire view 引用稳定。
- project：7 个解析用例（含重命名/未重命名/服务缺失）。
- summary：代码块/链接/表格/长文本/空文本；有/无会话行两种长度。
- runner：turn 前进、旧事件不通知、approval 基线、userQuestions.active 新增/continued/消失、去重窗口。
- questions：userQuestions 与宿主 plan-review 队列的归一化与去重。
- settings：缺字段、坏 JSON、未知音效 id 的回落。
- routes：用 fake ctx 注册后测 13 条路由、method/header、sound-library、debug；不启动真实 HTTP。
- sounds：8 个内置 id 可解析、静音/未知回落、路径穿越被拒。

当前 `npm test` 共 36 个用例，全部通过。

### 10.2 手工验收清单

1. link 安装并重启，插件页显示“运行中”。
2. 在一个项目会话里跑完一轮，通知标题是「项目名 · 已完成」，正文第一行是会话标题。
3. 在另一个项目里跑完，标题换成另一个项目名。
4. 侧边栏 插件 → dsh-bing 详情页，配置区四个场景都能展开、试听、保存；试听不产生通知。
5. 选一个自定义 wav，重启后仍是它。
6. 窗口在前台时跑完一轮，不弹通知。
7. 点通知，窗口回到前台（不跳会话；这是宿主 Toast 点击路径的限制，不是 bug）。
8. 通知响的时候切回窗口，声音立刻停。
9. 等待审批/提问时弹「等你确认」，10 分钟后补一条「还在等你」；提问超时后 state=continued 时不重复弹。
10. /dsh-bing/debug 能看到 projection 状态、最近报告、ffmpeg 与播放器状态。

## 11. 里程碑

| 阶段 | 交付 | 文件 | 验收 |
| --- | --- | --- | --- |
| M0（已完成） | 仓库、构建、音效目录与 8 个 wav、规划 | package.json, build.mjs, sounds/, PLAN.md | npm run check 通过 |
| M1（已实现） | 宿主：schema、projection（turn + approval）、toast/preview/silence/focus/foreground/debug/report（7 条路由） | src/index.js, src/shared/* | projection 单测；debug 路由可用 |
| M2（已实现） | 客户端：watcher（turn + approval + userQuestions + plan-review）、项目名、文案、toast、/questions 路由 | src/client/{index,project,summary,runner,questions,notifier}.cjs | 真机收到带项目名的通知 |
| M3（已实现） | 插件详情页配置面板（音效 + 开关） | ui.cjs, styles.cjs, locales.cjs | 四组可选可试听 |
| M4（已实现） | 自定义音效导入/删除、缓存、催办、sound-library 等 5 条路由 | routes + library UI | 导入 wav 并重启仍生效 |
| M5（待做） | 手工验收记录、README 截图/诊断 | README, docs/acceptance | 手工清单 10 项全过 |

## 12. 开放问题（需要拍板）

已定：名字 dsh-bing；音色方向柔和/手机系统提示音。配方仍可继续微调。

1. 是否要“轻/标准”两档音量：需要宿主对 wav 做增益并缓存，成本约半天。
2. 通知正文是否要带耗时/文件数/Token：会增加 projection 字段与正文长度，v1 先不做。
3. 是否与 dsh-notify-desktop 并存：并存会出现两条通知；建议装了本插件就禁用旧的（README 写清楚）。
4. 已解决：控件现在就在插件详情页（plugins.bundle.config），不需要改 harness。
5. 点通知是否必须跳会话：宿主 Toast 只有 dsh://open，跳会话需要桌面壳新增带 session 参数的激活路径。