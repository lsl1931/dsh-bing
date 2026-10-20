# 内置音效

这些 wav 由 scripts/generate-sounds.mjs 合成，不要手改文件本身。

## 试听

直接双击 wav，或在设置 → 插件 → 通知音效里逐个试听（M3 之后）。

## 修改

1. 改 scripts/generate-sounds.mjs 里对应的配方；
2. 如果增删音效，同时改 sounds/catalog.json（id、文件名、名称、场景、时长、峰值）；
3. 运行 npm run sounds；
4. 运行 npm run sounds:check，确认时长/峰值/格式，并确认重新合成与已提交文件逐字节一致；
5. 提交 catalog.json 与新的 wav。

## 约定

- 44.1kHz、单声道、16-bit PCM；SoundPlayer 对格式很挑，别改成别的。
- 峰值按 catalog.json 的 peak 字段：钟/琴 0.60–0.65，木鱼/水滴 0.90，低音钟 0.50，下行双音 0.20；目标是 RMS 落在 0.10–0.14，避免持续音比短音效响太多。
- 首尾淡入淡出，避免爆音。
- 时长控制在 2 秒内；通知本身只有几秒，长音效会被 8 秒封顶截断。
- 文件名只用小写字母、数字、连字符，保持 01- 前缀便于排序。

## 许可

这些文件由本仓库脚本生成，随本仓库以 MIT 发布。