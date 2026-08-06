import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventarioService } from '../inventario.service';

@Component({
  selector: 'app-inventario-alimento',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alimento.html',
  styleUrl: '../inventario.scss',
})
export class InventarioAlimentoComponent {
  constructor(public svc: InventarioService) {}
}
