import { defineConfig } from "vite";

/**
 * Android WebView + Tauri 自定义协议（tauri://localhost）已知坑：
 *   1) 绝对路径 "/assets/x.js" 解析到协议根 → 404
 *   2) crossorigin 触发 CORS 校验 → 静默拒绝
 *   3) type="module" 在部分 WebView 上不执行
 *
 * 对策：把 JS/CSS 全部内联进 index.html，产出零外部依赖的单文件。
 * 这样没有任何子资源请求，上述三个问题从原理上不可能发生。
 */
function inlineAllAssets() {
  return {
    name: "inline-all-assets",
    enforce: "post",
    generateBundle(_opts, bundle) {
      const htmlFile = Object.values(bundle).find(
        (f) => f.type === "asset" && f.fileName.endsWith(".html")
      );
      if (!htmlFile) return;

      let html = String(htmlFile.source);

      // ---- 1) 收集并内联 CSS ----
      const cssRegex =
        /<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi;
      html = html.replace(cssRegex, (whole, href) => {
        const name = href.replace(/^\.?\//, "");
        const key = Object.keys(bundle).find(
          (k) => k === name || k.endsWith("/" + name)
        );
        if (!key) return whole;
        const css = String(bundle[key].source ?? "");
        delete bundle[key];
        return `<style>\n${css}\n</style>`;
      });

      // ---- 2) 收集并内联 JS ----
      // 匹配 <script ... src="..."></script>，不论有无 type/crossorigin
      const jsRegex =
        /<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi;
      html = html.replace(jsRegex, (whole, src) => {
        const name = src.replace(/^\.?\//, "");
        const key = Object.keys(bundle).find(
          (k) => k === name || k.endsWith("/" + name)
        );
        if (!key) return whole;
        const chunk = bundle[key];
        let code = chunk.code ?? String(chunk.source ?? "");
        // 内联到 <script> 里时，任何 "</script" 都会提前闭合标签，必须转义
        code = code.replace(/<\/script/gi, "<\\/script");
        delete bundle[key];
        return `<script>\n${code}\n</script>`;
      });

      htmlFile.source = html;
    },
  };
}

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "0.0.0.0" },
  envPrefix: ["VITE_", "TAURI_"],
  plugins: [inlineAllAssets()],
  build: {
    target: "es2015",
    minify: "esbuild",
    cssCodeSplit: false,
    sourcemap: false,
    outDir: "dist",
    modulePreload: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        format: "iife",
        entryFileNames: "app.js",
        chunkFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
