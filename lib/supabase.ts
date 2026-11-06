import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export async function sb() {
  const c = await cookies();
  // Con una cuenta compartida, la base de datos solo acepta como firmante a alguien de ese mismo grupo
  const firmante = c.get("firmante")?.value;
  return createServerClient(url, anon, {
    global: firmante ? { headers: { "x-firmante": firmante } } : undefined,
    cookies: {
      getAll: () => c.getAll(),
      setAll: (l) => {
        try {
          l.forEach((x) => c.set(x.name, x.value, x.options));
        } catch {
          // En un componente de servidor no se pueden escribir cookies; lo hace proxy.ts
        }
      },
    },
  });
}

// Solo en el servidor: la clave service_role nunca llega al navegador
export function admin() {
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });
}
