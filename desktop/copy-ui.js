// 单一事实源：始终从上一级目录的 CamMeasure.html 生成 ui/index.html
// 这样网页版与桌面版永远不会版本漂移。
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "CamMeasure.html");
const dstDir = path.join(__dirname, "ui");
const dst = path.join(dstDir, "index.html");
if (!fs.existsSync(src)) {
  console.error("CamMeasure.html not found at " + src);
  process.exit(1);
}
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);
console.log("ui/index.html <- CamMeasure.html (" + fs.statSync(dst).size + " bytes)");
