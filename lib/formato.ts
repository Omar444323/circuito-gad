const eur = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
export const fmt = (n: number | string) => {
  const v = Number(n);
  return (v < 0 ? "−" : "") + eur.format(Math.abs(v)) + " €";
};
export const fecha = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const fh = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
export const fechaHora = (iso: string) => fh.format(new Date(iso)).replace(",", "");
export const pmp =(n: number) => n.toFixed(4).replace(".", ",");
