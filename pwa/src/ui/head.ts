import { agentView } from "../agents";
import { STAGES } from "@fo/shared/status";
import { ATTN, HEX } from "../config";
import { needsYou } from "../layout";
import { pager } from "../pager";
import { eff, sorted } from "../select";
import { now, store, ui, view } from "../state";
import { $, clock, esc, hms } from "../util";

let headTimer = 0;

export function headSwap(): void {
  const head = $("#head")!;
  if (ui.reduce) { renderHead(); return; }
  if (head.classList.contains("out")) return;
  head.classList.add("out");
  window.clearTimeout(headTimer);
  headTimer = window.setTimeout(() => { renderHead(); head.classList.remove("out"); }, 600);
}

export function renderHead(): void {
  const head = $("#head")!, name = $("#name")!, meta = $("#meta")!, msg = $("#msg")!;
  const s = pager.focus ? store.sessions.get(pager.focus) : undefined;
  msg.innerHTML = "";
  if (store.link === "offline") {
    head.classList.add("quiet"); name.textContent = "Observer offline";
    const r = Math.max(0, Math.ceil((store.retryAt - now()) / 1000));
    meta.innerHTML = `<span style="color:${HEX.t2}">RECONNECTING</span><span style="color:${HEX.t3}">RETRY IN ${r}S</span><span style="color:${HEX.t3}">LAST UPDATE ${clock(store.lastUpdate)}</span>`;
    return;
  }
  if (!s) { head.classList.add("quiet"); name.textContent = "No live sessions"; meta.innerHTML = `<span style="color:${HEX.t3}">WAITING FOR A CLAUDE CODE SESSION</span>`; return; }
  if (view.zt < 0.5 && !ui.portrait) {
    const list = sorted(), need = list.filter((x) => needsYou(x, x.status)).length, escd = list.filter((x) => x.status === "escalated").length, act = list.filter((x) => eff(x) !== "idle").length;
    const t = now(), ta = list.reduce((n, x) => n + (agentView(x, t)?.counts.n ?? 0), 0);
    head.classList.remove("quiet"); name.textContent = `${list.length} session${list.length === 1 ? "" : "s"}`;
    meta.innerHTML = `<span style="color:${need ? HEX.jev : HEX.t2}">${need ? need + " NEED YOU" : "ALL CLEAR"}</span>${escd ? `<span style="color:${HEX.fable}">${escd} ESCALATED</span>` : ""}<span style="color:${HEX.t3}">${act} ACTIVE</span>${ta ? `<span style="color:${HEX.t3}">${ta} AGENTS</span>` : ""}`;
    return;
  }
  head.classList.remove("quiet");
  const st = eff(s), ac = ATTN[st];
  name.textContent = s.name;
  const task = s.tasksTotal ? `TASK ${s.tasksDone || 0}/${s.tasksTotal}` : "";
  const stage = STAGES[s.stage] ?? STAGES[0];
  const an = agentView(s, now())?.counts.n ?? 0; // an integer count only; no agent text reaches innerHTML
  meta.innerHTML = `<span style="color:${ac || HEX.paper}">${st === "shipped" ? "SHIPPED" : st === "idle" ? stage + " · IDLE" : stage}</span>${task ? `<span style="color:${HEX.t2}">${task}</span>` : ""}${an ? `<span style="color:${HEX.t2}">${an} AGENT${an === 1 ? "" : "S"}</span>` : ""}<span style="color:${HEX.t3}">${hms(now() - (s.since || now()))}</span>`;
  msg.style.color = ac || HEX.paper;
  if (s.msg) msg.innerHTML = `<i></i><span>${esc(s.msg)}</span>`;
}
