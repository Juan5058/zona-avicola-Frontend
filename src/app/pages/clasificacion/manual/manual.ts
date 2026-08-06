import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClasificacionService } from '../clasificacion.service';

@Component({
  selector: 'app-clasificacion-manual',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manual.html',
  styleUrl: '../clasificacion.scss',
})
export class ClasificacionManualComponent {
  constructor(public svc: ClasificacionService) {}
}
