import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClasificacionService } from '../clasificacion.service';

@Component({
  selector: 'app-clasificacion-auto',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auto.html',
  styleUrl: '../clasificacion.scss',
})
export class ClasificacionAutoComponent {
  constructor(public svc: ClasificacionService) {}

  // ── Calibracion del ROI arrastrando sobre el video ───────────────────────
  // Cuando la deteccion automatica por color falla (p. ej. tapete del mismo
  // cian que el visor), dejamos que el usuario marque el recuadro a mano
  // arrastrando directamente sobre la imagen, en vez de adivinar 4 numeros.
  arrastrando = false;
  private dragInicio = { x: 0, y: 0 };
  dragActual  = { x: 0, y: 0 };

  /** Rectangulo de previsualizacion mientras se arrastra, como fraccion 0-1. */
  get dragPreview(): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!this.arrastrando) return null;
    return {
      x1: Math.min(this.dragInicio.x, this.dragActual.x),
      y1: Math.min(this.dragInicio.y, this.dragActual.y),
      x2: Math.max(this.dragInicio.x, this.dragActual.x),
      y2: Math.max(this.dragInicio.y, this.dragActual.y),
    };
  }

  private posRelativa(ev: MouseEvent | TouchEvent, el: HTMLElement): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    const point = 'touches' in ev ? (ev.touches[0] ?? ev.changedTouches[0]) : ev;
    const x = (point.clientX - rect.left) / rect.width;
    const y = (point.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  onDragStart(ev: MouseEvent | TouchEvent, box: HTMLElement) {
    if (!this.svc.camActive) return;
    ev.preventDefault();
    const p = this.posRelativa(ev, box);
    this.dragInicio = p;
    this.dragActual = p;
    this.arrastrando = true;
  }

  onDragMove(ev: MouseEvent | TouchEvent, box: HTMLElement) {
    if (!this.arrastrando) return;
    ev.preventDefault();
    this.dragActual = this.posRelativa(ev, box);
  }

  onDragEnd() {
    if (!this.arrastrando) return;
    // Calcular el rectangulo final ANTES de apagar el flag de arrastre —
    // el getter dragPreview depende de `arrastrando` para mostrarse en pantalla.
    const x1 = Math.min(this.dragInicio.x, this.dragActual.x);
    const y1 = Math.min(this.dragInicio.y, this.dragActual.y);
    const x2 = Math.max(this.dragInicio.x, this.dragActual.x);
    const y2 = Math.max(this.dragInicio.y, this.dragActual.y);
    this.arrastrando = false;
    // Ignora arrastres minusculos (un simple click), no un recuadro real.
    if ((x2 - x1 < 0.02) || (y2 - y1 < 0.02)) return;
    this.svc.setRoiDesdeArrastre({ x1, y1, x2, y2 });
  }

  // ── Calibracion manual de los 4 caracteres (digito|digito|punto|digito) ──
  // Se arrastra sobre el recorte YA BINARIZADO (la miniatura de depuracion,
  // ampliada), no sobre el video en vivo — es una imagen limpia y estatica,
  // mucho mas facil de calibrar con precision que un video comprimido en
  // movimiento. Reemplaza cualquier intento de deteccion automatica.
  arrastrandoDivisor: number | null = null;

  onDivisorStart(i: number, ev: MouseEvent | TouchEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    this.arrastrandoDivisor = i;
  }

  onCalibMove(ev: MouseEvent | TouchEvent, wrap: HTMLElement) {
    if (this.arrastrandoDivisor === null) return;
    ev.preventDefault();
    const p = this.posRelativa(ev, wrap);
    this.svc.setDivisorDrag(this.arrastrandoDivisor, p.x);
  }

  onCalibEnd() {
    if (this.arrastrandoDivisor === null) return;
    this.arrastrandoDivisor = null;
    this.svc.guardarDivisores();
  }
}
