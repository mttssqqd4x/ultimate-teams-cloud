import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("APP_EMAIL_FROM") ?? "NM Ultimate Teams <no-reply@nmultimateteams.app>";
  const appUrl = Deno.env.get("APP_URL") ?? "https://nmultimateteams.app";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
    return json({ error: "Missing required Edge Function secrets." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const emailType = body.type === "captain" ? "captain" : "player";

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,email,role,first_name,last_name,full_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) return json({ error: profileError.message }, 500);
  if (!profile) return json({ error: "Profile not found." }, 404);

  if (emailType === "captain" && !["captain", "admin"].includes(profile.role)) {
    return json({ error: "Captain email requires captain role." }, 403);
  }

  const { data: existing } = await serviceClient
    .from("app_info_emails_sent")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .eq("email_type", emailType)
    .maybeSingle();

  if (existing) return json({ sent: false, skipped: true, reason: "already_sent" });

  const recipient = userData.user.email || profile.email;
  if (!recipient) return json({ error: "No recipient email found." }, 400);

  const firstName = profile.first_name || userData.user.user_metadata?.first_name || "";
  const fullName =
    profile.full_name ||
    userData.user.user_metadata?.full_name ||
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    recipient;

  const email = emailType === "captain"
    ? captainEmail({ firstName, fullName, appUrl })
    : playerEmail({ firstName, fullName, appUrl });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  const resendJson = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    return json({ error: "Resend email failed.", details: resendJson }, 502);
  }

  const { error: insertError } = await serviceClient
    .from("app_info_emails_sent")
    .insert({ user_id: userData.user.id, email_type: emailType });

  if (insertError) return json({ error: insertError.message }, 500);

  return json({ sent: true, emailType, id: resendJson?.id || null });
});

function playerEmail({ firstName, appUrl }: { firstName: string; fullName: string; appUrl: string }) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const subject = "Welcome to NM Ultimate Teams";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Welcome to NM Ultimate Teams</h2>
      <p>${greeting}</p>
      <p>Thanks for creating an account. Here is how to use the app as a player:</p>
      <ul>
        <li>Sign in before frisbee.</li>
        <li>Mark yourself attending in the Attendance section.</li>
        <li>Check the Current Game section after teams are generated.</li>
        <li>Open Account to turn team notifications on or off for this device.</li>
        <li>If something looks wrong, ask a captain or admin for help.</li>
      </ul>
      <p><a href="${appUrl}">Open NM Ultimate Teams</a></p>
      <p>See you on the field!</p>
    </div>
  `;
  const text = `${greeting}

Thanks for creating an account. Here is how to use the app as a player:

- Sign in before frisbee.
- Mark yourself attending in the Attendance section.
- Check the Current Game section after teams are generated.
- Open Account to turn team notifications on or off for this device.
- If something looks wrong, ask a captain or admin for help.

Open NM Ultimate Teams: ${appUrl}

See you on the field!`;
  return { subject, html, text };
}

function captainEmail({ firstName, appUrl }: { firstName: string; fullName: string; appUrl: string }) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const subject = "You’re now a captain in NM Ultimate Teams";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>You’re now a captain</h2>
      <p>${greeting}</p>
      <p>You have been upgraded to captain. Here is how to use the app as a captain:</p>
      <ul>
        <li>Mark attendance or help players mark themselves attending.</li>
        <li>Choose the number of teams and generate balanced teams.</li>
        <li>When generating teams, admins may choose whether to send a push notification.</li>
        <li>Select the winning team and save results after a game.</li>
        <li>If you generate new teams without saving results, the app can save pairings only so repeat teammates are still tracked.</li>
        <li>Use Pair Rules to keep players together or apart when needed.</li>
        <li>Use the Data page to view ratings, records, and backup/download tools available to captains.</li>
      </ul>
      <p><a href="${appUrl}">Open NM Ultimate Teams</a></p>
    </div>
  `;
  const text = `${greeting}

You have been upgraded to captain. Here is how to use the app as a captain:

- Mark attendance or help players mark themselves attending.
- Choose the number of teams and generate balanced teams.
- When generating teams, admins may choose whether to send a push notification.
- Select the winning team and save results after a game.
- If you generate new teams without saving results, the app can save pairings only so repeat teammates are still tracked.
- Use Pair Rules to keep players together or apart when needed.
- Use the Data page to view ratings, records, and backup/download tools available to captains.

Open NM Ultimate Teams: ${appUrl}`;
  return { subject, html, text };
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
