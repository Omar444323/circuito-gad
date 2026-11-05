"use client";
import { useActionState, type ReactNode } from "react";

export type Res = { error?: string; ok?: string; temporal?: string } | null;

export function Form({ action, children, boton, clase = "btn" }: { action: (p: Res, f: FormData) => Promise<Res>; children?: ReactNode; boton: string; clase?: string }) {
  const [r, enviar, pendiente] = useActionState(action, null);
  return (
    <form action={enviar} className="form">
      {children}
      {r?.error && <div className="note bad" role="alert">{r.error}</div>}
      {r?.ok && <div className="note good" role="status">{r.ok}</div>}
      {r?.temporal && <div className="note warn" role="status" style={{ whiteSpace: "pre-wrap" }}>Contraseña temporal (se muestra solo esta vez):{"\n"}<strong className="mono">{r.temporal}</strong></div>}
      <div className="btns"><button className={clase} disabled={pendiente}>{boton}</button></div>
    </form>
  );
}
