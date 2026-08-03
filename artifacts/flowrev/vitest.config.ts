import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      // アプリコードと同じ `@/` エイリアスを解決する（tsconfig.json と揃える）
      "@": path.resolve(__dirname, "."),
      // repository層は "server-only" を import するが、これは Next.js の
      // サーバー専用マーカーで、素の Node では解決できない。テストでは無害な
      // 空モジュールに差し替える。
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
