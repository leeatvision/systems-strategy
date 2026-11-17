/**
 * Print the current page. On computers this is the browser's print dialog. In the app installed on a
 * phone, print() does nothing (iPhones ignore it), so instead the page is laid out exactly as it would
 * print (the same print styles), turned into a PDF, and offered through the phone's share sheet,
 * where Print, Save to Files and sending are all available.
 */
export function printPage(title: string) {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const phone = window.matchMedia("(pointer: coarse)").matches;
  if (!(standalone && phone)) { window.print(); return; }
  void makePdf(title);
}

const PAGE_W = 612, PAGE_H = 792, MARGIN_X = 36, MARGIN_TOP = 34, MARGIN_BOTTOM = 46; // US Letter, in points
const CSS_W = 760;                                                                  // layout width in CSS pixels

/** The app's own @media print rules, so the PDF matches a paper printout. */
function printRules(): string {
  const out: string[] = [];
  const walk = (rules: CSSRuleList, inPrint: boolean) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSMediaRule) walk(r.cssRules, inPrint || /\bprint\b/.test(r.media.mediaText));
      else if (inPrint && !(r instanceof CSSPageRule)) out.push(r.cssText);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules, false); } catch { /* another site's stylesheet */ }
  }
  return out.join("\n");
}

function overlay(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pdf-overlay";
  el.innerHTML = `<div class="pdf-box"><p class="pdf-text"></p></div>`;
  el.querySelector(".pdf-text")!.textContent = text;
  document.body.appendChild(el);
  return el;
}

async function makePdf(title: string) {
  const busy = overlay("Preparing your PDF…");
  const style = document.createElement("style");
  const holder = document.createElement("div");
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    window.dispatchEvent(new Event("beforeprint")); // e.g. Vision and Plan opens every section
    await new Promise((r) => setTimeout(r, 150));
    const source = document.querySelector("main.content");
    if (!source) throw new Error("Nothing to print");

    // A copy of the page at paper width, styled for print, out of sight.
    style.textContent = `${printRules()}\n.pdf-holder .print-foot { display: none !important; }`;
    document.head.appendChild(style);
    holder.className = "pdf-holder";
    holder.style.cssText = `position: absolute; left: -10000px; top: 0; width: ${CSS_W}px; background: #fff;`;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.style.cssText = "margin: 0; padding: 0; max-width: none; width: 100%;";
    holder.appendChild(copy);
    document.body.appendChild(holder);
    await new Promise((r) => setTimeout(r, 100));

    const scale = 2;
    const canvas = await html2canvas(holder, { scale, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: CSS_W });

    // Page breaks fall between rows and sections where possible, and before "page two" markers.
    const top = holder.getBoundingClientRect().top;
    const yOf = (el: Element) => el.getBoundingClientRect().top - top;
    const stops = Array.from(holder.querySelectorAll(".list > li, .fold, section, .card, h2, h3, .goal-summary, .print-filters, p"))
      .map(yOf).filter((y) => y > 0).sort((a, b) => a - b);
    const forced = Array.from(holder.querySelectorAll(".plan-page-two")).map(yOf);
    const total = holder.scrollHeight;
    const pxPerPt = CSS_W / (PAGE_W - 2 * MARGIN_X);
    const pageH = (PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) * pxPerPt;
    const pages: [number, number][] = [];
    for (let start = 0; start < total - 4;) {
      let end = Math.min(start + pageH, total);
      const force = forced.find((y) => y > start + 20 && y < end);
      if (force) end = force;
      else if (end < total) {
        const fit = stops.filter((y) => y > start + pageH * 0.45 && y <= end).pop();
        if (fit) end = fit;
      }
      pages.push([start, end]);
      start = end;
    }

    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const footer = (source.querySelector(".print-foot")?.textContent ?? "").trim();
    pages.forEach(([a, b], i) => {
      if (i) pdf.addPage();
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.ceil((b - a) * scale);
      slice.getContext("2d")!.drawImage(canvas, 0, -Math.floor(a * scale));
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN_X, MARGIN_TOP, PAGE_W - 2 * MARGIN_X, (b - a) / pxPerPt);
      pdf.setDrawColor(217, 220, 220).line(MARGIN_X, PAGE_H - 30, PAGE_W - MARGIN_X, PAGE_H - 30);
      pdf.setFontSize(8).setTextColor(110, 114, 115);
      pdf.text(footer, MARGIN_X, PAGE_H - 18);
      pdf.text(`Page ${i + 1} of ${pages.length}`, PAGE_W - MARGIN_X, PAGE_H - 18, { align: "right" });
    });
    const name = `${title.replace(/[^\w\s-]/g, "").trim() || "Printout"}.pdf`;
    const file = new File([pdf.output("blob")], name, { type: "application/pdf" });
    busy.remove();
    offer(file, title);
  } catch (e) {
    busy.querySelector(".pdf-text")!.textContent = `Couldn't make the PDF: ${(e as Error).message}`;
    setTimeout(() => busy.remove(), 3000);
  } finally {
    style.remove();
    holder.remove();
    window.dispatchEvent(new Event("afterprint"));
  }
}

/** The share sheet needs a fresh tap, so the finished PDF waits for one. */
function offer(file: File, title: string) {
  const el = overlay("");
  const box = el.querySelector(".pdf-box")!;
  box.innerHTML = "";
  const h = document.createElement("p"); h.className = "pdf-text"; h.textContent = `${title} is ready.`;
  const share = document.createElement("button"); share.className = "btn btn-primary btn-block"; share.textContent = "Print or share";
  const close = document.createElement("button"); close.className = "btn btn-ghost btn-block"; close.textContent = "Close";
  box.append(h, share, close);
  close.onclick = () => el.remove();
  share.onclick = async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); el.remove(); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a"); a.href = url; a.download = file.name; a.target = "_blank";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    el.remove();
  };
}
