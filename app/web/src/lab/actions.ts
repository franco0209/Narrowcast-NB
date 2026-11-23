// Acciones del laboratorio disparadas desde la barra o desde las vistas.
import { api } from "../lib";
import { fail, toast } from "../store";
import { labEngine } from "./engine";

export async function runScenario(sc: string) {
  if (labEngine.snap.pending || labEngine.snap.st?.job) return toast("Ya hay una operación en curso: espera a que termine", "bad");
  if (sc !== "prep" && sc !== "oai_off") labEngine.setPending(sc);
  try {
    if (sc === "prep") { await api("/api/lab/provision", { method: "POST" }); toast("SIM del nodo dada de alta en el HSS", "ok"); }
    else if (sc === "oai_off") { await api("/api/oai-lab/stop", { method: "POST" }); toast("OAI detenido", "ok"); }
    else { await api("/api/lab/scenario/" + sc, { method: "POST" }); if (sc !== "baja") toast("Reiniciando OAI y registrando el nodo (~45 s)…", ""); }
    labEngine.refresh();
  } catch (e) { labEngine.setPending(null); fail(e); }
}
