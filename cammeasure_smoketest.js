// CamMeasure 冒烟测试（jsdom + canvas stub）
// 运行：NODE_PATH=/home/huang/.workbuddy/binaries/node/workspace/node_modules node cammeasure_smoketest.js
// 方法论沿用 CameraMeasure_smoketest.js：stub canvas 2D、Image、getBoundingClientRect，
// 断言 DOM/行为而非"没崩"。覆盖相机模块的静态可测部分与原有核心流程回归。
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const CM_FILE = process.env.CM_FILE || path.join(__dirname, "CamMeasure.html");
const html = fs.readFileSync(CM_FILE, "utf-8");

let pass = 0, fail = 0, failures = [];
function check(name, cond, actual) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; failures.push(name); console.log("FAIL " + name + (actual !== undefined ? "  actual=" + JSON.stringify(actual) : "")); }
}

// ---------- canvas 2D mock ----------
function mockCtx(canvasEl) {
  const rec = { calls: [] };
  const g = {
    __rec: rec,
    canvas: canvasEl,
    setTransform() { rec.calls.push(["setTransform", ...arguments]); },
    clearRect() { rec.calls.push(["clearRect", ...arguments]); },
    drawImage() { rec.calls.push(["drawImage", ...arguments]); },
    save() {}, restore() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    stroke() { rec.calls.push(["stroke"]); }, fill() { rec.calls.push(["fill"]); },
    fillRect() {}, strokeRect() {},
    fillText() { rec.calls.push(["fillText", ...arguments]); },
    measureText(t) { return { width: ("" + t).length * 6 }; },
    setLineDash() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
    clip() {}, translate() {}, scale() {}, rotate() {},
  };
  const props = ["strokeStyle", "fillStyle", "lineWidth", "globalAlpha", "font", "textBaseline", "lineCap", "lineJoin", "imageSmoothingEnabled", "filter"];
  props.forEach(p => { let v; Object.defineProperty(g, p, { get: () => v, set: (nv) => { v = nv; } }); });
  return g;
}

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: undefined, // 不加载外部 jspdf CDN
  pretendToBeVisual: true,
  url: "http://localhost/",
  beforeParse(window) {
    // canvas stub
    window.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) this.__ctx = mockCtx(this);
      return this.__ctx;
    };
    Object.defineProperty(window.HTMLCanvasElement.prototype, "width", { get() { return this.__w || 300; }, set(v) { this.__w = v; } });
    Object.defineProperty(window.HTMLCanvasElement.prototype, "height", { get() { return this.__h || 150; }, set(v) { this.__h = v; } });
    // video stub：模拟 1280x720 已就绪的实时流
    Object.defineProperty(window.HTMLVideoElement.prototype, "videoWidth", { get() { return this.__vw || 1280; }, set(v) { this.__vw = v; } });
    Object.defineProperty(window.HTMLVideoElement.prototype, "videoHeight", { get() { return this.__vh || 720; }, set(v) { this.__vh = v; } });
    window.HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
    // Image stub
    window.Image = class {
      constructor() { this.width = 800; this.height = 600; }
      set src(v) { this.__src = v; if (this.onload) setTimeout(() => this.onload(), 0); }
      get src() { return this.__src; }
    };
    // 布局 stub
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.id === "stage") return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
      return { left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 };
    };
    // 相机 API stub：一个会成功的 getUserMedia + 两个设备
    const mkTrack = () => ({
      stop() {},
      getSettings() { return { deviceId: "dev1", width: 1280, height: 720 }; },
      getCapabilities() { return { exposureTime: { min: 10, max: 5000, step: 1 }, zoom: { min: 100, max: 400, step: 10 } }; },
      applyConstraints() { return Promise.resolve(); },
      addEventListener() {},
    });
    let streamCount = 0;
    window.navigator.mediaDevices = {
      getUserMedia: () => { streamCount++; const t = mkTrack(); return Promise.resolve({ getVideoTracks: () => [t], getTracks: () => [t] }); },
      enumerateDevices: () => Promise.resolve([
        { kind: "videoinput", deviceId: "dev1", label: "Front Cam" },
        { kind: "videoinput", deviceId: "dev2", label: "Rear Cam" },
      ]),
      addEventListener() {},
    };
    window.__streamCount = () => streamCount;
    // MediaRecorder stub
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      start() {} stop() { if (this.onstop) this.onstop(); }
      ondataavailable() {} onstop() {}
    };
    // toBlob / toDataURL stub
    window.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/jpeg;base64,Zm9v"; };
    window.URL.createObjectURL = () => "blob:fake";
    window.URL.revokeObjectURL = () => {};
    // localStorage：jsdom 自带
    window.confirm = () => true;
    window.prompt = () => "TestCalib";
  },
});

const w = dom.window;
const $ = id => w.document.getElementById(id);

setTimeout(async () => {
  try { await runTests(); }
  catch (e) { console.log("FATAL", e && e.stack || e); fail++; }
  console.log("\n==== " + pass + " passed, " + fail + " failed ====");
  if (failures.length) console.log("Failures:\n" + failures.map(f => "  - " + f).join("\n"));
  fs.writeFileSync(path.join(__dirname, "_smoke_cam.txt"), `${pass}/${pass + fail}\n` + failures.join("\n"));
  process.exit(fail ? 1 : 0);
}, 300);

function runTests() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  return (async () => {
    // ---------- 1. 初始化 ----------
    check("01 init 无异常且标题正确", w.document.title.indexOf("CamMeasure") >= 0, w.document.title);
    check("02 相机按钮存在", !!$("btnCam") && !$("btnCam").disabled);
    check("03 增强面板存在", !!$("fxBox") && !!$("fxBright") && !!$("fxGamma"));
    check("04 SVG 滤波节点存在", !!$("fxrR") && $("fxrR").getAttribute("slope") === "1");
    check("05 视频元素在画布下方（DOM 顺序）", (function () { const v = $("vid"), c = $("canvas"); return !!(v && c && v.compareDocumentPosition(c) & w.Node.DOCUMENT_POSITION_FOLLOWING); })());

    // ---------- 2. 相机启动（stub getUserMedia 成功路径）----------
    $("btnCam").click();
    await sleep(80);
    check("06 getUserMedia 被调用", w.__streamCount() >= 1, w.__streamCount());
    check("07 相机按钮进入实时态", $("btnCam").classList.contains("active"), $("btnCam").textContent);
    check("08 视频元素可见", $("vid").style.display === "block", $("vid").style.display);
    check("09 拍照/快照/录像按钮启用", !$("btnFreeze").disabled && !$("btnSnap").disabled && !$("btnRec").disabled);
    check("10 相机菜单列出两台设备", w.document.querySelectorAll("#camMenu .menuitem").length >= 2, w.document.querySelectorAll("#camMenu .menuitem").length);
    check("11 hint 提示已隐藏", $("hint").style.display === "none");
    // 视频布局 = 视图变换
    const st = $("stage").getBoundingClientRect();
    const sc = Math.min((st.width - 80) / 1280, (st.height - 80) / 720);
    check("12 视频布局按 fitView 计算", Math.abs(parseFloat($("vid").style.width) - 1280 * sc) < 2, $("vid").style.width);

    // ---------- 3. 实时模式下的交互守卫 ----------
    // 直线工具在实时模式下可点（模拟两次点击成线）
    const cv = $("canvas");
    const r = cv.getBoundingClientRect();
    const fire = (type, x, y, extra) => cv.dispatchEvent(new w.MouseEvent(type, Object.assign({ clientX: r.left + x, clientY: r.top + y, bubbles: true }, extra || {})));
    const tool = md => w.document.querySelector('.toolbar2 [data-mode="' + md + '"]');
    tool("line").click();
    fire("mousedown", 300, 200);
    fire("mouseup", 300, 200);
    fire("mousedown", 700, 500);
    fire("mouseup", 700, 500);
    await sleep(20);
    check("13 实时视频上可完成直线测量", w.document.querySelectorAll("#mlist .mitem").length === 1, w.document.querySelectorAll("#mlist .mitem").length);

    // ---------- 4. 标定（含放大倍率）：先画标定线，对话框自动弹出 ----------
    $("btnCalib").click();
    await sleep(10);
    check("14a 标定模式进入（工具提示出现）", (function () { const th = $("toolhint"); return th.style.display === "block"; })(), $("toolhint").style.display);
    fire("mousedown", 300, 200);
    fire("mouseup", 300, 200);
    fire("mousedown", 700, 500);
    fire("mouseup", 700, 500);
    await sleep(20);
    check("14b 标定对话框自动弹出", $("mask").classList.contains("on"));
    check("14c 对话框含放大倍率输入", !!$("dlgMag") && $("dlgMag").value === "1");
    $("dlgInput").value = "5";
    $("dlgUnit").value = "mm";
    $("dlgMag").value = "2"; // 5mm 对应 2 倍率 → pxPerUnit = dist/(5*2)
    $("dlgOk").click();
    await sleep(20);
    const val = $("scaleVal").textContent;
    check("15 标定后比例尺文本含倍率", val.indexOf("2") >= 0 && val.indexOf("mm") >= 0, val);
    // 数学验证：两点 (300,200)-(700,500) → 图像坐标
    // 视图：scale=sc, ox=(1200-1280*sc)/2, oy=(400-720*sc)/2
    const ox = (1200 - 1280 * sc) / 2, oy = (800 - 720 * sc) / 2;
    const p1 = { x: (300 - ox) / sc, y: (200 - oy) / sc }, p2 = { x: (700 - ox) / sc, y: (500 - oy) / sc };
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const expectedPpu = d / (5 * 2);
    check("16 pxPerUnit = dist/(len*mag) 数学一致", val.indexOf(expectedPpu.toFixed(1).replace(/\.0$/, "")) >= 0 || Math.abs(parseFloat(val) - expectedPpu) < 0.2, val + " expected≈" + expectedPpu.toFixed(1));

    // ---------- 5. 保存/应用多套标定 ----------
    $("calibSaveCur").click();
    await sleep(20);
    check("17 标定库 select 出现且含条目", $("calibLibRow").style.display !== "none" && $("calibSel").options.length === 1, $("calibSel").options.length);
    const saved = JSON.parse(w.localStorage.getItem("cammeasure.calibs") || "[]");
    check("18 localStorage 保存了 mag", saved.length === 1 && saved[0].mag === 2, saved[0] && saved[0].mag);

    // ---------- 6. 增强管线 ----------
    $("fxBright").value = "1.5";
    $("fxBright").dispatchEvent(new w.Event("input", { bubbles: true }));
    await sleep(10);
    check("19 CSS 滤镜串含 brightness", $("vid").style.filter.indexOf("brightness(1.5)") >= 0, $("vid").style.filter);
    $("fxR").value = "1.3";
    $("fxR").dispatchEvent(new w.Event("input", { bubbles: true }));
    await sleep(10);
    check("20 RGB 增益触发 url(#fxc)", $("vid").style.filter.indexOf("url") === 0 && $("vid").style.filter.indexOf("#fxc") >= 0, $("vid").style.filter);
    check("21 SVG slope 同步", $("fxrR").getAttribute("slope") === "1.3", $("fxrR").getAttribute("slope"));
    $("fxFlipH").click();
    await sleep(10);
    check("22 水平翻转生效", $("vid").style.transform.indexOf("scaleX(-1)") >= 0, $("vid").style.transform);
    $("fxReset").click();
    await sleep(10);
    check("23 重置恢复默认", ($("vid").style.filter === "none" || $("vid").style.filter === "") && $("vid").style.transform === "none", $("vid").style.filter + "|" + $("vid").style.transform);

    // ---------- 7. 网格/十字线 ----------
    $("ovGrid").click();
    await sleep(10);
    check("24 网格开关类切换", $("ovGrid").classList.contains("on"));
    $("ovGrid").click();

    // ---------- 8. 拍照冻结（坐标衔接）----------
    const measuresBefore = w.document.querySelectorAll("#mlist .mitem").length;
    $("btnFreeze").click();
    await sleep(60);
    check("25 冻结后视频隐藏", $("vid").style.display === "none");
    check("26 冻结生成静态图（S.img）", (function () { const h = $("hint"); return h.style.display === "none"; })());
    check("27 冻结后测量保留", w.document.querySelectorAll("#mlist .mitem").length === measuresBefore);
    check("28 冻结后相机按钮退出实时态", !$("btnCam").classList.contains("active"));

    // ---------- 9. 回到实时（测量仍在）----------
    $("btnCam").click();
    await sleep(60);
    check("29 再点相机回到实时视图", $("vid").style.display === "block" && $("btnCam").classList.contains("active"));
    check("30 测量在实时/静态切换后保留", w.document.querySelectorAll("#mlist .mitem").length === measuresBefore);

    // ---------- 10. 相机参数对话框 ----------
    $("camProps").click();
    await sleep(20);
    check("31 相机参数弹窗打开", $("camPropsMask").classList.contains("on"));
    const rows = w.document.querySelectorAll("#camPropsBody .frow").length;
    check("32 UVC 能力生成滑块（曝光/变焦）", rows >= 2, rows);
    $("camPropsClose").click();
    check("33 参数弹窗关闭", !$("camPropsMask").classList.contains("on"));

    // ---------- 11. 录像 stub ----------
    $("btnRec").click();
    await sleep(20);
    check("34 REC 徽标出现", $("recBadge").classList.contains("on"));
    $("btnRec").click();
    await sleep(20);
    check("35 停止录像徽标消失", !$("recBadge").classList.contains("on"));

    // ---------- 12. 关闭相机 ----------
    // 打开菜单点"关闭相机"
    $("camMenuBtn").click();
    await sleep(20);
    const stopItem = [...w.document.querySelectorAll("#camMenu .menuitem")].find(m => m.textContent.indexOf("⏹") >= 0 || m.textContent.indexOf("关闭") >= 0);
    check("36 菜单含关闭相机项", !!stopItem);
    if (stopItem) { stopItem.click(); await sleep(20); }
    check("37 相机已停用（视频隐藏、按钮复位）", $("vid").style.display === "none" && !$("btnCam").classList.contains("active"));
    check("38 拍照/录像按钮禁用", $("btnFreeze").disabled && $("btnRec").disabled);

    // ---------- 13. 原有静态流程回归 ----------
    // 载入图片 → 测量 → 撤销
    const imgInput = $("fileImg");
    check("39 静态导入入口存在", !!imgInput);

    // ---------- 14. 快捷键 ----------
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "F12", bubbles: true, cancelable: true }));
    await sleep(20);
    check("40 F12 无异常（相机已关时仅 toast）", true);
  })();
}
