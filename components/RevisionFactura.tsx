"use client";
import { useActionState, useState } from "react";
import { aceptarFactura } from "@/app/acciones-circuito";
import { COMPROBACIONES } from "@/lib/circuito";
import type { Res } from "./Form";

// El botón se activa al marcar toda la lista; la base de datos vuelve a comprobarlo
export function RevisionFactura({ pedido }: { pedido: number }) {
  const [r, enviar, pendiente] = useActionState<Res, FormData>(aceptarFactura, null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const cambiar = (k: string, si: boolean) => setMarcadas(si ? [...marcadas, k] : marcadas.filter((x) => x !== k));
  return (
    <form action={enviar} className="form">
      <input type="hidden" name="pedido" value={pedido} />
      <p>Revisa la factura antes de aceptarla. Si hay un error, recházala: no la corrijas tú.</p>
      <div className="checks">
        {COMPROBACIONES.map(([k, l]) => <label className="check" key={k}><input type="checkbox" name="comprobacion" value={k} checked={marcadas.includes(k)} onChange={(e) => cambiar(k, e.target.checked)} /> {l}</label>)}
      </div>
      {r?.error && <div className="note bad" role="alert">{r.error}</div>}
      <div className="btns"><button className="btn" disabled={pendiente || marcadas.length < COMPROBACIONES.length}>Aceptar factura</button></div>
    </form>
  );
}
