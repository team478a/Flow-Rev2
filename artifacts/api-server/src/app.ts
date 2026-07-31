import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// 明示的なオリジン許可リストを使う（docs/audit/05_SECURITY_FINDINGS.md L-1）。
// ALLOWED_ORIGINS が未設定の場合はクロスオリジンアクセスを一切許可しない
// （このサービスは現時点で /_apiserver/healthz のみを公開しており、
//   Cookie 認証付きのエンドポイントを追加する際は必ず設定すること）。
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/_apiserver", router);

export default app;
