import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';

const REP_TYPES = [
  { id: 'clasificacion', label: 'Clasificación de Huevos',  sub: 'Producción por jornada y categoría' },
  { id: 'lotes',         label: 'Estado de Lotes',          sub: 'Aves, galpones y estado actual' },
  { id: 'salud',         label: 'Salud y Tratamientos',     sub: 'Mortalidad y medicamentos aplicados' },
  { id: 'inventario',    label: 'Inventario General',        sub: 'Items en stock, alertas y valor total' },
  { id: 'alimentos',     label: 'Gestión de Alimentos',     sub: 'Stock de alimentos y consumo registrado' },
  { id: 'ventas',        label: 'Ventas de Gallinas',        sub: 'Ingresos y transacciones por periodo' },
  { id: 'completo',      label: 'Informe Completo',          sub: 'Todos los módulos en un solo reporte' },
];

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class ReportesComponent implements OnInit {
  repTypes     = REP_TYPES;
  selectedType = REP_TYPES[0];
  lotes: any[] = [];

  // Filtros
  periodo     = 'semana';
  loteId      = '';
  desde       = '';
  hasta       = '';
  customRange = false;

  // Estado UI
  loading      = false;
  showExport   = false;
  previewTitle = '';
  previewData: any  = null;
  lastData: any     = null;

  constructor(private api: ApiService, private toast: ToastService, private auth: AuthService) {}

  get puedeDescargar(): boolean { return this.auth.puedeDescargar('reportes'); }

  ngOnInit() {
    this.api.get('/lotes?page=1&limit=200').then((res: any) => (this.lotes = res.data ?? res)).catch(() => {});
    this.setRangoPeriodo('semana');
  }

  selectType(t: any) { this.selectedType = t; }

  onPeriodo() {
    this.customRange = this.periodo === 'custom';
    if (!this.customRange) this.setRangoPeriodo(this.periodo);
  }

  setRangoPeriodo(p: string) {
    const hoy = new Date();
    const ini = new Date();
    if (p === 'semana')   ini.setDate(hoy.getDate() - 6);
    else if (p === 'mes') ini.setMonth(hoy.getMonth() - 1);
    else                  ini.setFullYear(hoy.getFullYear() - 1);
    this.hasta = hoy.toISOString().split('T')[0];
    this.desde = ini.toISOString().split('T')[0];
  }

  filtrarFecha(arr: any[], campo: string) {
    const d = new Date(this.desde);
    const h = new Date(this.hasta + 'T23:59:59');
    return arr.filter((r: any) => { const f = new Date(r[campo]); return f >= d && f <= h; });
  }

  // ── Formateadores ──
  fmtNum(n: any)     { return Number(n).toLocaleString('es-CO'); }
  fmtMoney(n: any)   { return '$' + Number(n).toLocaleString('es-CO'); }
  fmtDate(d: string) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── KPIs clasificación ──
  getClasTotal(d: any[])     { return d.reduce((s: number, r: any) => s + (r.total || 0), 0); }
  getClasDanados(d: any[])   { return d.reduce((s: number, r: any) => s + (r.danados || 0), 0); }
  getClasPromDia(d: any[])   {
    if (!d.length) return 0;
    const dias = new Set(d.map((r: any) => r.fecha?.split('T')[0])).size;
    return Math.round(this.getClasTotal(d) / (dias || 1));
  }
  getClasLotes(d: any[])     { return new Set(d.map((r: any) => r.lote_id).filter(Boolean)).size; }

  // ── KPIs lotes ──
  getTotalAves(d: any[])     { return d.reduce((s: number, r: any) => s + (r.cantidad || 0), 0); }
  getLotesActivos(d: any[])  { return d.filter((r: any) => r.estado?.toLowerCase() === 'activo').length; }
  getGalpones(d: any[])      { return new Set(d.map((r: any) => r.galpon_nombre).filter(Boolean)).size; }

  // ── KPIs salud ──
  getMortTotal(d: any[])     { return d.reduce((s: number, r: any) => s + (r.cant || r.cantidad || 0), 0); }
  getLotesAfect(d: any[])    { return new Set(d.map((r: any) => r.lote_id).filter(Boolean)).size; }

  // ── KPIs inventario general ──
  getInvValor(d: any[])      { return d.reduce((s: number, r: any) => s + (r.cant || 0) * (r.costo || 0), 0); }
  getInvCriticos(d: any[])   { return d.filter((r: any) => (r.cant || 0) <= (r.min || 0)).length; }
  getInvAtencion(d: any[])   { return d.filter((r: any) => (r.cant || 0) > (r.min || 0) && (r.cant || 0) <= (r.min || 0) * 1.5).length; }

  // ── KPIs alimentos ──
  getAlimStock(d: any[])     { return d.reduce((s: number, r: any) => s + (r.stock_actual || 0), 0); }
  getAlimCriticos(d: any[])  { return d.filter((r: any) => (r.stock_actual || 0) <= (r.stock_minimo || 0)).length; }
  getConsumoTotal(d: any[])  { return d.reduce((s: number, r: any) => s + +(r.cantidad_consumida || 0), 0); }

  // ── KPIs ventas ──
  getVentasTotal(d: any[])   { return d.reduce((s: number, r: any) => s + Number(r.precio_unitario || 0) * Number(r.cant || r.cantidad || 0), 0); }
  getTicketProm(d: any[])    { if (!d.length) return 0; return Math.round(this.getVentasTotal(d) / d.length); }
  getClientes(d: any[])      { return new Set(d.map((r: any) => r.cliente).filter(Boolean)).size; }

  // ── Generar reporte ──
  async generarReporte() {
    if (!this.desde || !this.hasta) { this.toast.error('Ingresa las fechas'); return; }
    if (new Date(this.desde) > new Date(this.hasta)) { this.toast.error('La fecha inicio no puede ser mayor a la final'); return; }

    this.loading = true; this.previewData = null; this.showExport = false;

    try {
      const tipo = this.selectedType.id;
      let data: any;

      if (tipo === 'clasificacion') {
        let d: any[] = await this.api.get('/clasificacion');
        if (this.loteId) d = d.filter((r: any) => r.lote?.id_lote == this.loteId);
        data = this.filtrarFecha(d, 'fecha').map((r: any) => ({
          _id:     r.id_clasificacion,
          fecha:   r.fecha,
          lote:    r.lote?.codigo || '—',
          lote_id: r.lote?.id_lote,
          jornada: r.jornada || r.turno || '—',
          danados: r.danados || 0,
          total:   r.total || 0,
          modo:    r.modo || 'Manual',
          obs:     r.observaciones || '',
          counts:  r.counts || {},
        }));

      } else if (tipo === 'lotes') {
        const res: any = await this.api.get('/lotes?page=1&limit=200');
        data = (res?.data ?? res).map((r: any) => ({
          _id:      r.id_lote,
          codigo:   r.codigo,
          raza:     r.raza || '—',
          cantidad: r.cantidad || 0,
          galpon:   r.galpon_nombre || '—',
          estado:   r.estado || '—',
          fecha:    r.fecha,
          edad:     r.edad || 0,
          obs:      r.observaciones || '',
        }));

      } else if (tipo === 'salud') {
        const [mortRaw, tratRaw]: any[] = await Promise.all([
          this.api.get('/mortalidad'),
          this.api.get('/tratamientos'),
        ]);
        const mortalidad = this.filtrarFecha(mortRaw, 'fecha').map((r: any) => ({
          _id:     r.id_mortalidad,
          fecha:   r.fecha,
          lote:    r.lote?.codigo || '—',
          lote_id: r.lote?.id_lote,
          cant:    r.cantidad || 0,
          causa:   r.causa || '—',
          obs:     r.observaciones || '',
        }));
        const tratamientos = this.filtrarFecha(tratRaw, 'fecha').map((r: any) => ({
          _id:      r.id_tratamiento,
          fecha:    r.fecha,
          lote:     r.lote?.codigo || '—',
          lote_id:  r.lote?.id_lote,
          tipo:     r.tipo_tratamiento || '—',
          med:      r.medicamento || '—',
          dosis:    r.dosis || '—',
          vet:      r.veterinario || '—',
          proxima:  r.fecha_proxima_dosis || null,
        }));
        data = { mortalidad, tratamientos };

      } else if (tipo === 'inventario') {
        const res: any = await this.api.get('/inventario?page=1&limit=500');
        data = (res?.data ?? res).map((r: any) => ({
          _id:    r.id_item,
          nombre: r.nombre,
          cat:    r.categoria?.nombre || '—',
          cant:   r.stock_actual || 0,
          min:    r.stock_minimo || 0,
          unidad: r.unidad || 'unidades',
          costo:  r.precio || 0,
          obs:    r.observaciones || '',
        }));

      } else if (tipo === 'alimentos') {
        const [alimsRaw, consumoRaw]: any[] = await Promise.all([
          this.api.get('/alimentos'),
          this.api.get('/consumo-alimento'),
        ]);
        const alimentos = alimsRaw.map((r: any) => ({
          id:       r.id_alimento,
          nombre:   r.nombre,
          stock:    r.stock_actual || 0,
          min:      r.stock_minimo || 0,
          unidad:   r.unidad || 'kg',
          costo:    r.costo_unitario || 0,
          proveedor: r.proveedor || '—',
        }));
        const consumo = this.filtrarFecha(consumoRaw, 'fecha').map((r: any) => ({
          _id:      r.id_consumo,
          fecha:    r.fecha,
          alimento: r.alimento?.nombre || '—',
          cant:     r.cantidad_consumida || 0,
          costo:    r.costo_unitario || 0,
          lote:     r.lote?.codigo || '—',
        }));
        data = { alimentos, consumo };

      } else if (tipo === 'ventas') {
        let d: any[] = await this.api.get('/ventas-gallinas');
        if (this.loteId) d = d.filter((r: any) => r.lote?.id_lote == this.loteId);
        data = this.filtrarFecha(d, 'fecha').map((r: any) => ({
          _id:    r.id_venta,
          fecha:  r.fecha,
          cliente: r.cliente || '—',
          lote:   r.lote?.codigo || '—',
          lote_id: r.lote?.id_lote,
          cant:   r.cantidad || 0,
          precio: r.precio_unitario || 0,
          total:  (r.precio_unitario || 0) * (r.cantidad || 0),
          pago:   r.forma_pago || '—',
          obs:    r.observaciones || '',
        }));

      } else if (tipo === 'completo') {
        const [clasRaw, lotesRes, mortRaw, tratRaw, alimsRaw, ventasRaw, consumoRaw]: any[] = await Promise.all([
          this.api.get('/clasificacion'),
          this.api.get('/lotes?page=1&limit=200'),
          this.api.get('/mortalidad'),
          this.api.get('/tratamientos'),
          this.api.get('/alimentos'),
          this.api.get('/ventas-gallinas'),
          this.api.get('/consumo-alimento'),
        ]);
        const lotesFiltro = this.loteId;
        let clasArr: any[] = clasRaw;
        if (lotesFiltro) clasArr = clasArr.filter((r: any) => r.lote?.id_lote == lotesFiltro);

        data = {
          clasificacion: this.filtrarFecha(clasArr, 'fecha').map((r: any) => ({
            fecha: r.fecha, lote: r.lote?.codigo || '—', jornada: r.jornada || r.turno || '—',
            danados: r.danados || 0, total: r.total || 0,
          })),
          lotes: (lotesRes?.data ?? lotesRes).map((r: any) => ({
            codigo: r.codigo, raza: r.raza || '—', cantidad: r.cantidad || 0,
            galpon: r.galpon_nombre || '—', estado: r.estado || '—',
          })),
          mortalidad: this.filtrarFecha(mortRaw, 'fecha').map((r: any) => ({
            fecha: r.fecha, lote: r.lote?.codigo || '—', cant: r.cantidad || 0, causa: r.causa || '—',
          })),
          tratamientos: this.filtrarFecha(tratRaw, 'fecha').map((r: any) => ({
            fecha: r.fecha, lote: r.lote?.codigo || '—', tipo: r.tipo_tratamiento || '—', med: r.medicamento || '—',
          })),
          alimentos: alimsRaw.map((r: any) => ({
            nombre: r.nombre, stock: r.stock_actual || 0, min: r.stock_minimo || 0, unidad: r.unidad || 'kg',
          })),
          ventas: this.filtrarFecha(ventasRaw, 'fecha').map((r: any) => ({
            fecha: r.fecha, cliente: r.cliente || '—', lote: r.lote?.codigo || '—',
            cant: r.cantidad || 0, total: (r.precio_unitario || 0) * (r.cantidad || 0),
          })),
          consumo: this.filtrarFecha(consumoRaw, 'fecha').map((r: any) => ({
            fecha: r.fecha, alimento: r.alimento?.nombre || '—', cant: r.cantidad_consumida || 0,
          })),
        };
      }

      this.lastData    = { tipo, desde: this.desde, hasta: this.hasta, data };
      this.previewData = { tipo, data };
      this.previewTitle = this.selectedType.label;
      this.showExport  = true;
      this.toast.success('Reporte generado');
    } catch {
      this.toast.error('Error al generar reporte');
    } finally {
      this.loading = false;
    }
  }

  // ── Descarga Excel ──
  async descargarExcel() {
    if (!this.puedeDescargar) { this.toast.warning('No tienes permiso para descargar reportes'); return; }
    if (!this.lastData) return;
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs' as any);
      const { tipo, desde, data } = this.lastData;
      const wb = XLSX.utils.book_new();

      const addSheet = (nombre: string, filas: any[][]) => {
        const ws = XLSX.utils.aoa_to_sheet(filas);
        ws['!cols'] = filas[0]?.map((_: any, i: number) => ({
          wch: Math.max(...filas.map((r: any) => String(r[i] ?? '').length), 10)
        }));
        XLSX.utils.book_append_sheet(wb, ws, nombre);
      };

      if (tipo === 'clasificacion') {
        addSheet('Clasificación', [
          ['Fecha', 'Lote', 'Jornada', 'Total huevos', 'Dañados', 'Modo'],
          ...data.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.jornada, r.total, r.danados, r.modo]),
          [], ['', '', 'TOTAL', this.getClasTotal(data), this.getClasDanados(data)],
        ]);
      } else if (tipo === 'lotes') {
        addSheet('Lotes', [
          ['Código', 'Raza', 'Cantidad', 'Galpón', 'Estado', 'Fecha', 'Edad (sem)'],
          ...data.map((r: any) => [r.codigo, r.raza, r.cantidad, r.galpon, r.estado, this.fmtDate(r.fecha), r.edad]),
          [], ['Total aves:', this.getTotalAves(data)],
        ]);
      } else if (tipo === 'salud') {
        addSheet('Mortalidad', [
          ['Fecha', 'Lote', 'Cantidad', 'Causa', 'Observaciones'],
          ...data.mortalidad.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.cant, r.causa, r.obs]),
          [], ['Total bajas:', this.getMortTotal(data.mortalidad)],
        ]);
        addSheet('Tratamientos', [
          ['Fecha', 'Lote', 'Tipo', 'Medicamento', 'Dosis', 'Veterinario', 'Próxima dosis'],
          ...data.tratamientos.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.tipo, r.med, r.dosis, r.vet, r.proxima ? this.fmtDate(r.proxima) : '—']),
        ]);
      } else if (tipo === 'inventario') {
        addSheet('Inventario General', [
          ['Nombre', 'Categoría', 'Stock actual', 'Stock mínimo', 'Unidad', 'Costo unitario', 'Valor total', 'Estado'],
          ...data.map((r: any) => {
            const estado = r.cant <= r.min ? 'Crítico' : r.cant <= r.min * 1.5 ? 'Atención' : 'OK';
            return [r.nombre, r.cat, r.cant, r.min, r.unidad, r.costo, r.cant * r.costo, estado];
          }),
          [], ['', '', '', '', '', 'VALOR TOTAL:', this.getInvValor(data)],
        ]);
      } else if (tipo === 'alimentos') {
        addSheet('Stock Alimentos', [
          ['Nombre', 'Stock actual', 'Stock mínimo', 'Unidad', 'Costo unitario', 'Proveedor', 'Estado'],
          ...data.alimentos.map((r: any) => {
            const estado = r.stock <= r.min ? 'Crítico' : r.stock <= r.min * 1.5 ? 'Atención' : 'OK';
            return [r.nombre, r.stock, r.min, r.unidad, r.costo, r.proveedor, estado];
          }),
        ]);
        addSheet('Consumo', [
          ['Fecha', 'Alimento', 'Cantidad consumida', 'Costo unitario', 'Lote'],
          ...data.consumo.map((r: any) => [this.fmtDate(r.fecha), r.alimento, r.cant, r.costo, r.lote]),
          [], ['', 'TOTAL CONSUMIDO:', this.getConsumoTotal(data.consumo)],
        ]);
      } else if (tipo === 'ventas') {
        addSheet('Ventas', [
          ['Fecha', 'Cliente', 'Lote', 'Cantidad', 'Precio unitario', 'Total', 'Forma de pago'],
          ...data.map((r: any) => [this.fmtDate(r.fecha), r.cliente, r.lote, r.cant, r.precio, r.total, r.pago]),
          [], ['', '', '', '', '', 'TOTAL INGRESOS:', this.getVentasTotal(data)],
        ]);
      } else if (tipo === 'completo') {
        addSheet('Clasificación', [
          ['Fecha', 'Lote', 'Jornada', 'Total', 'Dañados'],
          ...data.clasificacion.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.jornada, r.total, r.danados]),
          [], ['', '', 'TOTAL:', this.getClasTotal(data.clasificacion)],
        ]);
        addSheet('Lotes', [
          ['Código', 'Raza', 'Cantidad', 'Galpón', 'Estado'],
          ...data.lotes.map((r: any) => [r.codigo, r.raza, r.cantidad, r.galpon, r.estado]),
          [], ['Total aves:', this.getTotalAves(data.lotes)],
        ]);
        addSheet('Mortalidad', [
          ['Fecha', 'Lote', 'Cantidad', 'Causa'],
          ...data.mortalidad.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.cant, r.causa]),
          [], ['Total bajas:', this.getMortTotal(data.mortalidad)],
        ]);
        addSheet('Tratamientos', [
          ['Fecha', 'Lote', 'Tipo', 'Medicamento'],
          ...data.tratamientos.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.tipo, r.med]),
        ]);
        addSheet('Alimentos', [
          ['Nombre', 'Stock', 'Mínimo', 'Unidad'],
          ...data.alimentos.map((r: any) => [r.nombre, r.stock, r.min, r.unidad]),
        ]);
        addSheet('Ventas', [
          ['Fecha', 'Cliente', 'Lote', 'Cantidad', 'Total'],
          ...data.ventas.map((r: any) => [this.fmtDate(r.fecha), r.cliente, r.lote, r.cant, r.total]),
          [], ['', '', '', 'TOTAL:', this.getVentasTotal(data.ventas)],
        ]);
      }

      XLSX.writeFile(wb, `reporte-${tipo}-${desde}.xlsx`);
      this.toast.success('Excel descargado');
    } catch (e) {
      console.error(e);
      this.toast.error('Error al generar Excel');
    }
  }

  // ── Descarga PDF ──
  async descargarPDF() {
    if (!this.puedeDescargar) { this.toast.warning('No tienes permiso para descargar reportes'); return; }
    if (!this.lastData) return;
    this.toast.success('Generando PDF...');
    try {
      if (!(window as any).jspdf) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = () => resolve(); s.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
          document.head.appendChild(s);
        });
      }

      const { jsPDF } = (window as any).jspdf;
      const { tipo, desde, hasta, data } = this.lastData;
      const label = REP_TYPES.find(t => t.id === tipo)?.label || tipo;
      const hoy   = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });

      const enc = (s: any): string => String(s ?? '—')
        .replace(/\u00e1/g,'a').replace(/\u00e9/g,'e').replace(/\u00ed/g,'i').replace(/\u00f3/g,'o').replace(/\u00fa/g,'u')
        .replace(/\u00c1/g,'A').replace(/\u00c9/g,'E').replace(/\u00cd/g,'I').replace(/\u00d3/g,'O').replace(/\u00da/g,'U')
        .replace(/\u00f1/g,'n').replace(/\u00d1/g,'N').replace(/\u00fc/g,'u').replace(/\u00dc/g,'U')
        .replace(/[^\x00-\xFF]/g, '?');

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const pad = 14;

      const GREEN      = [57, 181, 74]   as [number,number,number];
      const DARKGREEN  = [30, 107, 38]   as [number,number,number];
      const LIGHTGREEN = [232, 245, 233] as [number,number,number];
      const DARK       = [28, 45, 30]    as [number,number,number];
      const MID        = [90, 114, 96]   as [number,number,number];
      const WHITE      = [255, 255, 255] as [number,number,number];
      const ROWALT     = [250, 255, 250] as [number,number,number];
      const BORDER     = [200, 230, 201] as [number,number,number];

      let y = 0;
      const checkPage = (needed = 10) => { if (y + needed > H - 10) { pdf.addPage(); y = pad; } };

      // Encabezado
      pdf.setFillColor(...GREEN);
      pdf.rect(0, 0, W, 42, 'F');
      pdf.setTextColor(...WHITE);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20);
      pdf.text(enc(label), pad, 18);
      pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
      pdf.text(enc(`Periodo: ${desde} - ${hasta}`), pad, 26);
      pdf.setFontSize(9);
      pdf.text(enc('Zona Avicola SENA'), W - pad, 16, { align: 'right' });
      pdf.text(enc(`Generado: ${hoy}`), W - pad, 22, { align: 'right' });
      y = 46;

      // Franja KPIs
      const kpis = this.buildKpis(tipo, data);
      const kpiW = (W - pad * 2) / kpis.length;
      pdf.setFillColor(...LIGHTGREEN);
      pdf.rect(pad, y, W - pad * 2, 18, 'F');
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
      pdf.rect(pad, y, W - pad * 2, 18, 'S');
      kpis.forEach((k, i) => {
        const x = pad + kpiW * i + kpiW / 2;
        pdf.setTextColor(...DARKGREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
        pdf.text(enc(k.val), x, y + 8, { align: 'center' });
        pdf.setTextColor(...MID); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
        pdf.text(enc(k.label).toUpperCase(), x, y + 14, { align: 'center' });
        if (i < kpis.length - 1) { pdf.setDrawColor(...BORDER); pdf.line(pad + kpiW * (i+1), y+2, pad + kpiW * (i+1), y+16); }
      });
      y += 24;

      const drawTable = (headers: string[], rows: string[][], colW?: number[]) => {
        const widths = colW || headers.map(() => (W - pad * 2) / headers.length);
        const rowH = 7; const headH = 8;
        checkPage(headH + rowH);
        pdf.setFillColor(...GREEN); pdf.rect(pad, y, W - pad * 2, headH, 'F');
        pdf.setTextColor(...WHITE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5);
        let cx = pad + 2;
        headers.forEach((h, i) => { pdf.text(enc(h).toUpperCase(), cx + widths[i]/2, y + 5.5, { align: 'center' }); cx += widths[i]; });
        y += headH;
        rows.forEach((row, ri) => {
          checkPage(rowH + 2);
          if (ri % 2 === 1) { pdf.setFillColor(...ROWALT); pdf.rect(pad, y, W - pad * 2, rowH, 'F'); }
          pdf.setTextColor(...DARK); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
          cx = pad + 2;
          row.forEach((cell, i) => { pdf.text(enc(String(cell ?? '—')), cx + 2, y + 5); cx += widths[i]; });
          pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.2); pdf.line(pad, y + rowH, W - pad, y + rowH);
          y += rowH;
        });
        y += 2;
      };

      const drawSection = (title: string) => {
        checkPage(14);
        pdf.setFillColor(...LIGHTGREEN); pdf.rect(pad, y, W - pad * 2, 8, 'F');
        pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.8); pdf.line(pad, y, pad, y + 8);
        pdf.setLineWidth(0.2); pdf.setTextColor(...DARKGREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
        pdf.text(enc(title), pad + 4, y + 5.5);
        y += 12;
      };

      const drawTotalRow = (label: string, val: string) => {
        pdf.setFillColor(...LIGHTGREEN); pdf.rect(pad, y, W - pad * 2, 8, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...DARKGREEN);
        pdf.text(enc(label), pad + 2, y + 5.5);
        pdf.text(enc(val), W - pad - 2, y + 5.5, { align: 'right' });
        y += 10;
      };

      // Contenido según tipo
      if (tipo === 'clasificacion') {
        drawTable(
          ['Fecha', 'Lote', 'Jornada', 'Total huevos', 'Dañados', 'Modo'],
          data.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.jornada, r.total, r.danados, r.modo]),
          [30, 22, 22, 28, 22, 22]
        );
        drawTotalRow('TOTAL HUEVOS', this.fmtNum(this.getClasTotal(data)));

      } else if (tipo === 'lotes') {
        drawTable(
          ['Código', 'Raza', 'Cantidad', 'Galpón', 'Estado', 'Edad'],
          data.map((r: any) => [r.codigo, r.raza, this.fmtNum(r.cantidad), r.galpon, r.estado, `${r.edad} sem`]),
          [28, 40, 22, 30, 22, 24]
        );
        drawTotalRow('TOTAL AVES', this.fmtNum(this.getTotalAves(data)));

      } else if (tipo === 'salud') {
        drawSection('Mortalidad');
        drawTable(
          ['Fecha', 'Lote', 'Cantidad', 'Causa'],
          data.mortalidad.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.cant, r.causa]),
          [34, 26, 22, 100]
        );
        drawTotalRow('TOTAL BAJAS', this.fmtNum(this.getMortTotal(data.mortalidad)));
        drawSection('Tratamientos');
        drawTable(
          ['Fecha', 'Lote', 'Tipo', 'Medicamento', 'Dosis', 'Veterinario'],
          data.tratamientos.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.tipo, r.med, r.dosis, r.vet]),
          [28, 22, 28, 38, 22, 44]
        );

      } else if (tipo === 'inventario') {
        drawTable(
          ['Nombre', 'Categoría', 'Stock', 'Mínimo', 'Unidad', 'Costo', 'Estado'],
          data.map((r: any) => {
            const estado = r.cant <= r.min ? 'Critico' : r.cant <= r.min * 1.5 ? 'Atencion' : 'OK';
            return [r.nombre, r.cat, r.cant, r.min, r.unidad, this.fmtMoney(r.costo), estado];
          }),
          [46, 28, 18, 18, 18, 24, 20]
        );
        drawTotalRow('VALOR TOTAL EN STOCK', this.fmtMoney(this.getInvValor(data)));

      } else if (tipo === 'alimentos') {
        drawSection('Stock de Alimentos');
        drawTable(
          ['Nombre', 'Stock actual', 'Stock mínimo', 'Unidad', 'Proveedor', 'Estado'],
          data.alimentos.map((r: any) => {
            const estado = r.stock <= r.min ? 'Critico' : r.stock <= r.min * 1.5 ? 'Atencion' : 'OK';
            return [r.nombre, `${this.fmtNum(r.stock)}`, `${r.min}`, r.unidad, r.proveedor, estado];
          }),
          [44, 24, 24, 18, 40, 22]
        );
        drawSection('Consumo en el Periodo');
        drawTable(
          ['Fecha', 'Alimento', 'Cantidad consumida', 'Costo unitario', 'Lote'],
          data.consumo.map((r: any) => [this.fmtDate(r.fecha), r.alimento, `${this.fmtNum(r.cant)}`, this.fmtMoney(r.costo), r.lote]),
          [30, 52, 32, 28, 24]
        );
        drawTotalRow('TOTAL CONSUMIDO', `${this.fmtNum(this.getConsumoTotal(data.consumo))} kg`);

      } else if (tipo === 'ventas') {
        drawTable(
          ['Fecha', 'Cliente', 'Lote', 'Cantidad', 'Precio unit.', 'Total', 'Pago'],
          data.map((r: any) => [this.fmtDate(r.fecha), r.cliente, r.lote, this.fmtNum(r.cant), this.fmtMoney(r.precio), this.fmtMoney(r.total), r.pago]),
          [26, 38, 18, 18, 24, 24, 24]
        );
        drawTotalRow('TOTAL INGRESOS', this.fmtMoney(this.getVentasTotal(data)));

      } else if (tipo === 'completo') {
        drawSection('Clasificación de Huevos');
        drawTable(
          ['Fecha', 'Lote', 'Jornada', 'Total', 'Dañados'],
          data.clasificacion.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.jornada, r.total, r.danados]),
          [36, 30, 28, 24, 24]
        );
        drawSection('Lotes Activos');
        drawTable(
          ['Código', 'Raza', 'Cantidad', 'Galpón', 'Estado'],
          data.lotes.map((r: any) => [r.codigo, r.raza, this.fmtNum(r.cantidad), r.galpon, r.estado]),
          [28, 44, 22, 36, 22]
        );
        drawSection('Mortalidad');
        drawTable(
          ['Fecha', 'Lote', 'Cantidad', 'Causa'],
          data.mortalidad.map((r: any) => [this.fmtDate(r.fecha), r.lote, r.cant, r.causa]),
          [34, 26, 22, 100]
        );
        drawSection('Ventas');
        drawTable(
          ['Fecha', 'Cliente', 'Lote', 'Cantidad', 'Total'],
          data.ventas.map((r: any) => [this.fmtDate(r.fecha), r.cliente, r.lote, this.fmtNum(r.cant), this.fmtMoney(r.total)]),
          [28, 52, 22, 22, 28]
        );
        drawTotalRow('TOTAL INGRESOS', this.fmtMoney(this.getVentasTotal(data.ventas)));
      }

      // Footer
      const totalPages = (pdf.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFillColor(...LIGHTGREEN); pdf.rect(0, H - 10, W, 10, 'F');
        pdf.setTextColor(...MID); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5);
        pdf.text(enc('Zona Avicola SENA - Sistema de Gestion'), pad, H - 4);
        pdf.text(enc(`${desde} al ${hasta}  |  Pag. ${i}/${totalPages}`), W - pad, H - 4, { align: 'right' });
      }

      pdf.save(`reporte-${tipo}-${desde}.pdf`);
      this.toast.success('PDF descargado');
    } catch (e) {
      console.error(e);
      this.toast.error('Error al generar PDF');
    }
  }

  private buildKpis(tipo: string, data: any): { val: string; label: string }[] {
    if (tipo === 'clasificacion') return [
      { val: this.fmtNum(this.getClasTotal(data)),   label: 'Total huevos'  },
      { val: String(data.length),                     label: 'Registros'     },
      { val: this.fmtNum(this.getClasPromDia(data)), label: 'Prom. diario'  },
      { val: String(this.getClasLotes(data)),         label: 'Lotes'         },
    ];
    if (tipo === 'lotes') return [
      { val: String(data.length),                     label: 'Total lotes'  },
      { val: this.fmtNum(this.getTotalAves(data)),   label: 'Total aves'   },
      { val: String(this.getLotesActivos(data)),      label: 'Activos'      },
      { val: String(this.getGalpones(data)),          label: 'Galpones'     },
    ];
    if (tipo === 'salud') return [
      { val: String(this.getMortTotal(data.mortalidad)),    label: 'Total bajas'     },
      { val: String(data.mortalidad.length),                label: 'Reg. mortalidad' },
      { val: String(data.tratamientos.length),              label: 'Tratamientos'    },
      { val: String(this.getLotesAfect(data.mortalidad)),  label: 'Lotes afectados' },
    ];
    if (tipo === 'inventario') return [
      { val: String(data.length),                          label: 'Items'        },
      { val: this.fmtMoney(this.getInvValor(data)),       label: 'Valor total'  },
      { val: String(this.getInvCriticos(data)),            label: 'Críticos'     },
      { val: String(this.getInvAtencion(data)),            label: 'Atención'     },
    ];
    if (tipo === 'alimentos') return [
      { val: String(data.alimentos.length),                          label: 'Alimentos'      },
      { val: this.fmtNum(this.getAlimStock(data.alimentos)),        label: 'Stock total'    },
      { val: String(this.getAlimCriticos(data.alimentos)),           label: 'Críticos'       },
      { val: this.fmtNum(this.getConsumoTotal(data.consumo)),       label: 'Total consumido'},
    ];
    if (tipo === 'ventas') return [
      { val: this.fmtMoney(this.getVentasTotal(data)), label: 'Total ingresos' },
      { val: String(data.length),                       label: 'Transacciones'  },
      { val: this.fmtMoney(this.getTicketProm(data)),  label: 'Ticket prom.'   },
      { val: String(this.getClientes(data)),            label: 'Clientes'       },
    ];
    if (tipo === 'completo') return [
      { val: String(data.lotes?.length || 0),                        label: 'Lotes'   },
      { val: this.fmtNum(this.getClasTotal(data.clasificacion)),    label: 'Huevos'  },
      { val: String(this.getMortTotal(data.mortalidad)),             label: 'Bajas'   },
      { val: this.fmtMoney(this.getVentasTotal(data.ventas)),       label: 'Ventas'  },
    ];
    return [];
  }
}
