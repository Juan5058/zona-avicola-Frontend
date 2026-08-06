import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GallinasService } from './gallinas.service';
import { LotesComponent } from './lotes/lotes';
import { TratamientoComponent } from './tratamiento/tratamiento';
import { MortalidadComponent } from './mortalidad/mortalidad';
import { VentasComponent } from './ventas/ventas';

@Component({
  selector: 'app-gallinas',
  standalone: true,
  imports: [CommonModule, FormsModule, LotesComponent, TratamientoComponent, MortalidadComponent, VentasComponent],
  templateUrl: './gallinas.html',
  styleUrl: './gallinas.scss',
  // Una sola instancia de GallinasService para el host y sus 4 subcomponentes
  // de pestaña (comparten lotes/trats/morts/ventas, opciones, modales, etc.)
  providers: [GallinasService],
})
export class GallinasComponent implements OnInit {
  constructor(public svc: GallinasService) {}

  ngOnInit() {
    this.svc.init();
  }

  // Cierra modales al presionar Escape
  @HostListener('document:keydown.escape')
  onEsc() {
    this.svc.onEsc();
  }
}
