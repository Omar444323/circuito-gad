import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";

type Fila = { perfil_id: string; nombre: string; elaborados: number; revisados: number; ultimo: string | null };

export default async function Rotacion() {
  const yo = await miSesion();
  const s = await sb();
  const { data: emp } = await s.from("empresas").select("id, corto").eq("tipo", "grupo").order("id");
  const lista = (emp ?? []).filter((e) => yo.rol === "profesora" || e.id === yo.empresa_id);
  const datos = await Promise.all(lista.map(async (e) => ({ e, filas: ((await s.rpc("actividad_personas", { p_empresa: e.id })).data ?? []) as Fila[] })));
  return (
    <>
      <div className="head"><h1>Rotación de roles</h1><p>Punto 3.8 de las normas: cada documento indica quién lo elaboró y quién lo revisó, y los roles tienen que rotar. Si alguien solo elabora o solo revisa, conviene cambiar.</p></div>
      {datos.map(({ e, filas }) => (
        <section className="card" key={e.id}><h2>{e.corto}</h2>
          {filas.length ? <div className="tw"><table className="t"><thead><tr><th>Persona</th><th className="num">Ha elaborado</th><th className="num">Ha revisado</th><th>Último documento</th><th></th></tr></thead><tbody>
            {filas.map((f) => {
              const el = Number(f.elaborados);
              const re = Number(f.revisados);
              return <tr key={f.perfil_id}><td>{f.nombre}</td><td className="num">{el}</td><td className="num">{re}</td><td className="mono">{f.ultimo ? fecha(f.ultimo) : "—"}</td><td>{el + re === 0 ? <span className="chip off">Sin actividad</span> : el === 0 || re === 0 ? <span className="chip warn">Sin rotar</span> : <span className="chip good">Rota</span>}</td></tr>;
            })}
          </tbody></table></div> : <p className="empty">Sin integrantes dados de alta.</p>}
        </section>
      ))}
    </>
  );
}
