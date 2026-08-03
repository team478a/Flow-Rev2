import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * 認証メールテンプレートの解決と保存の検証。
 *
 * このテーブルは他のAPI設定と違い、**内容がそのまま利用者に届く**。
 * OEMオーナーの保存が本部の既定行や他OEMの行に及ぶと、
 * 全テナントの招待メール・パスワードリセットメールの文面が差し替わる。
 * 保存は成功して見えるため、操作した本人にも他OEMにも気づけない。
 */

const WL_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_WL_ID = "88888888-8888-8888-8888-888888888888";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));

function setup(rows: Row[] = []) {
  fake = createFakeSupabase({ auth_email_templates: rows });
}

beforeEach(() => vi.resetModules());

describe("テンプレートの解決", () => {
  it("自OEMの行があればそれを使う", async () => {
    setup([
      {
        id: "wl",
        white_label_id: WL_ID,
        template_key: "invite",
        subject: "OEMの件名",
        body_html: "<p>{{link}}</p>",
      },
      {
        id: "hq",
        white_label_id: null,
        template_key: "invite",
        subject: "本部の件名",
        body_html: "<p>{{link}}</p>",
      },
    ]);
    const { resolveAuthEmailTemplate } = await import("./auth-email-templates");

    const result = await resolveAuthEmailTemplate(WL_ID, "invite");

    expect(result.subject).toBe("OEMの件名");
    expect(result.tier).toBe("white_label");
  });

  it("自OEMの行が無ければ本部の行へ落ちる", async () => {
    setup([
      {
        id: "hq",
        white_label_id: null,
        template_key: "invite",
        subject: "本部の件名",
        body_html: "<p>{{link}}</p>",
      },
    ]);
    const { resolveAuthEmailTemplate } = await import("./auth-email-templates");

    const result = await resolveAuthEmailTemplate(WL_ID, "invite");

    expect(result.subject).toBe("本部の件名");
    expect(result.tier).toBe("hq");
  });

  it("どこにも無ければ既定テンプレートを返す", async () => {
    // テーブルが空でも認証メールが届かなくなってはいけない。
    setup([]);
    const { resolveAuthEmailTemplate } = await import("./auth-email-templates");

    const result = await resolveAuthEmailTemplate(WL_ID, "invite");

    expect(result.tier).toBe("default");
    expect(result.bodyHtml).toContain("{{link}}");
  });

  it("他の種別の行を拾わない", async () => {
    // recovery の文面で招待を送ると「パスワードを再設定」という
    // 心当たりのないメールが購入者に届く。
    setup([
      {
        id: "wl-recovery",
        white_label_id: WL_ID,
        template_key: "recovery",
        subject: "リセットの件名",
        body_html: "<p>{{link}}</p>",
      },
    ]);
    const { resolveAuthEmailTemplate } = await import("./auth-email-templates");

    const result = await resolveAuthEmailTemplate(WL_ID, "invite");

    expect(result.subject).not.toBe("リセットの件名");
    expect(result.tier).toBe("default");
  });
});

describe("テンプレートの保存", () => {
  it("自OEMの行が無ければ作る", async () => {
    setup([]);
    const { saveAuthEmailTemplate } = await import("./auth-email-templates");

    await saveAuthEmailTemplate(WL_ID, {
      key: "invite",
      subject: "新しい件名",
      bodyHtml: "<p>{{link}}</p>",
    });

    const rows = fake.tables.auth_email_templates;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.white_label_id).toBe(WL_ID);
    expect(rows[0]?.template_key).toBe("invite");
  });

  it("本部の既定行を書き換えない", async () => {
    // ここを壊すと全OEMの認証メールが差し替わる。
    setup([
      {
        id: "hq",
        white_label_id: null,
        template_key: "invite",
        subject: "本部の件名",
        body_html: "<p>本部</p>",
      },
    ]);
    const { saveAuthEmailTemplate } = await import("./auth-email-templates");

    await saveAuthEmailTemplate(WL_ID, {
      key: "invite",
      subject: "OEMの件名",
      bodyHtml: "<p>OEM</p>",
    });

    const hq = fake.tables.auth_email_templates.find((r) => r.id === "hq");
    expect(hq?.subject).toBe("本部の件名");
    expect(fake.tables.auth_email_templates).toHaveLength(2);
  });

  it("他OEMの行を書き換えない", async () => {
    setup([
      {
        id: "other",
        white_label_id: OTHER_WL_ID,
        template_key: "invite",
        subject: "他OEMの件名",
        body_html: "<p>他OEM</p>",
      },
    ]);
    const { saveAuthEmailTemplate } = await import("./auth-email-templates");

    await saveAuthEmailTemplate(WL_ID, {
      key: "invite",
      subject: "自分の件名",
      bodyHtml: "<p>自分</p>",
    });

    const other = fake.tables.auth_email_templates.find(
      (r) => r.id === "other",
    );
    expect(other?.subject).toBe("他OEMの件名");
  });

  it("本部の保存はOEMの行を書き換えない", async () => {
    setup([
      {
        id: "wl",
        white_label_id: WL_ID,
        template_key: "invite",
        subject: "OEMの件名",
        body_html: "<p>OEM</p>",
      },
    ]);
    const { saveAuthEmailTemplate } = await import("./auth-email-templates");

    await saveAuthEmailTemplate(null, {
      key: "invite",
      subject: "本部の件名",
      bodyHtml: "<p>本部</p>",
    });

    const wl = fake.tables.auth_email_templates.find((r) => r.id === "wl");
    expect(wl?.subject).toBe("OEMの件名");
  });
});
