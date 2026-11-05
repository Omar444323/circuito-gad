import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Renueva la sesión en cada petición y manda al acceso a quien no la tenga
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (l) => {
        l.forEach((x) => req.cookies.set(x.name, x.value));
        res = NextResponse.next({ request: req });
        l.forEach((x) => res.cookies.set(x.name, x.value, x.options));
      },
    },
  });
  const { data } = await s.auth.getUser();
  if (!data.user && req.nextUrl.pathname !== "/login") return NextResponse.redirect(new URL("/login", req.url));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
