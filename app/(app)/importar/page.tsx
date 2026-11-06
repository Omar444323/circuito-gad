import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { anularImportacion, importarDocumentos } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";

const EJEMPLO = `tipo;num;fecha;emisor;receptor;concepto;base;cuota;total
factura;F-12;03/11/2026;G1;G2;Planchas de acero;1.200,00;252,00;1.452,00
pago;T-08;05/11/2026;G2;G1;Pago de la factura F-12;;;1.452,00`;

export default async function Importar() {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const s = await sb();
  const { data: lotes } = await s.from("lotes_importados").select("*").order("id", { ascending: false });
  return (
    <>
      <div className="head"><h1>Importar lo ya hecho</h1><p>Carga los documentos y pagos que se hicieron en papel y Excel desde el 1 de noviembre, con sus fechas reales. Los pagos mueven los saldos de las dos cuentas; el resto de documentos queda en el archivo.</p></div>
      <section className="card"><h2>Nueva importación</h2>
        <Form action={importarDocumentos} boton="Importar">
          <label>Nombre de la importación<input className="in" name="nombre" maxLength={100} placeholder="Por ejemplo, primera semana de noviembre" required /></label>
          <label>Fichero CSV<input className="in" type="file" name="fichero" accept=".csv,.txt,text/csv" /></label>
          <label>O pega aquí las filas desde Excel<textarea className="in mono" name="texto" rows={8} placeholder={EJEMPLO} /></label>
          <p className="hint">Si una fila no es válida no se importa nada y se indica cuál es. No se comprueba si los pagos dejan una cuenta en negativo, porque ya ocurrieron.</p>
        </Form>
      </section>
      <section className="card"><h2>Formato</h2>
        <div className="stack">
          <dl className="dl">
            <dt>tipo</dt><dd>presupuesto, pedido, albaran, factura, rectificativa, ticket, pago u otro</dd>
            <dt>num</dt><dd>Número del documento en papel. No se puede repetir para el mismo emisor y tipo</dd>
            <dt>fecha</dt><dd>dd/mm/aaaa, desde el 01/11/2026 hasta hoy</dd>
            <dt>emisor, receptor</dt><dd>G1 a G6. En un pago, el emisor paga y el receptor cobra. Estado: 7, Hacienda: 8, Seguridad Social: 9</dd>
            <dt>concepto</dt><dd>Opcional</dd>
            <dt>base, cuota</dt><dd>Opcionales. Con facturas y rectificativas se usan para comparar el IVA</dd>
            <dt>total</dt><dd>Obligatorio, con coma decimal</dd>
          </dl>
          <pre className="correo-texto mono">{EJEMPLO}</pre>
          <p className="hint">Las existencias no se importan: se ajustan en el almacén de cada grupo. Los documentos importados no pasan por el circuito; solo quedan archivados.</p>
        </div>
      </section>
      <section className="card"><h2>Importaciones hechas</h2>
        {lotes?.length ? <div className="stack">{lotes.map((l) => (
          <div className="fila" key={l.id}>
            <span><strong>{l.nombre}</strong> · {l.filas} {l.filas === 1 ? "fila" : "filas"} · {fecha(l.fecha)}{l.anulado_fecha && <> <span className="chip off">Anulada el {fecha(l.anulado_fecha)}</span></>}</span>
            {!l.anulado_fecha && <Form action={anularImportacion} boton="Anular" clase="btn danger sm"><input type="hidden" name="lote" value={l.id} /></Form>}
          </div>
        ))}</div> : <p className="empty">Todavía no has importado nada.</p>}
      </section>
    </>
  );
}
