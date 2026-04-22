import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";
import { adminError, adminServerError } from "@/lib/admin/apiResponse";
import type { UsuarioListItem, UsuarioRol } from "@/types/ops";

const MIN_PASSWORD_LEN = 6;

type Body = {
  email?: string;
  password?: string;
  rol?: "admin" | "staff";
  establecimiento_id?: string;
};

type DeleteBody = { userId?: string };

type PatchBody = { userId?: string; rol?: string; establecimiento_id?: string };

const VALID_ROLES: UsuarioRol[] = ["superadmin", "admin", "staff"];

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

/** Cambia `usuarios.rol` (y opcionalmente `establecimiento_id`). Solo service role. */
export async function PATCH(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const body = (await req.json()) as PatchBody;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const rolRaw = typeof body.rol === "string" ? body.rol.trim().toLowerCase() : "";
    const estReq =
      typeof body.establecimiento_id === "string" ? body.establecimiento_id.trim() : undefined;

    if (!userId) return adminError("Falta userId.", 400);
    if (!VALID_ROLES.includes(rolRaw as UsuarioRol)) {
      return adminError("El rol debe ser superadmin, admin o staff.", 400);
    }
    const rol = rolRaw as UsuarioRol;

    if (userId === gate.userId) {
      return adminError("No puedes cambiar tu propio rol desde aquí.", 400);
    }

    const { service } = gate;

    const { data: target, error: targetErr } = await service
      .from("usuarios")
      .select("id,establecimiento_id")
      .eq("id", userId)
      .maybeSingle();

    if (targetErr) return adminError(targetErr.message, 400);
    if (!target) return adminError("Usuario no encontrado.", 404);

    let establecimiento_id = String((target.establecimiento_id as string | null | undefined) ?? "").trim();
    if (estReq) {
      const { data: estOk } = await service.from("establecimientos").select("id").eq("id", estReq).maybeSingle();
      if (!estOk) return adminError("Establecimiento no válido.", 400);
      establecimiento_id = estReq;
    }
    if (!establecimiento_id) {
      const { data: fe } = await service.from("establecimientos").select("id").limit(1).maybeSingle();
      if (fe?.id) establecimiento_id = String(fe.id);
    }
    if (!establecimiento_id) {
      return adminError("No hay establecimiento disponible para asignar al usuario.", 400);
    }

    const patch: Record<string, unknown> = { rol, establecimiento_id };

    const { error: upErr } = await service.from("usuarios").update(patch).eq("id", userId);
    if (upErr) return adminError(upErr.message, 400);

    return NextResponse.json({ ok: true });
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
      const msg = (created.error?.message ?? "").toLowerCase();
      const isAlreadyRegistered =
        msg.includes("already") && msg.includes("registered") && msg.includes("email");

      // Caso común: el email ya existe en Auth. Reutilizamos si existe fila en public.usuarios.
      if (isAlreadyRegistered) {
        const { data: existing, error: exErr } = await adminClient
          .from("usuarios")
          .select("id,email")
          .ilike("email", email)
          .maybeSingle();
        if (exErr) return adminError(exErr.message, 400);
        if (!existing?.id) {
          return adminError(
            "Ya existe un usuario con este email en Auth, pero no hay fila en la tabla usuarios. Borra el usuario duplicado o crea la fila en usuarios.",
            409
          );
        }
        const { error: upErr } = await adminClient
          .from("usuarios")
          .update({ rol, establecimiento_id })
          .eq("id", existing.id);
        if (upErr) return adminError(upErr.message, 400);
        return NextResponse.json({ ok: true, reused: true });
      }

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
