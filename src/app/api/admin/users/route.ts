import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";

type Body = {
  email?: string;
  password?: string;
  rol?: "admin" | "staff";
  establecimiento_id?: string;
};

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
