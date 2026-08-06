import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventarioService } from '../inventario.service';

@Component({
  selector: 'app-inventario-general',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './general.html',
  styleUrl: '../inventario.scss',
})
export class InventarioGeneralComponent {
  constructor(public svc: InventarioService) {}
}
