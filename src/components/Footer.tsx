"use client";

export function Footer() {
  return (
    <footer
      className={[
        "border-t border-slate-200 bg-white",
        // En móvil la BottomTabBar ocupa el borde inferior.
        "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]",
        // En desktop no necesitamos padding extra.
        "md:pb-0"
      ].join(" ")}
    >
      <div className="mx-auto max-w-3xl px-4 py-6 text-xs text-slate-600">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="max-w-[42ch] sm:max-w-none">
            (c) 2026 OPS por CM11 Asset Management SLU. Todos los derechos reservados.
          </p>
          <nav
            aria-label="Enlaces legales"
            className="grid w-full max-w-md grid-cols-2 gap-x-4 gap-y-2 sm:w-auto sm:max-w-none sm:grid-cols-3"
          >
          <a className="underline hover:text-slate-900" href="/politica-privacidad">
            Política de Privacidad
          </a>
          <a className="underline hover:text-slate-900" href="/terminos-servicio">
            Términos de Servicio
          </a>
          <a className="underline hover:text-slate-900" href="/cookies">
            Configuración de Cookies
          </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

