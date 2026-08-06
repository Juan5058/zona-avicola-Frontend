import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';

@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
})
export class AuditoriaComponent implements OnInit {
  registros: any[] = [];
  filtrados: any[] = [];
  loading = true;

  // Filtros
  filtroModulo = '';
  filtroAccion = '';
  filtroUsuario = '';
  filtroDesde = '';
  filtroHasta = '';

  // Listas para los selects
  modulos: string[] = [];
  acciones: string[] = [];

  // Modal
  modalOpen = false;
  selected: any = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.cargar();
  }

  async cargar() {
    try {
      this.loading = true;
      const data: any[] = await this.api.get('/auditoria');
      // Ordenar por fecha desc
      this.registros = data.sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      );
      // Extraer listas únicas para filtros
      this.modulos = [...new Set(data.map((r) => r.modulo).filter(Boolean))].sort();
      this.acciones = [...new Set(data.map((r) => r.accion).filter(Boolean))].sort();
      this.aplicarFiltros();
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
  }

  aplicarFiltros() {
    this.filtrados = this.registros.filter((r) => {
      if (this.filtroModulo && r.modulo !== this.filtroModulo) return false;
      if (this.filtroAccion && r.accion !== this.filtroAccion) return false;
      if (
        this.filtroUsuario &&
        !r.usuario?.nombre_usuario
          ?.toLowerCase()
          .includes(this.filtroUsuario.toLowerCase())
      )
        return false;
      if (this.filtroDesde) {
        const desde = new Date(this.filtroDesde + 'T00:00:00');
        if (new Date(r.fecha) < desde) return false;
      }
      if (this.filtroHasta) {
        const hasta = new Date(this.filtroHasta + 'T23:59:59');
        if (new Date(r.fecha) > hasta) return false;
      }
      return true;
    });
  }

  limpiarFiltros() {
    this.filtroModulo = '';
    this.filtroAccion = '';
    this.filtroUsuario = '';
    this.filtroDesde = '';
    this.filtroHasta = '';
    this.aplicarFiltros();
  }

  verDetalle(r: any) {
    this.selected = r;
    this.modalOpen = true;
  }

  cerrarModal() {
    this.modalOpen = false;
    this.selected = null;
  }

  fmtFecha(f: string): string {
    if (!f) return '—';
    return new Date(f).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  fmt(val: any): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  getKeys(obj: any): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  hasChanged(key: string): boolean {
    if (!this.selected?.detalle?.antes || !this.selected?.detalle?.despues) return false;
    return (
      JSON.stringify(this.selected.detalle.antes[key]) !==
      JSON.stringify(this.selected.detalle.despues[key])
    );
  }

  modIcon(modulo: string): string {
    const icons: Record<string, string> = {
      Lotes: '🐔', Clasificacion: '🥚', Inventario: '📦',
      Reportes: '📄', Usuarios: '👥', Auth: '🔐',
      Mortalidad: '📉', Tratamientos: '💊', Alimentos: '🌽',
    };
    return icons[modulo] || '📋';
  }

  accionClass(accion: string): string {
    const map: Record<string, string> = {
      CREAR: 'badge-crear', EDITAR: 'badge-editar',
      ELIMINAR: 'badge-eliminar', LOGIN: 'badge-login',
    };
    return map[accion] || 'badge-otro';
  }

  rolClass(rol: string): string {
    const map: Record<string, string> = {
      Administrador: 'badge-admin',
      Usuario: 'badge-usuario',
      Visitante: 'badge-visitante',
    };
    return map[rol] || 'badge-otro';
  }
}
