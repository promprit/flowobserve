import { editionLabel } from "../edition";
import { needsYou } from "../layout";
import { eff, sorted } from "../select";
import { now, store } from "../state";
import { $, clock } from "../util";

let lastHtml = "";
let lastEl: Element | null = null;

export function renderFoot(): void {
  const list = sorted(), n = list.length, need = list.filter((s) => needsYou(s, eff(s))).length;
  const html = `<span>${n} session${n === 1 ? "" : "s"}</span>` +
    (store.link === "offline" ? '<span class="quiet">· offline</span>' : n ? (need ? `<span class="need">· ${need} need${need === 1 ? "s" : ""} you</span>` : '<span class="quiet">· all clear</span>') : "") +
    (store.blockedMs > 60000 ? `<span class="quiet" title="Blocked on you ${Math.round(store.blockedWindowMs / 60000)}m in this 5 h window">· blocked ${Math.round(store.blockedMs / 60000)}m today</span>` : "") +
    (editionLabel() ? `<span class="quiet">· ${editionLabel()}</span>` : "") +
    `<span class="sp"></span>` +
    `<span class="quiet">${clock(now())}</span>`;
  const el = $("#foot")!;
  if (lastEl === el && lastHtml === html && el.innerHTML !== "") return;
  lastEl = el; lastHtml = html; el.innerHTML = html;
}
