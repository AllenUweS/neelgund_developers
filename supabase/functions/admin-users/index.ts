import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type CreatePayload = {
  action: "create";
  name: string;
  email: string;
  password: string;
  role: "admin" | "super_admin" | "hr" | "manager" | "employee" | "transport";
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
  joiningDate?: string | null;
  profileNotes?: string | null;
  managerId?: string | null;
};

type ResetPasswordPayload = {
  action: "reset_password";
  id: string;
  password: string;
};

type DeletePayload = {
  action: "delete";
  id: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: caller } = await supabaseAdmin.from("profiles").select("role").eq("id", userData.user.id).single();
    const callerRole = caller?.role as string | undefined;
    const canManageUsers = callerRole === "admin" || callerRole === "super_admin" || callerRole === "hr";
    if (!canManageUsers) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });

    const body = (await req.json()) as CreatePayload | ResetPasswordPayload | DeletePayload;

    if (body.action === "create") {
      if (callerRole === "hr" && body.role !== "manager" && body.role !== "employee") {
        return new Response(JSON.stringify({ error: "HR can only create manager and employee users" }), { status: 403, headers: corsHeaders });
      }
      const normalizedEmail = body.email.trim().toLowerCase();
      const normalizedPassword = body.password.trim();
      if (!normalizedEmail || !normalizedPassword) {
        return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: corsHeaders });
      }
      const created = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: normalizedPassword,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        return new Response(JSON.stringify({ error: created.error?.message ?? "Failed to create auth user" }), { status: 400, headers: corsHeaders });
      }

      const profileInsert = await supabaseAdmin.from("profiles").insert({
        id: created.data.user.id,
        email: normalizedEmail,
        name: body.name,
        role: body.role,
        phone: body.phone ?? null,
        department: body.department ?? null,
        designation: body.designation ?? null,
        joining_date: body.joiningDate ?? null,
        profile_notes: body.profileNotes ?? null,
        manager_id: body.managerId ?? null,
      });

      if (profileInsert.error) {
        await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
        return new Response(JSON.stringify({ error: profileInsert.error.message }), { status: 400, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, id: created.data.user.id }), { headers: corsHeaders });
    }

    if (body.action === "reset_password") {
      if (callerRole === "hr") {
        const { data: targetProfile, error: targetErr } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", body.id)
          .single();
        if (targetErr) {
          return new Response(JSON.stringify({ error: targetErr.message }), { status: 400, headers: corsHeaders });
        }
        if (targetProfile.role !== "manager" && targetProfile.role !== "employee") {
          return new Response(JSON.stringify({ error: "HR can only reset manager and employee passwords" }), { status: 403, headers: corsHeaders });
        }
      }
      const nextPassword = body.password.trim();
      if (nextPassword.length < 8) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: corsHeaders });
      }
      const updated = await supabaseAdmin.auth.admin.updateUserById(body.id, { password: nextPassword });
      if (updated.error) {
        return new Response(JSON.stringify({ error: updated.error.message }), { status: 400, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (body.action === "delete") {
      if (callerRole === "hr") {
        const { data: targetProfile, error: targetErr } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", body.id)
          .single();
        if (targetErr) {
          return new Response(JSON.stringify({ error: targetErr.message }), { status: 400, headers: corsHeaders });
        }
        if (targetProfile.role !== "manager" && targetProfile.role !== "employee") {
          return new Response(JSON.stringify({ error: "HR can only delete manager and employee users" }), { status: 403, headers: corsHeaders });
        }
      }
      // Delete from auth first: profiles.id references auth.users(id) with ON DELETE CASCADE,
      // so this removes the profile and dependent data in one atomic direction.
      const authDelete = await supabaseAdmin.auth.admin.deleteUser(body.id);
      if (authDelete.error) {
        return new Response(JSON.stringify({ error: authDelete.error.message }), { status: 400, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
