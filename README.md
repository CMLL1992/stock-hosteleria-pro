## Stock Hostelería (Offline‑First PWA)

PWA para gestión de inventario en hostelería con:
- Escaneo de QR (cámara trasera) y ficha de producto.
- Movimientos de stock (entrada/salida/pedido).
- Cola offline en IndexedDB y sincronización automática al volver la conexión.
- Roles `admin` / `staff` aplicados con RLS en Supabase.
- Generación/impresión de etiquetas con QR (solo admin).

### Requisitos
- Node.js 18+ (recomendado 20+)
- Un proyecto de Supabase

### 1) Crear el esquema en Supabase (SQL + RLS)

En Supabase → SQL Editor, ejecuta el fichero:
- `supabase/schema.sql`

Esto crea:
- `public.usuarios`, `public.proveedores`, `public.productos`, `public.movimientos`
- Trigger para actualizar `productos.stock_actual` al insertar movimientos
- RLS con permisos por rol

### 2) Variables de entorno

Copia `.env.example` a `.env.local` y rellena:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3) Auth y rol de usuario

La app requiere login para registrar movimientos (RLS usa `auth.uid()`).

1. Arranca la app y crea una cuenta en `/login`.
2. En Supabase → Table editor → `usuarios`, crea una fila con:
   - `id`: el UUID del usuario (Auth → Users)
   - `email`: tu email
   - `rol`: `admin` (para acceso total) o `staff`

### 4) Arrancar en local

```bash
cd stock-hosteleria-pwa
npm run dev
```

Abre `http://localhost:3000`.

### 5) Uso rápido

- **Escanear**: botón flotante de cámara en `/`.
- El QR debe contener una URL tipo: `/p/<qr_code_uid>`
- **Etiquetas** (admin): `/admin/etiquetas`
  - Imprime desde el navegador (hay `@media print`).

### Notas iOS Safari (cámara)
- El escáner se inicializa **solo después de pulsar** el botón (mejor compatibilidad con iOS).
- En iPhone, la cámara requiere **HTTPS** salvo `localhost`.

