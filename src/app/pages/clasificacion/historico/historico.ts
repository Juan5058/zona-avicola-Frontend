import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClasificacionService } from '../clasificacion.service';

@Component({
  selector: 'app-clasificacion-historico',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historico.html',
  styleUrl: '../clasificacion.scss',
})
export class ClasificacionHistoricoComponent {
  constructor(public svc: ClasificacionService) {}
}
