import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventarioService } from './inventario.service';
import { InventarioGeneralComponent } from './general/general';
import { InventarioAlimentoComponent } from './alimento/alimento';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule, InventarioGeneralComponent, InventarioAlimentoComponent],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  // Una sola instancia de InventarioService para el host y sus 2 subcomponentes
  // (comparten cats/opcionesUnidades/lotes, modales de opciones y confirmación)
  providers: [InventarioService],
})
export class InventarioComponent implements OnInit {
  constructor(public svc: InventarioService) {}

  ngOnInit() {
    this.svc.init();
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    this.svc.onEsc();
  }
}
