// clasificacion.component.ts
// Padre delgado: tab-bar (auto/manual), atajos de teclado y modal de
// confirmacion compartido. La logica real vive en ClasificacionService,
// consumida por los 3 subcomponentes de pestana/seccion.
import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClasificacionService } from './clasificacion.service';
import { ClasificacionAutoComponent } from './auto/auto';
import { ClasificacionManualComponent } from './manual/manual';
import { ClasificacionHistoricoComponent } from './historico/historico';

@Component({
  selector: 'app-clasificacion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ClasificacionAutoComponent,
    ClasificacionManualComponent,
    ClasificacionHistoricoComponent,
  ],
  templateUrl: './clasificacion.html',
  styleUrl: './clasificacion.scss',
  // Una sola instancia de ClasificacionService para el host y sus 3
  // subcomponentes (comparten counts, formularios, camara, historial, etc.)
  providers: [ClasificacionService],
})
export class ClasificacionComponent implements OnInit, OnDestroy {
  constructor(public svc: ClasificacionService) {}

  ngOnInit() {
    this.svc.init();
  }

  ngOnDestroy() {
    this.svc.detenerCamara();
  }

  // ─── Teclado ───────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  onEsc() {
    this.svc.onEsc();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: Event) {
    const ke  = e as KeyboardEvent;
    if (ke.key !== 'Enter' && ke.key !== ' ' && ke.code !== 'Space') return;
    const tag = (ke.target as HTMLElement).tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
    if (this.svc.modo === 'auto' && this.svc.camActive && !this.svc.procesando) {
      // el espacio hace scroll por defecto en el navegador — lo bloqueamos
      ke.preventDefault();
      this.svc.onEnter();
    }
  }
}