// Flexo Todo: emails a notification through Microsoft 365 (Microsoft Graph API).
//
// Called by a Supabase Database Webhook whenever a row is added to public.notifications
// (see supabase/SETUP.md, "Email notifications"). It only sends when the row says
// send_email = true, which the database sets from each person's email settings.
//
// Why Graph and not SMTP: Supabase blocks outgoing SMTP on ports 25/587, and Microsoft 365
// only offers SMTP on 587. Graph sends over HTTPS and is Microsoft's recommended method.
// Setup for the Microsoft 365 side: supabase/MICROSOFT365.md
//
// Secrets (Supabase → Edge Functions → Secrets):
//   MS_TENANT_ID      Directory (tenant) ID of the Entra app
//   MS_CLIENT_ID      Application (client) ID of the Entra app
//   MS_CLIENT_SECRET  Client secret VALUE of the Entra app
//   MAIL_FROM         the mailbox emails are sent from, e.g. todo@flexo.com.ph
//   WEBHOOK_SECRET    any long random text; the webhook sends the same value
//   APP_URL           https://fmcai70.github.io/flexo-todo-app/

type Notification = {
  type: "assigned" | "completed" | "uncompleted" | "commented";
  actor_name: string;
  task_title: string;
  project_name: string;
  due_date: string | null;
  due_time: string | null;
  comment_text?: string;
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
  const verb = { assigned: "assigned you", completed: "completed", uncompleted: "reopened", commented: "commented on" }[n.type];
  const subject = `${who} ${verb}: ${n.task_title}`;
  const due = formatDue(n.due_date, n.due_time);
  const appUrl = env("APP_URL", "https://fmcai70.github.io/flexo-todo-app/");
  const details = [n.project_name && `Project: ${n.project_name}`, due && `Due: ${due}`].filter(Boolean) as string[];

  const html = `
  <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#202020">
    <div style="background:#dc4c3e;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700">✔ Flexo Todo</div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:18px">
      <p style="margin:0 0 6px;color:#555">${escapeHtml(who)} ${verb}:</p>
      <p style="margin:0 0 12px;font-size:18px;font-weight:700">${escapeHtml(n.task_title)}</p>
      ${n.type === "commented" && n.comment_text ? `<blockquote style="margin:0 0 14px;padding:10px 14px;background:#f6f6f6;border-left:3px solid #dc4c3e;border-radius:4px;white-space:pre-wrap">${escapeHtml(n.comment_text)}</blockquote>` : ""}
      ${details.map((d) => `<p style="margin:0 0 4px;color:#555">${escapeHtml(d)}</p>`).join("")}
      <p style="margin:18px 0 0"><a href="${escapeHtml(appUrl)}"
         style="background:#dc4c3e;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;display:inline-block">Open Flexo Todo</a></p>
      <p style="margin:18px 0 0;font-size:12px;color:#999">You can turn these emails off in Flexo Todo: tap the 🔔 bell, then Email settings.</p>
    </div>
  </div>`;
  return { subject, html };
}

// App-only access token for Microsoft Graph, reused until shortly before it expires.
let cachedToken: { value: string; expires: number } | null = null;
async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("MS_CLIENT_ID"),
      client_secret: env("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function sendMail(to: string, subject: string, html: string) {
  const from = env("MAIL_FROM");
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (res.status !== 202) {
    const text = await res.text();
    throw new Error(`Microsoft 365 refused to send (${res.status}): ${text.slice(0, 400)}`);
  }
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

  const { subject, html } = compose(n);
  try {
    await sendMail(n.recipient_email, subject, html);
    return new Response("Sent", { status: 200 });
  } catch (err) {
    console.error("Email failed:", err);
    return new Response("Email failed: " + (err instanceof Error ? err.message : String(err)), { status: 502 });
  }
});
