# CamMeasure Pro — 开发交接文档（相机模块 + A 组测量标注增强）

> 本文接续 `Image-measure/CameraMeasure_开发文档.md`，只讲**新增的实时相机层**。原有数据模型、渲染管线、吸附/约束、导出体系全部未动，沿用原约定。所有函数名/字段名与源码一致，可直接搜索定位。

## 0. 这是什么

`CamMeasure.html` = 你的 `CameraMeasure.html`（完整保留）+ Camm 式实时能力：

- 实时相机测量（getUserMedia，多设备切换、热插拔）
- 拍照冻结精修（坐标体系与静态图完全一致）
- 快照 / 自动定时快照（叠加测量标注） / 录像（MediaRecorder）
- 实时色彩增强（CSS/SVG filter GPU 管线 + 灰世界 AWB）
- 相机硬件参数（UVC 曝光/增益/变焦/补光，能力驱动 UI）
- 标定增强：显微镜放大倍率 + 多套标定存取（localStorage）
- 网格 / 十字线叠加；F12 快照、F2 录像、F4 放大镜（与 Camm 一致）

单文件、零构建、零后端哲学不变。唯一外部依赖仍是 jsPDF（PDF 导出）。

## 1. 架构：为什么这样做是"运行高效"的

```
#stage
 ├─ <video id="vid">   ← GPU 合成，浏览器直渲，JS 不碰像素
 └─ <canvas id="canvas"> ← 测量覆盖层，事件驱动按需重绘（draw()）
```

- **视频帧从不经过 JS**：60fps 预览的 CPU 占用≈0。canvas 与原版一样只在交互时重绘。
- **增强走 GPU**：`vid.style.filter = "url(#fxc) brightness() contrast() saturate() hue-rotate() grayscale()"`；RGB 增益与伽马由内联 SVG `feComponentTransfer`（id=`fxc`）承担，参数由 `syncSvgFx()` 动态写入。
- **坐标系不变式**：所有测量点存"视频原生像素"坐标（`videoWidth×videoHeight`），与静态图像坐标体系完全一致 —— 这就是「实时测量 → 拍照 → 静态精修」测量不丢的根基。**改动任何坐标逻辑时不得破坏此不变式。**

## 2. 新增状态

- `S.mag` —— 标定放大倍率（持久化：已同步进 `_snap/_restore` 和工程 JSON v4 `magnification` 字段）。
- `CAM` 模块对象：`on`(实时视图激活) / `stream/track/devices/deviceId` / `rec`(MediaRecorder) / `autoIv`(自动快照定时器) / `fps` / `fx{bright,contrast,sat,hue,gray,gamma,rG,gG,bG,flipH,flipV}` / `grid{on,size}` / `cross`。

关键函数（按调用频率排）：

| 函数 | 职责 |
| --- | --- |
| `layoutVideo()` | 把 `S.view` 变换写到 video 元素的 CSS（left/top/width/height），与 drawImage 同一数学 |
| `draw()` | 实时分支：不再画图片位图，只画覆盖层（`paintGridCross` + `paintOverlay`） |
| `cssFxParts()` | 生成 CSS filter 片段；仅在增益/伽马≠1 时才拼 `url(#fxc)`（Safari 兼容） |
| `frameCanvas()` | 抓帧：`ctx.filter` 复现 CSS 部分 + `applyLut` 像素级复现增益/伽马 + 翻转 |
| `freezeFrame()` | 拍照测量：抓帧 → `loadImage(url,name,keepView=true)`，返回 Promise |
| `ensureStatic()` | 导出前守卫：实时模式下自动先冻结（S.img 缺失时） |
| `snapshot(withAnno)` | 快照：不离开实时模式，`renderShape` 叠加标注后直接下载 |
| `awb()` | 灰世界 AWB：48×36 降采样求均值 → 设 RGB 增益滑块 |
| `buildCamProps()` | 按 `track.getCapabilities()` 动态生成硬件参数控件 |
| `srcW()/srcH()/hasSrc()` | 旧的 `S.img` 判空全部换成这三个（**搜索 `!S.img` 确认无遗漏**） |

## 3. 已做的接线清单（改原代码处）

1. 事件守卫：mousedown / mousemove / wheel / touchstart / touchmove / touchend / data-mode 工具栏 → `hasSrc()`
2. `draw()` / `fitView()` / `updateStatus()` / `drawLoupe()`（放大镜实时模式画 `drawImage(vid,...)`）
3. `loadImage(dataURL,name,keepView)` — 第三参保持视图不跳变；加载图片自动退出实时视图（测量保留，沿用你"换图不清"的政策）
4. 导出三按钮（工程/PNG/PDF）改 `async` + `ensureStatic()`
5. 标定对话框加 `dlgMag`；`dlgOk` 的 `pxPerUnit = dist/(v*mag)`
6. `_snap/_restore`、工程 JSON（app:"CamMeasure", version:4）加 `mag/magnification`
7. 键盘：F12 / F2 / F4（插在 Ctrl+Z 分支之后、INPUT 焦点判断之前）

## 4. 陷阱与已知边界（改前必读）

- **相机需 HTTPS 或 localhost**。file:// 双击打开只有静态测量。本地验证：`python3 -m http.server` 后访问 localhost。
- `cssFxParts()` 的 `unshift("url(#fxc)")` 必须放最前 —— filter 函数按序应用，放后面会被 brightness 等先改变取值。
- **录像录的是原始流，不含叠加标注**（浏览器不提供合成流的廉价路径；要标注请用快照，`snapshot(true)` 会烧录 `renderShape` 输出）。
- Safari 对 CSS `filter:url(#...)` 支持不稳 → 默认不拼 url 片段，只在需要时拼；快照端 `applyLut` 始终像素级兜底，两端口径一致。
- `renderShape` 的 Canvas2D 子集约束继续有效 —— `snapshot(true)` 与 PDF 导出都复用它，**不要在 renderShape 里用子集外的 API**。
- 帧坐标 == 视频原生分辨率坐标。**换分辨率（切设备）后旧测量的像素坐标含义会变** —— 沿用你"换图保留测量"的既定政策，用户自负；将来可加提示。
- jsdom 冒烟测试里 `vid.style.filter` 会被浏览器规范化成 `url("#fxc")`（带引号），断言别抠字符串字面量。

## 6. A 组功能（测量标注增强，已实现）

对照 Camm 功能差距盘点补齐的 7 项，全部落在单文件内、复用既有管线：

| 功能 | 入口 | 实现 |
| --- | --- | --- |
| ① 曲边多边形 | 工具栏 `data-mode="polyarc"` | `pts` 顶点 + `arcs[i]`（边 i 的**弧上参考点**，null=直边）。弧边由 (端点A, 参考点C, 端点B) 三点定弧复用 `arcSamples`，拖顶点弧自动跟随。选中后**双击边**直↔弧切换（`togglePolyarcEdge`），弧中点**圆手柄**拖动调弯（`drag.kind==="arc"` 直接写参考点）。面积=鞋带+弓形修正（`segArea`），周长=Σ弧长/边长。吸附/悬停中点走 `segmentsOf` 的弦 |
| ② 文字标注 | `data-mode="text"`（click:1） | 放点即 `prompt` 输入文字，存 `m.text`。渲染复用通用 label 管线（`computeShape` 返回 `text:m.text`）→ 自动获得背景框、`_lbl` 缓存、可拖动、CSV/PDF 输出 |
| ③ 剪贴图 | `data-mode="clip"`（click:2，非测量） | `finalizePlacing` 特判 → `copyCrop`：框选区域 drawImage + renderShape 叠标注 → `navigator.clipboard.write(ClipboardItem)`；不支持/未授权降级下载 PNG（两层 try 兜 toBlob 抛错）。进 clip 模式若在实时视图自动 `freezeFrame` |
| ④ 顶点精确输入 | 选中+抓住顶点后按 <kbd>E</kbd> 或双击顶点 | `editVertex()`：prompt 输入 "x, y"（图像像素），解析失败 toast `vtxBad` |
| ⑤ 锁定单条测量 | 列表项 🔒/🔓 按钮 | `m.locked`。锁后：selectDown 拒抓（可选中+toast）、dragMove/nudge/顶点编辑/删点全拒，`paintOverlay` 不画手柄；列表 ✕ 与工具栏删除仍可用（明确操作）。随 `_snap`（measures 整体序列化）自动进撤销栈 |
| ⑥ 小数精度 0~5 | 侧栏「显示设置」 | `S.precision`（null=自适应）。**fmt 拆成两个**：`fmt`（线宽等 UI 值，原逻辑）与 `fmtU`（测量读数，固定精度不裁尾零）。`U/calibText/computeShape/renderList 合计/CSV/PDF/标定显示`全部走 fmtU；线宽/放大镜倍率显示仍走 fmt |
| ⑦ 放大镜可调 | 侧栏「显示设置」滑块；Alt+滚轮调倍率 | `S.loupeR`（0=默认 152，触屏按比例放大）、`S.loupeM`（2~12，默认 4.5）。`drawLoupe` 读取；wheel 的 `e.altKey&&S.loupe` 分支调倍率 |

**接线**：`S` 加 `precision/loupeR/loupeM`；工程 JSON v4 追加 `precision`、`loupe{r,m}`、measures 的 `locked/text/arcs`（导入向后兼容，缺省 null）；i18n zh/en 各加 ~25 键（`hint_polyarc/text/clip`、`dispTitle`、`toastClip*`、`vtx*`、`toastMeasureLocked`…）；帮助文档三处补条目。

**注意**：polyarc 的 `m.arcs` 与 `pts` 边数必须同步（删顶点时同步 splice）；clip 的 draft 渲染分支用了 `g.rect()+fill("evenodd")`（Canvas2D 标准用法，PDF 适配器不走该分支——clip 不会成为 measure）。

## 7. 冒烟测试

`cammeasure_smoketest.js`（57 项，全通过；方法论同你的 80 项套件）：

- 相机启动/切换/关闭状态机、getUserMedia 调用、设备菜单、视频布局=fitView 数学
- **实时视频上直接完成直线测量**、标定含倍率（数学断言 `pxPerUnit=dist/(len*mag)`）
- 标定库 localStorage 存取（含 mag）
- 增强管线：brightness→CSS、增益→url(#fxc)+SVG slope 同步、翻转、重置
- 冻结→静态、回实时、测量全程保留
- UVC 能力滑块生成、REC 徽标、菜单关闭相机
- **A 组 15 项（41~55）**：文字标注创建/内容进列表、曲边三点点画+双击闭合+双击边切弧（⌒ 断言）、锁定切换+抓取被拒 toast、精度行 7 按钮+精度 2 固定两位小数、放大镜大小/倍率滑块、剪贴图 toast+不产生测量项、E 键顶点精确输入+读数变化
- 变异测试：B（去 mag 除法）、C（去 url filter）被击杀；A（删 freezeFrame 的 CAM.on=false）**行为等价**——loadImage 自带同样守卫（双保险），断言测的是结果而非该行

运行：

```bash
NODE_PATH=/home/huang/.workbuddy/binaries/node/workspace/node_modules \
  node cammeasure_smoketest.js     # CM_FILE=xxx.html 可测变体
```

## 8. 可继续的方向

- 录像合成标注流（`canvas.captureStream` + `ctx.filter`，按需付费 CPU）
- 快照相册（gallery）面板 + 批量导出 zip
- 直方图（Camm 的 Histogram；可复用 `frameCanvas` 降采样）
- B/C/D 组差距：套索选区、区域统计（min/max/均值）、比例尺工具、对齐分布、测量分组显隐等

*与 `CamMeasure.html`（约 2740 行）一致。2026-11-26*
