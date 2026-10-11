// Flexo Todo: emails a notification through your SMTP server.
//
// Called by a Supabase Database Webhook whenever a row is added to public.notifications
// (see supabase/SETUP.md, "Email notifications"). It only sends when the row says
// send_email = true, which the database sets from each person's email settings.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SMTP_HOST       e.g. mail.flexo.com.ph
//   SMTP_PORT       465  (Supabase blocks ports 25 and 587; use SSL on 465)
//   SMTP_USER       the mailbox login
//   SMTP_PASS       the mailbox password
//   SMTP_FROM       e.g. Flexo Todo <todo@flexo.com.ph>
//   WEBHOOK_SECRET  any long random text; the webhook sends the same value
//   APP_URL         https://fmcai70.github.io/flexo-todo-app/
import nodemailer from "npm:nodemailer@6.9.16";

type Notification = {
  type: "assigned" | "completed" | "uncompleted";
  actor_name: string;
  task_title: string;
  project_name: string;
  due_date: string | null;
  due_time: string | null;
  recipient_email: string;
  send_email: boolean;
};

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function formatDue(date: string | null, time: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  if (!time) return day;
  const [hh, mm] = time.split(":").map(Number);
  const t = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
  return `${day}, ${t}`;
}

function compose(n: Notification) {
  const who = n.actor_name || "Someone";
  const verb = { assigned: "assigned you", completed: "completed", uncompleted: "reopened" }[n.type];
  const subject = `${who} ${verb}: ${n.task_title}`;
  const due = formatDue(n.due_date, n.due_time);
  const appUrl = env("APP_URL", "https://fmcai70.github.io/flexo-todo-app/");
  const details = [n.project_name && `Project: ${n.project_name}`, due && `Due: ${due}`].filter(Boolean) as string[];

  const text = [subject, "", ...details, "", `Open Flexo Todo: ${appUrl}`, "",
    "You can turn these emails off in Flexo Todo: tap the bell, then Email settings."].join("\n");

  const html = `
  <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#202020">
    <div style="background:#dc4c3e;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700">✔ Flexo Todo</div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:18px">
      <p style="margin:0 0 6px;color:#555">${escapeHtml(who)} ${verb}:</p>
      <p style="margin:0 0 12px;font-size:18px;font-weight:700">${escapeHtml(n.task_title)}</p>
      ${details.map((d) => `<p style="margin:0 0 4px;color:#555">${escapeHtml(d)}</p>`).join("")}
      <p style="margin:18px 0 0"><a href="${escapeHtml(appUrl)}"
         style="background:#dc4c3e;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;display:inline-block">Open Flexo Todo</a></p>
      <p style="margin:18px 0 0;font-size:12px;color:#999">You can turn these emails off in Flexo Todo: tap the 🔔 bell, then Email settings.</p>
    </div>
  </div>`;
  return { subject, text, html };
}

Deno.serve(async (req) => {
  // Only the database webhook (which knows the shared secret) may trigger emails.
  const secret = env("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { type?: string; record?: Notification };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const n = payload.record;
  if (payload.type !== "INSERT" || !n || !n.send_email || !n.recipient_email) {
    return new Response("Skipped (email not requested)", { status: 200 });
  }

  const port = Number(env("SMTP_PORT", "465"));
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465, // SSL from the start on 465
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });

  const { subject, text, html } = compose(n);
  try {
    await transporter.sendMail({ from: env("SMTP_FROM", env("SMTP_USER")), to: n.recipient_email, subject, text, html });
    return new Response("Sent", { status: 200 });
  } catch (err) {
    console.error("Email failed:", err);
    return new Response("Email failed: " + (err instanceof Error ? err.message : String(err)), { status: 502 });
  }
});
