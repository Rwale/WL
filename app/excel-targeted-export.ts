import JSZip from "jszip";

export type ApprovedReportExcelValues = {
  week: number;
  outletName: string;
  location: string;
  openingStock: number;
  salesTarget: number;
  actualSales: number;
  closingStock: number;
  samplingTarget: number;
  actualSampled: number;
};

type CellValue = string | number | null;
type ParsedRow = { rowNumber: number; cells: Map<number, CellValue> };

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Math.max(0, Number(value) || 0);
const normalise = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const decodeXml = (value: string) => value
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));

function columnIndex(reference: string) {
  let result = 0;
  for (const letter of reference) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function sharedStrings(xml: string | null) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), match =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), part => decodeXml(part[1])).join(""),
  );
}

function cellValue(attributes: string, inner: string, strings: string[]): CellValue {
  const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return Array.from(inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), part => decodeXml(part[1])).join("");
  }
  const raw = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw == null) return null;
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "str") return decodeXml(raw);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : decodeXml(raw);
}

function parseRows(sheetXml: string, strings: string[]) {
  const rows: ParsedRow[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1]);
    if (!rowNumber) continue;
    const cells = new Map<number, CellValue>();
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      if (reference) cells.set(columnIndex(reference), cellValue(cellMatch[1], cellMatch[2], strings));
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

function findColumn(headers: CellValue[], start: number, names: string[], fallback: number) {
  for (let index = start; index < headers.length; index++) {
    const header = normalise(headers[index]);
    if (names.some(name => header === name || header.includes(name))) return index;
  }
  return fallback;
}

function setNumericCell(sheetXml: string, address: string, value: number) {
  const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalCell = new RegExp(`<c\\b([^>]*\\br="${escapedAddress}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  if (normalCell.test(sheetXml)) {
    return sheetXml.replace(normalCell, (_, originalAttributes: string, originalInner: string) => {
      const attributes = originalAttributes.replace(/\s+t="[^"]*"/g, "");
      let inner = originalInner
        .replace(/<f\b[^>]*\/>/g, "")
        .replace(/<f\b[^>]*>[\s\S]*?<\/f>/g, "")
        .replace(/<is\b[^>]*>[\s\S]*?<\/is>/g, "");
      if (/<v\b[^>]*>[\s\S]*?<\/v>/.test(inner)) inner = inner.replace(/<v\b[^>]*>[\s\S]*?<\/v>/, `<v>${value}</v>`);
      else inner += `<v>${value}</v>`;
      return `<c${attributes}>${inner}</c>`;
    });
  }

  const selfClosingCell = new RegExp(`<c\\b([^>]*\\br="${escapedAddress}"[^>]*)\\/>`);
  if (selfClosingCell.test(sheetXml)) {
    return sheetXml.replace(selfClosingCell, (_, originalAttributes: string) => {
      const attributes = originalAttributes.replace(/\s+t="[^"]*"/g, "");
      return `<c${attributes}><v>${value}</v></c>`;
    });
  }

  const rowNumber = Number(address.match(/\d+$/)?.[0]);
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?)(<\\/row>)`);
  if (!rowPattern.test(sheetXml)) throw new Error(`The Excel row for ${address} could not be updated.`);
  return sheetXml.replace(rowPattern, `$1<c r="${address}"><v>${value}</v></c>$2`);
}

function relationshipTarget(relationshipsXml: string, relationshipId: string) {
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    if (match[1].match(/\bId="([^"]+)"/)?.[1] === relationshipId) return match[1].match(/\bTarget="([^"]+)"/)?.[1] ?? null;
  }
  return null;
}

function requestFullCalculation(workbookXml: string) {
  const attributes = ' calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"';
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)\/>/, (_, current: string) => {
      const cleaned = current.replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g, "");
      return `<calcPr${cleaned}${attributes}/>`;
    });
  }
  return workbookXml.replace(/<\/workbook>/, `<calcPr${attributes}/></workbook>`);
}

function requestPivotRefresh(xml: string) {
  return xml.replace(/<pivotCacheDefinition\b([^>]*)>/, (_, current: string) => {
    const cleaned = current.replace(/\s+refreshOnLoad="[^"]*"/g, "");
    return `<pivotCacheDefinition${cleaned} refreshOnLoad="1">`;
  });
}

export async function updateApprovedReportInWorkbook(
  sourceWorkbook: ArrayBuffer | Uint8Array,
  report: ApprovedReportExcelValues,
) {
  const zip = await JSZip.loadAsync(sourceWorkbook);
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipFile) throw new Error("The uploaded file is not a valid Excel workbook.");

  let workbookXml = await workbookFile.async("string");
  const relationshipsXml = await relationshipFile.async("string");
  const requestedSheet = `WEEK ${report.week}`;
  let relationshipId = "";
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)) {
    const name = decodeXml(match[1].match(/\bname="([^"]+)"/)?.[1] ?? "");
    if (normalise(name) === normalise(requestedSheet)) {
      relationshipId = match[1].match(/\br:id="([^"]+)"/)?.[1] ?? "";
      break;
    }
  }
  if (!relationshipId) throw new Error(`${requestedSheet} was not found in the active Excel template.`);

  const target = relationshipTarget(relationshipsXml, relationshipId);
  if (!target) throw new Error(`The worksheet file for ${requestedSheet} could not be located.`);
  const worksheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const worksheetFile = zip.file(worksheetPath);
  if (!worksheetFile) throw new Error(`The worksheet data for ${requestedSheet} is missing.`);

  const sharedFile = zip.file("xl/sharedStrings.xml");
  const strings = sharedStrings(sharedFile ? await sharedFile.async("string") : null);
  let worksheetXml = await worksheetFile.async("string");
  const rows = parseRows(worksheetXml, strings);
  const headerRow = rows.find(row => {
    const values = [...row.cells.values()].map(normalise);
    return values.some(value => value === "OUTLETS" || value === "OUTLET") && values.includes("LOCATION");
  });
  if (!headerRow) throw new Error(`${requestedSheet} does not contain OUTLETS and LOCATION headers.`);

  const maxColumn = Math.max(...headerRow.cells.keys(), 0);
  const headers = Array.from({ length: maxColumn + 1 }, (_, index) => headerRow.cells.get(index) ?? null);
  const outletColumn = findColumn(headers, 0, ["OUTLETS", "OUTLET"], 1);
  const locationColumn = findColumn(headers, 0, ["LOCATION"], 2);
  const firstRow = rows.find(row => row.rowNumber === 1);
  const cumulativeFromTitle = firstRow
    ? [...firstRow.cells.entries()].find(([, value]) => /CUM+ULATIVE/.test(normalise(value)))?.[0]
    : undefined;
  const lastOpeningStock = headers.reduce<number>(
    (result, value, index) => normalise(value).includes("OPENING STOCK") ? index : result,
    -1,
  );
  const cumulativeStart = cumulativeFromTitle ?? Math.max(0, lastOpeningStock);

  const candidates = rows.filter(row => row.rowNumber > headerRow.rowNumber && Number(row.cells.get(0)) > 0);
  const desiredOutlet = normalise(report.outletName);
  const desiredLocation = normalise(report.location);
  const exactRows = candidates.filter(row => normalise(row.cells.get(outletColumn)) === desiredOutlet);
  const targetRow = exactRows.find(row => !desiredLocation || normalise(row.cells.get(locationColumn)) === desiredLocation) ?? exactRows[0];
  if (!targetRow) throw new Error(`${report.outletName} was not found in ${requestedSheet}.`);

  const openingColumn = findColumn(headers, cumulativeStart, ["OPENING STOCK"], cumulativeStart);
  const salesTargetColumn = findColumn(headers, openingColumn + 1, ["TARGET"], openingColumn + 1);
  const actualSalesColumn = findColumn(headers, salesTargetColumn + 1, ["SALES"], salesTargetColumn + 1);
  const closingColumn = findColumn(headers, actualSalesColumn + 1, ["CLOSING STOCK"], actualSalesColumn + 2);
  const samplingTargetColumn = findColumn(headers, closingColumn + 1, ["SAMPLING OBJECTIVE", "SAMPLING TARGET"], closingColumn + 1);
  const actualSampledColumn = findColumn(headers, samplingTargetColumn + 1, ["WEEKLY SAMPLING", "NO OF CONSUMER SAMPLED", "SAMPLING ACHIVED", "SAMPLING ACHIEVED"], samplingTargetColumn + 1);

  const updates = [
    [openingColumn, number(report.openingStock)],
    [salesTargetColumn, number(report.salesTarget)],
    [actualSalesColumn, number(report.actualSales)],
    [closingColumn, number(report.closingStock)],
    [samplingTargetColumn, number(report.samplingTarget)],
    [actualSampledColumn, number(report.actualSampled)],
  ] as const;

  for (const [column, value] of updates) {
    worksheetXml = setNumericCell(worksheetXml, `${columnName(column)}${targetRow.rowNumber}`, value);
  }
  zip.file(worksheetPath, worksheetXml);

  workbookXml = requestFullCalculation(workbookXml);
  zip.file("xl/workbook.xml", workbookXml);
  for (const name of Object.keys(zip.files).filter(name => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name))) {
    const file = zip.file(name);
    if (file) zip.file(name, requestPivotRefresh(await file.async("string")));
  }

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return {
    bytes,
    sheetName: requestedSheet,
    rowNumber: targetRow.rowNumber,
    updatedCells: updates.map(([column]) => `${columnName(column)}${targetRow.rowNumber}`),
  };
}
