import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";
import { adminError, adminServerError } from "@/lib/admin/apiResponse";
import type { UsuarioListItem } from "@/types/ops";

const MIN_PASSWORD_LEN = 6;

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

    if (error) return adminError(error.message, 400);
    return NextResponse.json({ items: (data as UsuarioListItem[]) ?? [] });
  } catch (e) {
    return adminServerError(e);
  }
}

function validateCreateUserBody(body: Body):
  | { ok: true; email: string; password: string; rol: "admin" | "staff"; establecimiento_id: string }
  | { ok: false; message: string } {
  const { email, password, rol, establecimiento_id } = body;

  if (establecimiento_id === undefined || establecimiento_id === null) {
    return { ok: false, message: "Falta el campo establecimiento_id en el cuerpo de la petición." };
  }
  if (typeof establecimiento_id !== "string" || !establecimiento_id.trim()) {
    return { ok: false, message: "establecimiento_id debe ser un identificador no vacío." };
  }

  if (!email || typeof email !== "string" || !email.trim()) {
    return { ok: false, message: "Falta el email o no es válido." };
  }
  if (password === undefined || password === null) {
    return { ok: false, message: "Falta el campo password." };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    return {
      ok: false,
      message: `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`
    };
  }
  if (!rol || (rol !== "admin" && rol !== "staff")) {
    return { ok: false, message: "El rol debe ser 'admin' o 'staff'." };
  }

  return {
    ok: true,
    email: email.trim(),
    password,
    rol,
    establecimiento_id: establecimiento_id.trim()
  };
}

export async function POST(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const body = (await req.json()) as Body;
    const v = validateCreateUserBody(body);
    if (!v.ok) {
      return adminError(v.message, 400);
    }

    const { service: adminClient } = gate;
    const { email, password, rol, establecimiento_id } = v;

    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (created.error || !created.data.user) {
      return adminError(created.error?.message ?? "Error al crear el usuario en Auth", 400);
    }

    const uid = created.data.user.id;
    const ins = await adminClient.from("usuarios").insert({
      id: uid,
      email,
      rol,
      establecimiento_id
    });
    if (ins.error) {
      return adminError(ins.error.message, 400);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return adminServerError(e);
  }
}

/**
 * Elimina fila en public.usuarios y el usuario de Auth. No se puede auto-borrar.
 * Éxito con aviso: { ok: true, warning? } (no es error; el front puede mostrar el warning).
 */
export async function DELETE(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { userId } = (await req.json()) as DeleteBody;
    if (!userId) return adminError("Falta userId en el cuerpo de la petición.", 400);
    if (userId === gate.userId) {
      return adminError("No puedes eliminar tu propia cuenta", 400);
    }

    const { service: adminClient } = gate;

    const delPro = await adminClient.from("usuarios").delete().eq("id", userId);
    if (delPro.error) return adminError(delPro.error.message, 400);

    const delAuth = await adminClient.auth.admin.deleteUser(userId);
    if (delAuth.error) {
      return NextResponse.json({
        ok: true,
        warning: `Fila eliminada; Auth: ${delAuth.error.message}`
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return adminServerError(e);
  }
}
