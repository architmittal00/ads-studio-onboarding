// A small .xlsx (Excel) writer with no dependencies: one sheet, a frozen bold header row, column widths, number formats
// and solid cell fills — what the Custom Views export needs so its colour scales survive (a CSV file cannot hold colour).
// An .xlsx is a zip of XML files; the zip here stores the entries uncompressed, which the format allows.
//
// buildXlsx({ sheetName, widths, rows }) → Uint8Array
//   widths: column widths in characters (optional)
//   rows:   array of rows; a cell is a string, a number, null, or { v, fmt?, fill?, bold? }
//           fmt = an Excel number-format code ("#,##0.00"), fill = "RRGGBB".

const encoder = new TextEncoder();

const xmlEscape = (value) =>
  String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // not allowed in XML at all
    .replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// ── zip (stored) ──
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const DOS_DATE = 0x0021; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── workbook ──
export function buildXlsx({ sheetName = "Sheet1", widths = [], rows = [] }) {
  // Every distinct (number format, fill, bold) combination is one cell style.
  const numFmts = []; // format codes, ids from 164
  const fills = []; // "RRGGBB"
  const styles = [{ fmt: 0, fill: 0, bold: 0 }]; // index 0 = plain
  const styleIndex = new Map([["0|0|0", 0]]);
  function styleFor(cell) {
    const fmtId = cell.fmt ? 164 + (numFmts.includes(cell.fmt) ? numFmts.indexOf(cell.fmt) : numFmts.push(cell.fmt) - 1) : 0;
    const fillId = cell.fill ? 2 + (fills.includes(cell.fill) ? fills.indexOf(cell.fill) : fills.push(cell.fill) - 1) : 0;
    const bold = cell.bold ? 1 : 0;
    const key = `${fmtId}|${fillId}|${bold}`;
    if (!styleIndex.has(key)) styleIndex.set(key, styles.push({ fmt: fmtId, fill: fillId, bold }) - 1);
    return styleIndex.get(key);
  }

  const rowXml = rows
    .map((row, r) => {
      const cells = row
        .map((raw, c) => {
          const cell = raw !== null && typeof raw === "object" ? raw : { v: raw };
          const ref = `${columnName(c)}${r + 1}`;
          const s = cell.fmt || cell.fill || cell.bold ? styleFor(cell) : 0;
          const attr = s ? ` s="${s}"` : "";
          const v = cell.v;
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${attr}><v>${v}</v></c>`;
          if (v === null || v === undefined || v === "" || typeof v === "number") return s ? `<c r="${ref}"${attr}/>` : "";
          return `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const colsXml = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.min(60, w))}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rowXml}</sheetData></worksheet>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}>` +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlEscape(f)}"/>`).join("")}</numFmts>` : "") +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="${2 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills
      .map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`)
      .join("")}</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${styles.length}">${styles
      .map((s) => `<xf numFmtId="${s.fmt}" fontId="${s.bold}" fillId="${s.fill}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`)
      .join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const safeName = String(sheetName).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = [
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="${REL}"><sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: stylesXml },
    { name: "xl/worksheets/sheet1.xml", text: sheet },
  ];
  return zipStored(files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })));
}

// A client-side file download, like the CSV one: generated entirely from data already in the page.
export function downloadXlsx(filename, bytes) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
