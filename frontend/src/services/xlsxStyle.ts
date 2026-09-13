import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
  <fonts count="7">
    <font><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
    <font><name val="TH Sarabun New"/><sz val="16"/><family val="2"/></font>
    <font><name val="TH Sarabun New"/><sz val="18"/><b/><color rgb="FF334155"/><family val="2"/></font>
    <font><name val="TH Sarabun New"/><sz val="22"/><b/><color rgb="FF9A3412"/><family val="2"/></font>
    <font><name val="TH Sarabun New"/><sz val="16"/><b/><color rgb="FFFFFFFF"/><family val="2"/></font>
    <font><name val="TH Sarabun New"/><sz val="18"/><b/><color rgb="FF0F172A"/><family val="2"/></font>
    <font><name val="TH Sarabun New"/><sz val="7"/><color rgb="FFFFFFFF"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC2410C"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="thin"><color rgb="FF94A3B8"/></top><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;

function columnIndex(name: string): number {
  return [...name].reduce((value, character) => (value * 26) + character.charCodeAt(0) - 64, 0) - 1;
}

function styleIndexForCell(row: number, column: number, weekStart: number, weekEnd: number, summaryStart: number): number {
  if (row === 1) return 1;
  if (row === 2) return 2;
  if (row >= 3 && row <= 6) return 3;
  if (row === 7) return 9;
  if (row === 8 || row === 9) return 4;
  if (row >= 10) {
    if (column >= weekStart && column <= weekEnd) return 6;
    if (column === summaryStart + 4) return 7;
    if (column === 2 || column === summaryStart + 5) return 8;
    return 5;
  }
  return 0;
}

function applyWorksheetStyles(xml: string, weekCount: number): string {
  const weekStart = 4;
  const weekEnd = weekStart + weekCount - 1;
  const summaryStart = weekEnd + 1;
  let styled = xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (_match, columnName: string, rowText: string, attributes: string) => {
    const styleIndex = styleIndexForCell(Number(rowText), columnIndex(columnName), weekStart, weekEnd, summaryStart);
    const withoutStyle = attributes.replace(/\s+s="\d+"/, '');
    return `<c r="${columnName}${rowText}"${withoutStyle} s="${styleIndex}">`;
  });
  styled = styled.replace(
    /<sheetView workbookViewId="0"\/>/,
    '<sheetView workbookViewId="0"><pane xSplit="4" ySplit="9" topLeftCell="E10" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="E10" sqref="E10"/></sheetView>',
  );
  if (!styled.includes('<pageSetup ')) {
    styled = styled.replace('<ignoredErrors>', '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><ignoredErrors>');
  }
  return styled;
}

function requestFullRecalculation(xml: string): string {
  if (xml.includes('<calcPr')) {
    return xml.replace(/<calcPr[^>]*\/>/, '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>');
  }
  return xml.replace('</workbook>', '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
}

export function styleAttendanceWorkbook(bytes: Uint8Array, weekCount: number): Uint8Array {
  const archive = unzipSync(bytes);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const stylesPath = 'xl/styles.xml';
  const workbookPath = 'xl/workbook.xml';
  if (!archive[sheetPath] || !archive[stylesPath] || !archive[workbookPath]) {
    throw new Error('โครงสร้างไฟล์ XLSX ไม่ครบ ไม่สามารถจัดรูปแบบรายงานได้');
  }
  archive[stylesPath] = strToU8(STYLES_XML);
  archive[sheetPath] = strToU8(applyWorksheetStyles(strFromU8(archive[sheetPath]), weekCount));
  archive[workbookPath] = strToU8(requestFullRecalculation(strFromU8(archive[workbookPath])));
  return zipSync(archive, { level: 6 });
}
