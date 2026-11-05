import { Form } from "@/components/Form";
import { cambiarModulo } from "../acciones";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fmt } from "@/lib/formato";

type Mov = { empresa_id: number; saldo: number; id: number };

export default async function Inicio() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: empresas }, { data: movs }, { data: modulos }] = await Promise.all([
    s.from("empresas").select("*").order("id"),
    s.from("movimientos_banco").select("empresa_id, saldo, id").order("id"),
    s.from("modulos").select("*").order("nombre"),
  ]);
  const saldo = (g: number) => Number(((movs ?? []) as Mov[]).filter((m) => m.empresa_id === g).at(-1)?.saldo ?? 0);
  const verTodas = yo.rol === "profesora" || yo.empresa_id === 5;
  const mia = empresas?.find((e) => e.id === yo.empresa_id);
  return (
    <>
      <div className="head"><h1>{mia ? mia.corto : "Panel de control"}</h1><p>{mia ? mia.nombre + " · " + mia.actividad : "Vista del Estado: todas las empresas."}</p></div>
      {mia && <div className="kpis"><div className="kpi"><span className="lbl">Saldo en banco</span><span className="v">{fmt(saldo(mia.id))}</span></div></div>}
      {verTodas && (
        <section className="card"><h2>{yo.rol === "profesora" ? "Saldos de las empresas" : "Cuentas de clientes"}</h2>
          <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th className="num">Saldo inicial</th><th className="num">Saldo actual</th></tr></thead><tbody>
            {empresas?.map((e) => <tr key={e.id}><td><strong>{e.corto}</strong> <span className="muted">{e.nombre}</span></td><td className="num">{fmt(e.saldo_inicial)}</td><td className="num">{fmt(saldo(e.id))}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
      <section className="card"><h2>Contenidos activados por la profesora</h2>
        {yo.rol === "profesora" ? (
          <div className="stack">{modulos?.map((m) => (
            <div className="fila" key={m.clave}><strong>{m.nombre}</strong>
              <Form action={cambiarModulo} boton={m.activo ? "Activado" : "Activar"} clase={m.activo ? "btn sm" : "btn ghost sm"}><input type="hidden" name="clave" value={m.clave} /><input type="hidden" name="activo" value={String(!m.activo)} /></Form>
            </div>))}</div>
        ) : (
          <div className="btns">{modulos?.map((m) => <span key={m.clave} className={m.activo ? "chip good" : "chip off"}>{m.nombre}{m.activo ? "" : " · no activado"}</span>)}</div>
        )}
      </section>
    </>
  );
}
