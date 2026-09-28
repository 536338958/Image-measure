# CameraMeasure 图像测量工具 — 开发交接文档

> 本文件面向接手后续开发的 AI/开发者。目标是让你在**不逐行通读**全部代码的前提下，快速建立准确的心智模型，知道每块逻辑在哪、数据怎么流、改动时要注意什么。文中所有函数名、状态字段名均与源码一致，可直接用编辑器搜索定位。

---

## 1. 这是什么

`CameraMeasure.html`（部署时可复制为 `index.html`）是一个**纯前端、单文件、免构建**的浏览器图像测量工具。用户导入一张照片，用两点标定真实比例（标尺），然后在图上做各种几何测量（距离、角度、圆、面积等），并可导出为工程文件（JSON）、图片（PNG）或测量报告（PDF）。

核心设计约束（请务必延续，这是产品的立身之本）：

- **单文件**：全部 HTML + CSS + JS 都在一个 `.html` 里。双击即可打开，无需服务器、无需 npm/构建步骤。
- **零后端**：所有数据（图片、测量结果）只存在于用户当前浏览器内存里，不上传、不落盘到服务器。
- **唯一外部依赖**：通过 https CDN 加载 jsPDF（`<head>` 里的 `jspdf.umd.min.js@2.5.1`），仅用于 PDF 导出。其余全部是原生 vanilla JS + Canvas 2D，不用任何框架。
- **可离线**：除 PDF 导出外，断网也能用。

部署方式就是把这个 HTML 丢到任意静态托管（如 GitHub Pages）即可，命名为 `index.html` 时根路径直接访问。

---

## 2. 代码整体结构

文件从上到下分三段：

1. **`<style>`（约 8–396 行）** — 全部 CSS。用 CSS 变量做主题（`:root` 里的 `--bg/--panel/--accent…`），亮色主题通过 `html[data-theme="light"]` 覆盖。响应式断点是 `@media (max-width:820px)`。
2. **`<body>`（约 397 行之前的 HTML 结构）** — header 工具栏、二级工具栏 `.toolbar2`、`<main>`（`#stage` 里放 `#canvas` 和 `#loupe`）、右侧属性面板、各种弹窗（标尺输入 `#mask`、帮助 `#helpMask`）、拖放遮罩 `#dropMask`、底部状态栏、左下/右下悬浮控件（约束键、方向键 dpad）。
3. **`<script>`（397–1554 行）** — 全部逻辑，包在一个 IIFE 里：`(function(){ "use strict"; … })();`。所有函数和状态都是模块私有，不污染全局。

> 约定：`const $=id=>document.getElementById(id);`（397 行）是全篇取 DOM 的快捷方式。
> 行号会随迭代漂移，别死抠；**用函数名/id 全文搜索更可靠**。

---

## 3. 核心数据模型

### 3.1 全局状态 `S`（约 417 行起）

单一可变全局对象，几乎所有运行时状态都挂在这里：

- `img / imgName / imgData` — 当前图片的 `Image` 对象、文件名、dataURL（导出工程时存的就是 `imgData`）。
- `view:{scale,ox,oy}` — 视图变换。图像坐标 → 屏幕坐标：`x*scale+ox`。见 `imgToScreen/screenToImg`（673–674 行）。
- `mode` — 当前工具模式：`"select"`、`"calibrate"` 或某个 `SHAPES` 的键（如 `"line"`）。
- `unit / pxPerUnit / calibLine` — 单位字符串、每单位多少像素、标尺线 `{p1,p2,realLen,unit}`。`pxPerUnit` 为 `null` 表示未标定。
- `measures[]` — 所有已完成的测量图形对象（结构见 3.2）。
- `selId / active` — 当前选中的测量 id、当前激活的顶点索引（-1 表示无）。
- `placing / cursorImg / adjusting` — 正在放置中的图形（见第 6 节状态机）。
- `gColor / gLineW / scaleLocked` — 全局颜色、全局线宽（默认 2）、标尺是否锁定。
- `constrain` — 角度约束开关（等价于按住 Shift）。
- `customAngles` — 长度 10 的自定义约束角度数组（字符串或空串），默认 `["30","45","60","","",…]`。
- `snapPt / extSegs` — 当前吸附点（含 `kind`）、当前显示的延长线段集合。
- `langPref/lang`、`themePref/theme` — 语言与主题（`auto` 会解析系统偏好）。
- `nextId / counters` — 自增 id、各类型计数器（用于默认标签命名，如"直线1"）。

### 3.2 测量图形对象（统一模型）

`S.measures` 里每个元素结构统一：

```
{ id, type, label, color, lw, dash, labelOff, pts:[{x,y}, …], _lbl }
```

- `type` — `SHAPES` 的键。
- `color / lw / dash` — **单条覆盖**，为 `null` 时回退到全局 `gColor/gLineW`。
- `labelOff:{x,y}` — 标注文字相对锚点的偏移（用户可拖动标注，见 `hitLabel`）。
- `pts` — **图像坐标**下的点数组（不是屏幕坐标！所有几何都以图像坐标存储，缩放/平移不影响数据）。
- `_lbl` — 运行时缓存的标注包围盒 `{x,y,w,h}`（屏幕坐标），供命中测试用，不参与序列化。

### 3.3 图形注册表 `SHAPES`（393–406 行）

每种测量类型的元数据：`{label(中文名), en(英文名), click(需要的点数，0=不定长), hint(中文提示)}`。当前 12 种：`line, angle, parallel, pointline, arc, circle, circle3, ellipse, rect, polygon, spline, aux`。

**新增一种测量类型的完整清单**（重要，按此逐项做即可）：

1. `SHAPES` 里加一条（含 `click` 点数）。
2. `computeShape`（690 行）里加 `case`，返回 `{text, detail, kind, value}`。
3. `renderShape`（747 行）里加绘制分支（决定线怎么画、`anchor` 标注锚点、`centerImg` 圆心标记）。
4. `segmentsOf`（894 行）里返回它可被吸附的线段（若有）。
5. `hitBody`（810 行）里加命中测试分支（用于选择模式点选）。
6. 若需要在二级工具栏出现按钮，加对应 HTML 和 `hint_xxx` i18n。
7. i18n 的 `zh/en` 里补 `hint_<type>`。

---

## 4. 渲染管线

### 4.0 HiDPI 坐标约定（改动后必读）

画布位图按 **CSS 尺寸 × devicePixelRatio** 分配，再用 `ctx.setTransform(DPR,0,0,DPR,0,0)` 把坐标单位还原成 CSS 像素：

- `CW / CH / DPR` 是模块级变量，由 `resize()` 维护。**所有与画布尺寸相关的运算一律用 `CW/CH`，禁止用 `canvas.width/height`**——后者是已经乘过 DPR 的位图尺寸，混用会导致清屏不全、`fitView` 算错。
- 命中测试用的坐标来自 `getBoundingClientRect()`（本来就是 CSS 像素），**不受这次改动影响**。
- 放大镜自身也是 canvas，同样按 DPR 分配位图（`syncLoupeDpr()`），否则放大镜自己就是糊的。
- DPR 会因跨屏拖动 / 系统缩放变化而改变，用 `matchMedia("(resolution: Xdppx)")` 监听并重配。

### 4.1 绘制流程

- `resize()` —— 量 `#stage` → 算 `CW/CH/DPR` → 配位图 → `setTransform` → `draw()`。
- `fitView()` —— 让图片适应窗口居中（用 `CW/CH`）。
- `draw()` —— **主画布每帧总入口**。清屏 → 画图片 → 调 `paintOverlay`。
- `paintOverlay(g, T, opt)` —— **覆盖层绘制**（标尺线、所有测量、放置中的草稿、延长线、吸附标记）。
  - 抽出来的意义：**同一个函数同时供主画布和放大镜使用**，两处渲染内容严格一致。
  - `opt.handles` 控制是否画选中手柄；`opt.cacheLbl` 才允许写 `_lbl` 缓存（**放大镜必须传 false**，否则会把放大镜坐标系下的包围盒写进 `m._lbl`，导致 `hitLabel` 失效）。
- `renderShape(g, m, T, opt)` —— **通用绘制器**，全篇最重要的函数之一。
  - `g` 是绘制上下文：主画布是真实 `ctx`；PDF 导出时是**矢量适配器**（第 12 节）；放大镜里也是真实 `ctx`，只是外面套了放大变换。
  - `T` 是"图像坐标 → 目标坐标"的映射函数（屏幕渲染用 `imgToScreen`；导出时用别的）。
  - `opt` 携带 `{k(缩放基准), lw, fs, dash, handles, active, sel, draft, cacheLbl, forceText}`。
  - 内部依次画：主体几何 → 端点/手柄 → 圆心 `+` 标记 → 可选半径读数 → 标注文字气泡。

> 关键点：`renderShape` **只依赖 `g` 暴露的 Canvas2D 子集 API**（`beginPath/moveTo/lineTo/arc/ellipse/stroke/fill/fillText/measureText/setLineDash/strokeRect/fillRect/save/restore` 及属性 `strokeStyle/fillStyle/lineWidth/globalAlpha/font/textBaseline/lineCap/lineJoin`）。这正是 PDF 矢量导出能复用它的原因——不要在里面用超出这个子集的 API，否则会破坏 PDF 导出。

### 4.2 放大镜为什么是矢量

旧实现是 `lg.drawImage(canvas, …)`：把主画布**已经栅格化**的位图再放大 4.5 倍（还关了插值），所以线条全是马赛克。

现在的做法是套一层变换后**重画一遍**：

```js
lg.translate(L/2,L/2); lg.scale(M,M); lg.translate(-sp.x,-sp.y);
lg.drawImage(S.img, …);                     // 照片本身就是位图（没法避免，也不该避免）
paintOverlay(lg, imgToScreen, {k:S.view.scale, handles:true});
```

因为 CTM 会同时作用于 `lineWidth`、`setLineDash` 的虚线间隔和文字字号，矢量图元在 4.5 倍下由 canvas 重新光栅化 —— **观感与旧版一致（等比放大），但边缘锐利、无像素块**。

> 已回退的一个优化：曾加过"按视口矩形裁剪掉外部图形"，但它有正确性坑——长直线、无限延伸的 `aux`、端点外还会多画 15% 的 `pointline` 都会穿过放大镜视口却因顶点在框外被误剔除。若将来真要优化，**必须按各类型的真实绘制范围（顶点 bbox + 该类型的延伸量）裁剪**，不能只看顶点。

### 4.3 端点 / 手柄的显示策略

| 时机 | 画什么 | 代码分支 |
| --- | --- | --- |
| 放置中（`opt.draft`） | 空心圆点（给取点反馈） | `renderShape` 端点段第 2 分支 |
| **鼠标悬停到它上面**（`opt.hover`，未选中时） | 小空心圆=端点、小方块=每条边的中点 | 端点段之后的 `opt.hover` 块 |
| 已选中且在 select 模式（`opt.handles`） | 方形手柄（可拖拽顶点） | 第 1 分支 |
| **已完成、未选中、也没悬停** | **什么都不画** | —— |
| `aux` 辅助线 | 仅在被选中时显示端点 | 开头的提前 return |

也就是说：**完成的图形不再留顶点圆点**，画面保持干净；要编辑就在 select 模式下点选它，手柄随即出现（插入/删除顶点同样会先选中，所以手柄可见）。

悬停高亮（`S.hoverId`）是为了弥补"画完就看不见点在哪"：鼠标移到图形上（复用 `hitBody`，7px）时，把它**当前的端点与每条边的中点**临时亮出来，移开即消失。

**主要场景是绘图模式**——画新线时要看清已有图形的端点/边中点在哪，才好吸附对齐；select 模式同样生效（方便点选编辑）。

- 命中：最上层优先，与点击选中的顺序一致（`selectDown` 用的是同一个顺序）。
- 三处 `mousemove` 分支都要算 hover：`S.placing`（正在画第二个点时）、绘图工具分支、select 分支。
  ⚠️ 末尾那个"其它模式清掉 hoverId"的 `else if` **必须排除绘图/放置分支**，否则刚算完就被自己清掉，画面一闪而过。
- 矩形显示**四角**（`cornerPoints`），其余类型显示 `m.pts`；边中点来自 `segmentsOf`，所以圆/圆弧/椭圆没有中点可显示。
- 只在**未选中**时画：选中的那个走方形手柄，避免两套标记叠在一起。
- 只有命中结果变化时才 `draw()`，不会每次 `mousemove` 都重绘。
- 放大镜走同一个 `paintOverlay`，所以放大镜里也能看到这些点。
- 状态清理：`mouseleave`、`setMode`、`delMeasure`、`_restore` 都会把 `S.hoverId` 置空（否则可能悬停到一个已被删除的图形）。

> 已知落差：矩形悬停会亮出四角，但**只有对角两点可拖**（`handleAt` 只认 `m.pts`）。想让派生角也能拖，需要把"拖派生角"映射成同时改两个对角坐标，见第 17 节。

## 4.4 样式的归属策略（重要，改动前务必读）

一条测量线的最终样式由 `m.color / m.lw` 决定，`null` 才回退到全局 `S.gColor / S.gLineW`。

政策：**落笔即固化**。

- `finalizePlacing` 创建时就写入当前 `S.gColor / S.gLineW`（不再是 null）→ 之后改全局**不会**回头改变已画好的线。
- `readJsonFile` 导入时对 `null` 的项也补上当时的全局色（`m.color ?? S.gColor`）→ 旧工程加载后同样不跟随。**注意顺序**：`d.style` 必须在 measures 映射之前恢复，否则 bake 到的是旧全局色。
- 想让某条重新跟随全局：用列表项里的「↺ 全局」按钮（把 `color/lw` 置回 `null`）——这是**按条显式选择**的行为，不算回溯。
- 由此推论：新建的测量 `custom` 恒为真，列表里的「↺ 全局」按钮默认可用，这符合预期。
- 面板上有一行小字提示（`globalOnlyTip`）说明"仅对之后绘制的图形生效"，别删，否则用户会以为改色失灵。

> 原 `COLORS`（10 色数组）从未被任何代码引用，已替换为 `STD_COLORS`（20 色标准色板）。

---

## 5. 几何工具函数（668–687 行）

一批纯函数：`dist, mid, fmt(数字格式化), px2u(像素转真实单位), U(带单位格式化), pointLineDist, footOnLine, pointSegDist, angleDeg, circumcircle(三点外接圆), arcSamples(三点弧采样), polyArea, polyPerim, centroid, catmull(样条插值), ellipseInfo, circleOf`。这些是无副作用的，可放心复用/单测。

---

## 6. 放置流程状态机

放置一个图形的生命周期由 `S.placing / S.adjusting / S.cursorImg` 三个字段驱动：

- `S.placing = {type, pts:[…]}` — 正在放置的图形及其已确定的点。
- `S.adjusting` — 当前最后一个点是否处于"按住拖动微调"状态。
- 相关函数：`placementClick(sp,e)`（984）添加点、`placementUp()`（995）松开确认当前点、`finalizePlacing()`（1004）达到 `click` 点数或双击/回车后落地成 `S.measures` 里的正式对象、`cancelPlacing()`（1014）取消。
- 不定长类型（`polygon/spline`，`click:0`）靠双击或回车结束。

鼠标端在 mousedown/mousemove/mouseup 里驱动；触屏端在 `touchstart/move/end` 里驱动（见第 10 节）。

---

## 7. 约束系统（828–850 行）

- `CON(e)`（829）—— 是否启用约束 = 按住 Shift **或** `S.constrain` 开关为真。
- `constraintAngles()`（831）—— 生成允许的方向角集合（弧度）：默认 `{0,90,180,270}`（平行/垂直），再加上 `S.customAngles` 里每个自定义角度在四象限的镜像。
- `constrain(prev,cur,type)`（836）—— 把 `cur` 沿"最接近的允许方向"投影到 `prev` 出发的射线上（对矩形/椭圆等做正形约束）。
- 自定义角度的 UI 在 `buildAngleGrid()`（1172）里动态生成（滑块 + 数字输入双向绑定），写回 `S.customAngles`。

---

## 8. 吸附系统（902–982 行）—— 重点，最近迭代较多

这是交互精度的核心，几个函数协作：

- `allSegments()`（902）—— 收集所有可吸附线段：各测量图形（经 `segmentsOf`）、标尺线、正在放置的已定段。**注意：辅助线 `aux` 在这里被延伸成 ±20000 的长线段**（905 行），因为它视觉上是无限延伸的，这样它与其它线的交点、垂足才吸附得到。
- `cornerPoints(m)` —— **矩形只存对角两点**，另外两个角是派生的。这里显式补齐矩形四角，否则光标压在那两个角上会"无点可吸"，只能被 4 条边的中点抢走。
- `featurePoints()` + `BIAS={point:0,cross:0,center:2,mid:6}` —— 统一的候选点收集器（端点 / 矩形四角 / 中心 / 标尺端点 / 放置中的已定点，外加边中点与交点）。**排序用 `距离 + bias`，不是纯距离**：端点与交点优先，边中点要近 6px 以上才盖得过端点。
  ⚠️ 这是修"想抓角却抓成边线中点"的关键：纯比距离时，光标稍微偏向边中间就会被 mid 抢走，放大镜里显示成实心小方块的 mid 标记。
- `snapVertex(sp)` —— 主吸附函数。精确点（阈值 11px，按 `距离+bias` 排序）> 线段垂足/延长线（阈值 8px）。返回 `{x,y,kind}`，`kind∈{point,center,mid,cross,line}`，`draw()` 里据此画不同标记（交点是绿色 ×，边中点是实心小方块）。
- `segSegIntersect / allIntersections`（927/932）—— 两两线段求交，交点作为 `"cross"` 吸附目标（矩形相邻边共享顶点，所以四角同时也在这个集合里）。
- `snapAlongRay(prev,ux,uy,sp)` —— **约束保持吸附**：开启约束时，端点被锁在约束射线上，只能沿该射线吸附（吸到射线与其它线的交点，或投影到射线附近的特征点）。同样带 bias 排序。
- `snapConstrained(prev,type,sp)` —— **矩形/椭圆的约束吸附**：候选点先各自过一遍 `constrain()`，再挑离光标最近的一个。这样吸附到端点时形状仍是正方形/正圆——不会为了吸附把正方形拉成长方形。
- `placePoint(prev,ipRaw,type,conOn,sp)` —— **统一落点决策**，被全部 4 个放置调用点复用（鼠标移动预览、鼠标移动微调、`placementClick` 后续点、触屏放置）。逻辑：
  - 约束开 + 有前点 + `rect/ellipse` → `snapConstrained`（找不到才退回纯约束点）；
  - 约束开 + 有前点 + `circle/circle3` → 走普通 `snapVertex`（圆类不受方向约束，旧代码在这里会把吸附整个关掉）；
  - 约束开 + 有前点 + 方向型图形 → `snapAlongRay`；
  - 其它 → 普通 `snapVertex`。
- `updateExtSeg(sp)`（918）—— 维护"延长线"显示集合 `S.extSegs`（光标贴近某线段本体时激活其延长线，可吸附到延长线）。

> 修改吸附行为时，几乎总是改这几个函数之一，且要保证 `placePoint` 的 4 个调用点行为一致。

### 8.1 放大镜里的"落点"提示

`drawLoupe()` 的中心十字画的是**手指/光标位置**，而约束或吸附会让真正落下去的点与之错开（矩形约束下最明显：落点被拉到正方形对角，手指却停在矩形边线上，看起来就像"抓在边中间"）。所以落点与光标偏差 > 3px 时，放大镜里额外画一个**蓝色方块**标出真实落点（`S.cursorImg`）。

---

## 9. 选择 / 编辑 / 撤销

- 选择模式：`selectDown`（1028）命中手柄/标注/本体 → 设 `S.selId/active/drag`；`dragMove`（1033）拖动顶点或整体或标注；`nudge`（1043）方向键微调。
- 插入顶点：`nearestEdge/tryInsertVertex`（1053/1054）—— 多边形/样条双击边可插入新顶点。
- **撤销/重做**（1017–1024）：基于快照的历史栈。`_snap()`（1018）把关键状态 `JSON.stringify` 成字符串，`_restore()`（1019）解析还原。`commit()` 在每次"有意义的改动完成后"调用（放置完成、拖动结束、删除、导入等）。`HIST_MAX=200`。
  - **改动数据结构时切记同步更新 `_snap/_restore`**（例如加了新的持久字段，要加进快照，否则撤销会丢失它）。

---

## 10. 触屏 / 手势

- `T` 对象是手势状态机：`mode∈{pan,drag,pinch,place}`、起点、pinch 基准、`lastTapT/lastTapSp`（双击检测）。
- 单指：select 模式下先试抓取，否则平移；放置模式下"按下即定点、拖动微调、松开确认"，并用双击检测完成多边形/样条。
- 双指：pinch 缩放（以两指中点的图像坐标为锚点）。**只冻结正在微调的点，绝不 pop 已放好的点**——双指是绘制途中平移/缩放的唯一手段，旧实现会丢点。
- 触屏设备初始化时默认打开放大镜。
- 放大镜 `drawLoupe(sp, touch)`：`touch=true` 时（仅由 touch 事件调用）窗口放到**触点上方**并放大到 180px；鼠标走原来的右下偏移 + 152px。**手指会盖住右下方，鼠标不会**，这是分开处理的原因。
- `IS_TOUCH` 由 `ontouchstart`/`maxTouchPoints` 推断，仅用于决定浮动操作条是否出现。
- **绘制中的浮动操作条 `#placeBar`**（`↩ 退一点 / ✓ 完成 / ✕ 取消`）：触屏没有 Esc/Enter，`S.placing` 存在时显示。定点数图形（need>0 且已够点）会自动收尾，此时隐藏"完成"。
- `nudge(dx,dy)` 的入参是**屏幕像素**，内部乘 `1/S.view.scale` 换算成图像像素。改动前后在 100% 缩放下行为一致，缩小视图时不再"按了没反应"。
- `popLastIfDuplicate(pts)`：双击收尾时剔除多余顶点，**必须用屏幕像素比较**（`DUP_TAP_PX=24`），因为双击判定本身也是屏幕像素。桌面 `dblclick` 与触屏双击共用它。
- 底部悬浮控件（`floatpad / dpadwrap / statusbar / placeBar`）都用 `env(safe-area-inset-*)` 避开 iOS home indicator；`#app` 用 `100dvh`（回退 `100vh`）避开移动 Safari 视口跳动。

---

## 11. 导入导出

- **工程 JSON**（`btnExport`/`btnImport`，1264–1267）：schema 带 `app:"CameraMeasure", version:3`。包含图片 dataURL、单位、标定、`scaleLocked`、全局样式、语言/主题偏好、measures（只存 `type/label/color/lw/dash/labelOff/pts`，id 导入时重建）。**改 schema 时请升 version 并在导入端做向后兼容**（现有导入用了大量 `??`/默认值兜底）。
- **PNG**（`exportPng`，1288）：`renderAnnotated(scale)` 把图片+标注渲染到一个离屏 canvas，导出位图。
- **CSV**（`exportCsv`，1274）：把测量清单导出为 UTF-8 **带 BOM** 的表格（Excel 直接打开不乱码）。列：名称 / 类型 / 测量值 / 明细，末尾追加「长度合计」与「比例尺」两行。表头走 i18n（`csvLabel/csvType/csvValue/csvDetail/csvScale`），随界面语言变化。
- **PDF**（见下节）。

### 11.1 图片与工程文件的三种入口

统一的读取函数是 `readImageFile(f)`（1225）与 `readJsonFile(f)`（1267），三种入口都走它俩：

1. 顶部按钮 + 隐藏 `<input type=file>`（常规）。
2. **拖放到窗口任意位置**（1229–1246）：`dragenter/dragover/dragleave/drop` 绑在 `window` 上，`dragenter` 计数 `depth` 控制 `#dropMask` 遮罩显隐（嵌套子元素 enter/leave 不会误关闭），`drop` 时按扩展名 `.json` / MIME 分流。注意 `readJsonFile` 是函数声明（hoisting），虽然定义在后面仍可安全引用。
3. **剪贴板粘贴 Ctrl+V**（1248–1254）：取 `clipboardData.items` 里第一个 `image/*`。**先看 `document.activeElement`**，若焦点在 INPUT/TEXTAREA/SELECT 则直接返回，否则会把「往标注名输入框里粘贴文字」拦掉。

> 拖入/粘贴会整体更换 `S.img`，但**不会清掉已有测量**——点仍以图像坐标留在原处。这是刻意的（换同尺寸图可继续测）；若要「换图就清」，应在 `loadImage` 里加显式确认，不要静默丢数据。

---

## 12. PDF 矢量导出（1229–1336 行）—— 最近重点改造，务必理解

需求演进：PDF 里的**测量线条和文字要是矢量**（放大不糊），但**中文不能乱码**。最终方案：

- `exportPdf()`（1312）：先画报告表头，再把**照片本身作为位图**贴入（`renderPhoto(sc)` 只画图片，1230 行），然后调 `drawVectorOverlay` 把标注以**矢量**叠加在照片上，最后画底部测量表格。若矢量叠加抛错，`catch` 会回退到整幅位图（`renderAnnotated`），保证导出不失败。
- `drawVectorOverlay(pdf,ix,iy,iw,ih,sc)`（1233）：构造矢量适配器 `makePdfCtx`，然后**复用 `renderShape`** 把标尺线和所有测量画出来。这就是为什么 `renderShape` 必须只用 Canvas2D 子集 API。
- `makePdfCtx(pdf,f,ox,oy)`（1242）：**核心适配器**。对外表现得像一个 Canvas 2D context，内部把每个绘制调用翻译成 jsPDF 矢量图元：
  - 累积路径（`beginPath/moveTo/lineTo/arc/ellipse/closePath`），`stroke/fill` 时用 `pdf.lines` 一次性画连续路径（保证虚线连续）。
  - `arc/ellipse` 被采样成折线；`arcTo`（仅 `roundRect` 用）近似为 `lineTo`（标注框变直角，可接受）。
  - 颜色解析 `parseColor` 支持 `#rgb/#rrggbb/rgba()`；透明度用 jsPDF `GState`（`opacity`+`stroke-opacity`）。
  - `f` 是"canvas 像素 → mm"的换算系数（= 贴图宽度 mm / 照片像素宽度）。所有坐标/线宽/字号都乘 `f` 换算到 mm。
  - **中文处理**：`hasCJK(t)` 检测字符码 > 255（中文、弧长符号 ⌒ 等）。命中则把该段文字用系统中文字体渲染成 4× 高清 canvas 位图，再 `addImage` 贴到精确位置；否则走 jsPDF 矢量文字（数字、单位、`°`、`²` 等 Latin-1 字符仍是矢量，清晰锐利）。`measureText` 也按同规则测量（中文用 canvas 量，拉丁用 `pdf.getTextWidth`），确保标注框大小与文字匹配。
- `cjkText(pdf,txt,x,y,ptSize,rgb)`（1301）：**表格/表头**里可能含中文的文本（图片文件名、测量标签、数值）走这个独立函数，逻辑同上——纯拉丁走 `pdf.text`，含中文渲染成位图贴入。底部表格的 label/value 已改用它。
- `asc(s)`（1336）：把 `² ⌒ × Ø` 等符号降级成 ASCII（`^2 arc x D`），用于表格数值列。

> 结论：**照片是位图，线条/几何是矢量，拉丁文字是矢量，中文/特殊符号是嵌入的高清位图**。这是在"不内嵌几 MB 中文字体"约束下的最优折衷。若将来要中文也矢量化，唯一正路是用 `addFileToVFS`+`addFont` 内嵌一个子集化的 CJK TTF，但会显著增大文件体积。

---

## 13. i18n 与主题

- `I18N={zh:{…}, en:{…}}`（426 行起）。取词 `L(key, ...args)`（609），支持 `{0}{1}` 占位。
- `applyStaticLang()`（612）根据 `data-i18n` 属性批量刷新静态文本；`iconifyHeader()`（627）把 header 按钮变纯图标+悬停提示。
- 图形名/提示：`shapeName/shapeHint`（610/611）。
- 主题：`resolveTheme/applyTheme`（646/653），`themePref` 为 `auto` 时跟随系统。
- **新增可见文案时**：务必同时加 `zh` 和 `en` 两条，并在 HTML 里用 `data-i18n` 或在代码里用 `L("key")`，不要硬编码中文字符串。

---

## 14. 关键 DOM id 速查

工具按钮：`btnOpen, btnCalib, btnLoupe, btnRadius, btnZoomFit, btnImport, btnExport, btnPng, btnCsv, btnPdf, btnHelp, btnUndo, btnRedo, btnDel, btnClear`。
拖放遮罩：`dropMask`（纯展示，`pointer-events:none`，靠 class `on` 显隐）。
标尺面板：`scaleVal, scaleRow2, scaleUnit, lockRow, btnScaleLock`。
全局样式：`gColor, gWidth, gWidthNum`。
列表：`mlist`（`renderList` 渲染，条目 class `.mitem`，`dataset.mid` 存测量 id）。
自定义角度：`angleGrid`（`buildAngleGrid` 生成）。
**常用标准色板：`gSwatches`**（`buildSwatches` 生成 20 个 `.sw` 按钮，选中态加 `.sel`；`STD_COLORS` 是那 20 个色值）。
画布/放大镜：`canvas, stage, loupe`。弹窗：`mask/dlgInput/dlgUnit/dlgOk`、`helpMask/helpBody/helpClose`。文件输入：`fileImg, fileJson`。

事件绑定集中在约 1188–1471 行（弹窗、图片、工具栏、JSON、PDF、菜单、悬浮键、键盘、鼠标、触屏），`init` 收尾在 1473–1480。

---

## 15. 编码约定与陷阱

- 全篇 IIFE + `"use strict"`，模块私有，别引入全局变量。
- **所有几何点存图像坐标**，绘制时才经 `T`/`imgToScreen` 转屏幕；不要把屏幕坐标存进 `pts`。
- 改了持久化字段 → 同步 `_snap/_restore`（撤销）**和** JSON 导出/导入。
- `renderShape` 内**只用 Canvas2D 子集 API**（见第 4 节），否则破坏 PDF 矢量导出。
- 新文案走 i18n（zh+en 都要）。
- PDF 相关改动后，务必回归测试"中文标签 + 放大不糊"两个点。
- 代码风格是紧凑单行（很多函数写在一行），保持一致即可；可读性靠函数名和分区注释。

---

## 16. 验证方法

除无浏览器环境下的两类校验（见下）外，现在有了一套**真正跑起来的 headless 冒烟测试**：`CameraMeasure_smoketest.js`（与 HTML 同目录）。

它用 jsdom 加载真实 HTML，并 stub 掉 canvas 2D context、`Image`、`getBoundingClientRect`、`URL.createObjectURL`，所以 init、作图、标定、撤销/重做、导出等流程都会真实执行到位，再断言 DOM 结果。**80 项检查全部通过**（含 HiDPI、放大镜矢量重绘、端点显示策略、色板与样式归属、触屏专项、取点优先级与约束吸附、悬停高亮）。

`mockCtx` 会把每次 2D 调用（`drawImage/stroke/scale/setTransform`…）按画布记录到 `canvasEl.__rec.calls`，所以可以断言"放大镜有没有去采样主画布位图"这类**行为**而不只是"没崩"。测试里 `devicePixelRatio` 被伪造成 2，以便真实验 HiDPI 分支。运行方式：

```bash
NODE_PATH=<隔离目录>/node_modules node CameraMeasure_smoketest.js
# 依赖 jsdom，已装在 C:\Users\ZDB319\.workbuddy\binaries\node\workspace
# 结果写进同目录 _smoke.txt（每条 PASS/FAIL 带实际值）
```

已覆盖：init 无异常、i18n 落地、CSV 按钮接线、拖放遮罩状态机（enter 深度计数）、拖入图片、鼠标点击成对放置直线、未标定时的文案、标定对话框、比例尺与自动锁定、Ctrl+Z/Ctrl+Y（含「删除后撤销能找回」）、CSV 的 BOM 与内容、工程 JSON 导出→清空→拖入还原、粘贴图片、非法文件只 toast、语言切换、**放大镜未采样主画布、放大镜走 scale(4.5) 矢量重绘、放大镜确有 stroke 图元**、**已完成图形无端点圆点、选中后手柄复现、放置中仍有空心端点反馈**、**20 色板渲染与选中环、改全局色后已画的线（含刚画的）不变色、改全局线宽同理**。

> 坑备忘：`Blob.text()` 按规范会**剥掉** BOM，所以验 BOM 必须用 `arrayBuffer()` 读原始字节（见脚本里第 17 项）。同理，模拟 Ctrl+Z 时别忘给 KeyboardEvent 传 `ctrlKey:true`，否则键鼠逻辑整段不进。

浏览器里仍需人工实测的点：吸附手感、触屏放置/双指缩放、PDF 实际渲染效果（放大清晰度、中文正确）、亮/暗主题、移动端布局。

---

## 17. 可继续改进的方向（非必需）

- **矩形只有两个可拖手柄**：`handleAt` 只认 `m.pts`（对角两点），所以选中矩形后只能拖那两个对角，另外两个派生角拖不动。吸附已经认四角了，编辑还没跟上——要改就得处理"拖派生角 = 同时改两个对角"的映射。
- 触屏命中容差（P1）：`handleAt` 10px / `hitBody` 7px 是按鼠标定的，粗指针下应放宽到 16–20px（可用 `matchMedia("(pointer: coarse)")` 判定）。
- PDF 中文若要矢量化：内嵌子集化 CJK 字体（权衡文件体积）。
- 目前工程状态仅靠手动导出 JSON；可考虑 `localStorage` 自动暂存（注意：本工具运行环境若为纯静态托管，localStorage 可用；但产品定位是"数据只在本地"，加此功能要向用户说明）。
- 更多测量类型（如坐标标注、比例尺水印）。
- 导出 PDF 的表格分页/样式增强。
- 换图后可否复用旧测量：目前替换 `S.img` 会保留原有点位，若新图尺寸不同，测量值含义会失真，可考虑加提示。

---

## 18. 变更历史

- **2026-09-28（悬停时临时显示端点 / 边中点）**
  - 需求：图形画完后端点被清掉了（画面整洁），但取点时"看不见点在哪"。现在**鼠标悬停到图形上**会临时亮出它的端点与每条边的中点，移开即消失。
  - ⚠️ 第一版只做在 select 模式，**理解偏了**：真正需要它的是**绘图模式**（画新线时对齐已有图形的端点/边中点）。现已覆盖三处 `mousemove` 分支：绘图工具分支、**放置中**（第一点已落下、正在找第二点）、select 分支。
  - 新增状态 `S.hoverId` + 两个函数：`hoverAt(sp)`（复用 `hitBody`，最上层优先）、`hoverAnchors(m)`（端点取 `m.pts`，矩形取四角；中点取 `segmentsOf` 的各边中点）。
  - `renderShape` 新增 `opt.hover` 分支：小空心圆=端点，小方块=边中点，样式比选中手柄轻一档。**仅在未选中时画**，避免与手柄叠加。
  - 只有命中结果变化时才重绘；`mouseleave` / `setMode` / `delMeasure` / `_restore` 都会清空 `S.hoverId`。放大镜共用 `paintOverlay`，同样能看到。
  - 顺手把光标逻辑补齐：select 模式下悬停到任意图形即显示 `move` 光标（原来只在已选中时判断）。
  - 测试 74 → **80 项全通过**；新增 61/61b/62（select 模式）与 63/63b/64（绘图模式 / 放置中），均通过**变异测试**：D（hover 不传给 renderShape）→ 61/61b；E（只显端点不显中点）→ 61b；F（命中恒为 null）→ 61/61b；G（绘图分支不算 hover）→ 63/63b；H（放置中不算 hover）→ 64；I（尾部又把 hoverId 清掉）→ 63/63b/64。
    ⚠️ 断言前提有三条，任一不满足断言就会变成恒真的摆设：
    ① 61 必须先点空白处**取消选中**，否则走手柄分支、hover 根本不触发；
    ② 63 的取样点要避开端点与中点，否则吸附标记的两个绿圈会混进 arc 计数（4 而非 2）；
    ③ 63/64 必须按 **`clearRect` 切出最后一帧**来统计 —— 若某处先画标记再清掉重绘，按整段时间统计总数照样有值，H/I 两个变异就是这样漏过去的。

- **2026-09-24 晚（取点：抓端点而不是边线中点）**
  - 修：**矩形四角补齐为端点候选**（`cornerPoints`）。矩形只存对角两点，另外两角是派生的，旧代码在光标压住那两个角时"无点可吸"，只能被 4 条边的中点抢走。
  - 修：**吸附改为"距离 + 权重"排序**（`BIAS`：端点/交点 0、中心 2、边中点 6）。纯比距离时，光标稍偏向边中间就被 mid 抢走 → 放大镜里显示实心方块的 mid 标记。现在端点在 11px 内优先，边中点要近 6px 以上才盖得过。
  - 修：**约束时不再关掉吸附**。新增 `snapConstrained()`：矩形/椭圆的候选点先过一遍 `constrain()` 再取最近，所以吸附到端点的同时形状仍是正方形/正圆；圆类（`circle/circle3`）其实不受方向约束，改为直接走普通 `snapVertex`。
  - 增：放大镜在"真实落点"与手指错开 >3px 时，额外画一个蓝色小方块标出落点（约束下最明显——落点被拉到正方形对角，手指却停在矩形边线上）。
  - 测试增至 **74 项全通过**；新增 57/58/59/59b/60 均通过**变异测试**：A（mid 权重改回 0）→ 58 FAIL；B（矩形约束恢复为不吸附）→ 59/60 FAIL；C（删掉落点标记）→ 60 FAIL。变异脚本见 `_mutate.js`。
    ⚠️ 断言设计要点：58 必须用**短线段**（24 屏幕 px），让端点与中点同时落在 11px 吸附半径内且中点更近，否则场景不成立、断言恒真。

- **2026-09-24 下午 2（色板 + 样式归属）**
  - 新增：20 个常用标准色（`STD_COLORS`），渲染为 `#gSwatches` 里的 10×2 色块；点选即设为全局色，当前色用双层描边环标出；原生 `<input type=color>` 保留，用于任意色。
  - 改：**落笔即固化样式**。`finalizePlacing` 新建时写入当时的 `S.gColor/S.gLineW`；导入时对 null 项同样 bake。于是改全局颜色/线宽**只影响之后画的线**，已画的不受影响。
  - 兜底：单条仍可用列表里的「↺ 全局」回到跟随全局；面板加 `globalOnlyTip` 小字说明。
  - 顺手清掉从未被引用的 `COLORS` 死代码。
  - 测试增至 **60 项全通过**；新增的 47/49 通过**变异测试**验证（把固化改回 null 后会 FAIL：`#ffffff→#ff3b30`、`2→7`）。
    ⚠️ 教训已记：第一版断言检查的是**从 JSON 导入**的那条线，变异体照样通过——因为它走的是导入 bake 而非落笔 bake。**断言必须正好命中被测的那条路径**。

- **2026-09-24 傍晚（触屏批次 1/3/4/6）**
  - 修①放大镜遮挡：`drawLoupe(sp,touch)`，触屏放到触点上方并放大到 180px（手指会盖住右下方，鼠标不会）。
  - 修②双击收尾单位混用：抽出 `popLastIfDuplicate()`，统一按**屏幕像素**（`DUP_TAP_PX=24`）比较，桌面 `dblclick` 与触屏双击共用。旧代码判定用屏幕 px、去重却用图像 px，缩小视图时去重失效 → 多边形多出退化顶点。
  - 修③绘制中无法取消：新增浮动操作条 `#placeBar`（退一点 / 完成 / 取消），仅 `IS_TOUCH` 时显示；同时**双指手势不再 pop 已放好的点**（旧行为"一平移就丢点"，而双指是绘制途中平移的唯一手段）。
  - 修④安全区：`floatpad/dpadwrap/statusbar/placeBar` 加 `env(safe-area-inset-*)`；`#app` 改 `100dvh`（回退 `100vh`）；补 `-webkit-touch-callout:none`。
  - 修⑥微调步长：`nudge()` 入参改为**屏幕像素**，内部乘 `1/S.view.scale`。缩小时不再"按了没反应"（100% 缩放下行为不变）。
  - 测试增至 **70 项全通过**；新断言全部**做了变异测试**：四合一变异体下 50/50b/50c/55/56 均 FAIL（其中 56 从"3 边"退化为"4 边"）。
  - 自查发现并修掉的连带问题：`#placeBar` 与 `#statusbar` 同为底部居中，会叠在一起 → 操作条抬到 `bottom:48px`。
    ⚠️ 又一个空过陷阱：56 的第一版因为相邻顶点间隔 <320ms，第 4 次点击**本身**就被判成双击，场景压根没发生、断言恒真。已在测试里加 `pause(360)` 跨过判定窗口。

- **2026-09-24 下午（端点清理）**
  - 改：已完成的图形不再绘制顶点圆点（删掉 `renderShape` 端点段的 `else if(opt.dash===undefined)` 实心点分支）。保留放置中的空心反馈点与选中后的方形手柄，**编辑能力不受影响**。
  - 导出 PNG / PDF 与屏幕表现一致，同样不含端点圆点（两者共用 `renderShape`）。
  - 冒烟测试新增 38/38b/38c/39/40 五项，并用**变异测试**验证过断言非空过：把旧圆点分支加回去后，38 会 FAIL（`arc=2`）。
  - `CameraMeasure_smoketest.js` 支持 `CM_FILE` 环境变量指定被测文件，便于做这类变异回归。

- **2026-09-24（上一轮：渲染保真）**
  - 修：`resize()` 完全忽略 devicePixelRatio，高分屏（125%/150% 缩放）下整幅线被拉伸发虚。改为位图按 CSS×DPR 分配 + `setTransform` 还原坐标系，并监听 DPR 变化。新增共用变量 `CW/CH/DPR`，**此后不要用 `canvas.width/height` 做尺寸运算**。
  - 修：放大镜原来是 `drawImage(canvas,…)` 放大已栅格化的位图（还关了插值）→ 线条马赛克。改为套 `translate/scale(M)/translate` 后**用同一套绘制命令重绘**，因 CTM 同时作用于 lineWidth、虚线间隔与字号，观感与旧版一致但完全锐利。
  - 抽：把覆盖层从 `draw()` 里抽出 `paintOverlay(g,T,opt)`，主画布与放大镜共用，保证两处内容严格一致。放大镜必须传 `cacheLbl=false`，否则 `_lbl` 会被写成放大镜坐标系而让 `hitLabel` 失效。
  - 放大镜 canvas 同样按 DPR 分配位图（`syncLoupeDpr`）。
  - 曾加"视口裁剪"优化后回退（原因见 4.2 的警示框）。
  - 冒烟测试扩到 44 项（新增 HiDPI 断言 + 通过录制 2D 调用断言放大镜走矢量路径）。

- **2026-09-23（上一轮）**
  - 修：帮助文档承诺「把图片拖进窗口」但代码从未实现 drag/drop —— 补齐拖放导入（图片 + 工程 JSON），带全屏 `#dropMask` 提示层。
  - 新增：Ctrl+V 粘贴剪贴板图片（焦点在输入框时不拦截，避免影响往标注名里粘贴文字）。
  - 新增：导出 CSV 测量表格（UTF-8 BOM，i18n 表头，含合计行与比例尺行）。
  - 修：导出 PNG / PDF 的比例尺标注硬编码英文 `"Scale "`，改为走 i18n `L("scalePrefix")`（新增 `calibText()`，695 行）。
  - 新增：`CameraMeasure_smoketest.js` headless 冒烟测试（29 项，全通过）。
  - 文件由 1459 行增至 1556 行；`index.html` 为同内容部署副本。

*本文件与当前 `CameraMeasure.html`（1556 行）一致。*
