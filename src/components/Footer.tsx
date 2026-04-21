"use client";

export function Footer() {
  return (
    <footer className="hidden border-t border-slate-200 bg-white md:block">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 OPS por CM11 Asset Management SLU. Todos los derechos reservados.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <a className="underline hover:text-slate-900" href="/politica-privacidad">
            Política de Privacidad
          </a>
          <a className="underline hover:text-slate-900" href="/terminos-servicio">
            Términos de Servicio
          </a>
          <a className="underline hover:text-slate-900" href="/cookies">
            Configuración de Cookies
          </a>
        </div>
      </div>
    </footer>
  );
}

