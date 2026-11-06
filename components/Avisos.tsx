"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { actorDe, ETAPAS, type Pedido } from "@/lib/circuito";

type Aviso = { id: number; texto: string };
type Fila = Record<string, unknown>;

const TEXTO_ETAPA: Record<string, string> = {
  pedido_enviado: "Te ha llegado un pedido",
  albaran_emitido: "Te ha llegado un albarán",
  factura_emitida: "Te ha llegado una factura",
  factura_rechazada: "Te han rechazado una factura",
};

// Escucha lo que cambia en la base de datos. Las políticas de lectura deciden qué eventos llegan a cada empresa.
// Si la conexión falla, la app sigue funcionando: los contadores se ponen al día al navegar
export function Avisos({ empresa, hoy, inicial }: { empresa: number | null; hoy: string; inicial: string[] }) {
  const router = useRouter();
  const [avisos, setAvisos] = useState<Aviso[]>(() => inicial.map((texto, i) => ({ id: i + 1, texto })));
  const siguiente = useRef(inicial.length + 1);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;
    const c = createBrowserClient(url, anon);
    const avisar = (texto: string | null) => {
      if (texto) setAvisos((a) => [...a.slice(-3), { id: siguiente.current++, texto }]);
      if (pendiente.current) clearTimeout(pendiente.current);
      pendiente.current = setTimeout(() => router.refresh(), 400);
    };
    const canal = c.channel("avisos");
    const escuchar = (tabla: string, tratar: (f: Fila, evento: string) => string | null) =>
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, (m) => avisar(tratar(m.new as Fila, m.eventType)));
    escuchar("pedidos", (f) => {
      const p = f as unknown as Pedido;
      if (!p.etapa) return null;
      if (p.etapa === "pagado") return p.vendedor_id === empresa ? "Has cobrado " + p.num : null;
      if (actorDe(p, hoy) !== empresa) return null;
      return (TEXTO_ETAPA[p.etapa] ?? "Te toca actuar") + ": " + p.num + (ETAPAS[p.etapa]?.paso ? ". " + ETAPAS[p.etapa].paso : "");
    });
    escuchar("correos", (f, e) => (e === "INSERT" && f.destinatario_id === empresa ? "Correo nuevo: " + f.asunto : null));
    escuchar("presupuestos", (f, e) => (e === "INSERT" && f.vendedor_id === empresa ? "Te han pedido un presupuesto: " + f.num : null));
    escuchar("deudas", (f, e) => {
      if (e === "INSERT" && f.estado === "propuesta" && f.propuso_empresa !== empresa) return "Te proponen dejar a deber " + f.num;
      if (e === "UPDATE" && f.estado === "saldada") return "Deuda saldada: " + f.num;
      return null;
    });
    escuchar("ordenes_pago", (f) => (f.estado === "ejecutada" && f.ordenante_id === empresa ? "Orden ejecutada: " + f.num : null));
    escuchar("circulares", (f, e) => (e === "INSERT" ? "Circular nueva: " + f.titulo : null));
    let cerrado = false;
    c.auth.getSession().then(({ data }) => {
      if (cerrado) return;
      if (data.session) c.realtime.setAuth(data.session.access_token);
      canal.subscribe();
    });
    return () => {
      cerrado = true;
      if (pendiente.current) clearTimeout(pendiente.current);
      c.removeChannel(canal);
    };
  }, [empresa, hoy, router]);

  if (!avisos.length) return null;
  return (
    <div className="avisos no-print" role="status" aria-live="polite">
      {avisos.map((a) => <div className="aviso" key={a.id}><span>{a.texto}</span><button type="button" className="btn ghost sm" aria-label="Cerrar el aviso" onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}>×</button></div>)}
    </div>
  );
}
