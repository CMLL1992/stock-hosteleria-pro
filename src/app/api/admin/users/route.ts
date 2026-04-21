import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";
import type { UsuarioListItem } from "@/types/ops";

type Body = {
  email?: string;
  password?: string;
  rol?: "admin" | "staff";
  establecimiento_id?: string;
};

type DeleteBody = { userId?: string };

/** Lista todos los usuarios (service role, sin RLS). */
export async function GET(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { service } = gate;
    const { data, error } = await service
      .from("usuarios")
      .select("id,email,rol,establecimiento_id")
      .order("id", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: (data as UsuarioListItem[]) ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { email, password, rol, establecimiento_id } = (await req.json()) as Body;
    if (!email || !password || !rol || !establecimiento_id) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { service: adminClient } = gate;

    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (created.error || !created.data.user) {
      return NextResponse.json({ error: created.error?.message ?? "Failed to create user" }, { status: 400 });
    }

    const uid = created.data.user.id;
    const ins = await adminClient.from("usuarios").insert({
      id: uid,
      email,
      rol,
      establecimiento_id
    });
    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * Elimina fila en public.usuarios y el usuario de Auth. No se puede auto-borrar.
 */
export async function DELETE(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { userId } = (await req.json()) as DeleteBody;
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    if (userId === gate.userId) {
      return NextResponse.json({ error: "No puedes eliminar tu propia cuenta" }, { status: 400 });
    }

    const { service: adminClient } = gate;

    const delPro = await adminClient.from("usuarios").delete().eq("id", userId);
    if (delPro.error) return NextResponse.json({ error: delPro.error.message }, { status: 400 });

    const delAuth = await adminClient.auth.admin.deleteUser(userId);
    if (delAuth.error) {
      return NextResponse.json({ ok: true, warning: `Fila eliminada; Auth: ${delAuth.error.message}` });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
